import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Geometry, IntegrationEvent, Incident, RiskEstimate } from '@vsafe/contracts';
import { projectionEvent, transaction, internalFetch } from '@vsafe/platform';
import { EvidenceRepository } from '../application/risk-service';
export class PgEvidence implements EvidenceRepository {
  constructor(private readonly pool: Pool) {}
  private async upsert(sql: PoolClient, i: Incident) {
    await sql.query(
      `INSERT INTO evidence_incidents VALUES($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET category=EXCLUDED.category,location=EXCLUDED.location,observed_at=EXCLUDED.observed_at,valid_until=EXCLUDED.valid_until,version=EXCLUDED.version,demo=EXCLUDED.demo WHERE evidence_incidents.version<EXCLUDED.version`,
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
    if (event.source !== 'incident-reporting') throw new Error('INVALID_PRODUCER');
    await projectionEvent(
      this.pool,
      event,
      async (sql) => {
        const i = event.payload.incident as unknown as Incident;
        await this.upsert(sql, i);
      },
      () => this.reconcile(),
    );
  }
  async reconcile() {
    await transaction(this.pool, async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(72816363)');
      const snapshot = await internalFetch<{ incidents: Incident[]; watermark: number }>(
        `${process.env.INCIDENT_REPORTING_URL}/internal/v1/incidents/snapshot`,
        'incident-reporting',
        'risk-assessment',
        {},
        10000,
      );
      await sql.query('TRUNCATE evidence_incidents');
      for (const i of snapshot.incidents) await this.upsert(sql, i);
      await sql.query(
        "INSERT INTO sync_checkpoints VALUES('incident-reporting',$1,now()) ON CONFLICT(source) DO UPDATE SET sequence=EXCLUDED.sequence,synced_at=now()",
        [snapshot.watermark],
      );
    });
  }
  async evidence(g: Geometry) {
    const r = await this.pool.query(
      `WITH route AS(SELECT ST_GeomFromGeoJSON($1)::geography AS g), relevant AS(SELECT e.* FROM evidence_incidents e,route r WHERE e.valid_until>now() AND ST_DWithin(e.location,r.g,200)) SELECT count(*)::int AS samples,count(*) FILTER(WHERE category IN('THEFT','ASSAULT'))::int AS severe,count(*) FILTER(WHERE observed_at>now()-interval '2 hours')::int AS recent,(SELECT count(*)::float/(SELECT GREATEST(ST_NPoints(g::geometry)-1,1) FROM route) FROM route, LATERAL generate_series(1,ST_NPoints(g::geometry)-1) AS s WHERE EXISTS(SELECT 1 FROM relevant e WHERE ST_DWithin(e.location,ST_MakeLine(ST_PointN(g::geometry,s),ST_PointN(g::geometry,s+1))::geography,200))) AS coverage,(SELECT extract(epoch FROM synced_at)*1000 FROM sync_checkpoints WHERE source='incident-reporting') AS synced_at FROM relevant`,
      [JSON.stringify(g)],
    );
    const v = r.rows[0];
    return {
      samples: v.samples,
      severe: v.severe,
      recent: v.recent,
      coverage: Math.min(Number(v.coverage) || 0, 1),
      syncedAt: Number(v.synced_at) || 0,
    };
  }
  async saveMetadata(results: Record<string, RiskEstimate>) {
    await this.pool.query(
      'INSERT INTO assessment_metadata(id,method_version,levels,causes) VALUES($1,$2,$3,$4)',
      [
        randomUUID(),
        Object.values(results)[0]?.methodVersion || 'none',
        JSON.stringify(Object.values(results).map((r) => r.level)),
        JSON.stringify(Object.values(results).map((r) => r.cause)),
      ],
    );
    await this.pool.query(
      "DELETE FROM assessment_metadata WHERE created_at<now()-interval '1 day'",
    );
  }
}
