import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { IntegrationEvent, Incident, Geometry, Problem } from '@vsafe/contracts';
import { withInbox, projectionEvent, transaction, internalFetch } from '@vsafe/platform';
import { AlertsRepository } from '../application/alerts-service';
import { AlertPolicy } from '../domain/alert-policy';
import { JourneyAlertAggregate } from '../domain/journey-alert';
interface ActiveJourney {
  id: string;
  ownerRef: string;
  version: number;
  geometry: Geometry;
  progressObservedAt: string;
  leaseUntil: string;
}
export class PgAlerts implements AlertsRepository {
  constructor(private readonly pool: Pool) {}
  private async upsertIncident(sql: PoolClient, i: Incident) {
    await sql.query(
      'INSERT INTO incident_projection VALUES($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET category=EXCLUDED.category,location=EXCLUDED.location,observed_at=EXCLUDED.observed_at,valid_until=EXCLUDED.valid_until,version=EXCLUDED.version,demo=EXCLUDED.demo WHERE incident_projection.version<EXCLUDED.version',
      [
        i.id,
        i.category,
        i.location.lng,
        i.location.lat,
        i.observedAt,
        i.validUntil,
        i.version,
        i.demo,
      ],
    );
  }
  async apply(event: IntegrationEvent) {
    if (event.source === 'route-planning') {
      if (event.type === 'JourneyClosed') {
        await withInbox(this.pool, event, async (sql) => {
          await sql.query('DELETE FROM alerts WHERE journey_id=$1', [event.aggregateId]);
          await sql.query('DELETE FROM active_journeys WHERE id=$1 AND version<=$2', [
            event.aggregateId,
            event.aggregateVersion,
          ]);
        });
      } else {
        await this.refresh(event.aggregateId);
        await withInbox(this.pool, event, async () => {});
      }
      return;
    }
    if (event.source !== 'incident-reporting') throw new Error('INVALID_PRODUCER');
    await projectionEvent(
      this.pool,
      event,
      async (sql) => {
        await this.upsertIncident(sql, event.payload.incident as unknown as Incident);
      },
      () => this.reconcile(),
    );
    await this.evaluate();
  }
  async reconcile() {
    await transaction(this.pool, async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(72816363)');
      const data = await internalFetch<{ incidents: Incident[]; watermark: number }>(
        `${process.env.INCIDENT_REPORTING_URL}/internal/v1/incidents/snapshot`,
        'incident-reporting',
        'journey-alerts',
        {},
        10000,
      );
      await sql.query('TRUNCATE incident_projection');
      for (const i of data.incidents) await this.upsertIncident(sql, i);
      await sql.query(
        "INSERT INTO sync_checkpoints VALUES('incident-reporting',$1,now()) ON CONFLICT(source) DO UPDATE SET sequence=EXCLUDED.sequence,synced_at=now()",
        [data.watermark],
      );
    });
  }
  async refresh(id?: string) {
    const ids = id
      ? [id]
      : (await this.pool.query('SELECT id FROM active_journeys')).rows.map((r) => r.id);
    for (const journeyId of ids) {
      try {
        const j = await internalFetch<ActiveJourney>(
          `${process.env.ROUTE_PLANNING_URL}/internal/v1/journeys/${journeyId}/active`,
          'route-planning',
          'journey-alerts',
        );
        await this.pool.query(
          'INSERT INTO active_journeys VALUES($1,$2,$3,ST_GeomFromGeoJSON($4)::geography,$5,$6) ON CONFLICT(id) DO UPDATE SET owner_ref=EXCLUDED.owner_ref,version=EXCLUDED.version,geometry=EXCLUDED.geometry,lease_until=EXCLUDED.lease_until,progress_observed_at=EXCLUDED.progress_observed_at WHERE active_journeys.version<=EXCLUDED.version',
          [
            j.id,
            j.ownerRef,
            j.version,
            JSON.stringify(j.geometry),
            j.leaseUntil,
            j.progressObservedAt,
          ],
        );
      } catch {
        await this.pool.query('DELETE FROM alerts WHERE journey_id=$1', [journeyId]);
        await this.pool.query('DELETE FROM active_journeys WHERE id=$1', [journeyId]);
      }
    }
    await this.evaluate();
  }
  async evaluate() {
    const r = await this.pool.query(
      `SELECT j.id AS journey_id,j.owner_ref,j.version,j.lease_until,j.progress_observed_at,i.id AS incident_id,i.category,i.valid_until,ST_Distance(i.location,j.geometry) AS meters FROM active_journeys j JOIN incident_projection i ON i.valid_until>now() AND ST_DWithin(i.location,j.geometry,200) WHERE j.lease_until>now() AND j.progress_observed_at>now()-interval '60 seconds' AND EXISTS(SELECT 1 FROM sync_checkpoints WHERE source='incident-reporting' AND synced_at>now()-interval '60 seconds')`,
    );
    for (const v of r.rows) {
      if (
        AlertPolicy.relevant(
          Number(v.meters),
          v.valid_until.getTime(),
          v.progress_observed_at.getTime(),
          v.lease_until.getTime(),
        )
      ) {
        const aggregate = new JourneyAlertAggregate(
          randomUUID(),
          v.journey_id,
          v.incident_id,
          v.version,
        );
        await this.pool.query(
          'INSERT INTO alerts(id,journey_id,incident_id,route_version,owner_ref,category,valid_until) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(journey_id,incident_id,route_version) DO NOTHING',
          [
            aggregate.id,
            aggregate.journeyId,
            aggregate.incidentId,
            aggregate.routeVersion,
            v.owner_ref,
            v.category,
            new Date(Math.min(v.valid_until.getTime(), v.lease_until.getTime())),
          ],
        );
      }
    }
  }
  async list(owner: string, journeyId: string, lastId: string) {
    const j = await this.pool.query(
      'SELECT * FROM active_journeys WHERE id=$1 AND owner_ref=$2 AND lease_until>now()',
      [journeyId, owner],
    );
    if (!j.rowCount) throw new Problem(404, 'JOURNEY_NOT_FOUND');
    const rows = await this.pool.query(
      `SELECT a.* FROM alerts a JOIN active_journeys j ON j.id=a.journey_id AND j.version=a.route_version JOIN incident_projection i ON i.id=a.incident_id AND i.valid_until>now() WHERE a.journey_id=$1 AND a.owner_ref=$2 AND a.sequence>$3 AND a.valid_until>now() AND j.progress_observed_at>now()-interval '60 seconds' ORDER BY sequence`,
      [journeyId, owner, Number(lastId) || 0],
    );
    return rows.rows.map((r) => ({
      id: r.id,
      eventId: String(r.sequence),
      journeyId: r.journey_id,
      incidentId: r.incident_id,
      routeVersion: r.route_version,
      category: r.category,
      createdAt: r.created_at.toISOString(),
      validUntil: r.valid_until.toISOString(),
    }));
  }
  async ack(owner: string, journeyId: string, id: string) {
    const r = await this.pool.query(
      'UPDATE alerts SET acknowledged_at=COALESCE(acknowledged_at,now()) WHERE id=$1 AND journey_id=$2 AND owner_ref=$3 RETURNING id',
      [id, journeyId, owner],
    );
    if (!r.rowCount) throw new Problem(404, 'ALERT_NOT_FOUND');
  }
  async purge() {
    await this.pool.query(
      'DELETE FROM alerts WHERE valid_until<=now() OR journey_id IN(SELECT id FROM active_journeys WHERE lease_until<=now())',
    );
    await this.pool.query('DELETE FROM active_journeys WHERE lease_until<=now()');
    await this.pool.query('DELETE FROM incident_projection WHERE valid_until<now()');
  }
}
