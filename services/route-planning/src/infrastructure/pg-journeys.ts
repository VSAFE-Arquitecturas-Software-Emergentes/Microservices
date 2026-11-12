import { Pool } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { Journey, RouteAlternative, Problem } from '@vsafe/contracts';
import { transaction, appendEvent } from '@vsafe/platform';
import { JourneyRepository } from '../application/ports';
import { Progress } from '../domain/journey';
import { JourneyAggregate, JourneyRuleViolation } from '../domain/journey-aggregate';
function map(r: any): Journey & { ownerRef: string } {
  return {
    id: r.id,
    ownerRef: r.owner_ref,
    version: r.version,
    status: r.status,
    route: r.route,
    progress: r.progress,
    expiresAt: r.expires_at.toISOString(),
  };
}
export class PgJourneys implements JourneyRepository {
  constructor(private readonly pool: Pool) {}
  async saveOptions(owner: string, routes: RouteAlternative[]) {
    await transaction(this.pool, async (sql) => {
      for (const r of routes)
        await sql.query("INSERT INTO route_options VALUES($1,$2,$3,now()+interval '15 minutes')", [
          r.id,
          owner,
          r,
        ]);
    });
  }
  async start(owner: string, alternativeId: string, key: string) {
    return transaction(this.pool, async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${owner}:${key}`]);
      const hash = createHash('sha256').update(alternativeId).digest('hex');
      const old = await sql.query('SELECT * FROM idempotency WHERE owner_ref=$1 AND key=$2', [
        owner,
        key,
      ]);
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== hash) throw new Problem(409, 'IDEMPOTENCY_CONFLICT');
        return old.rows[0].result as Journey;
      }
      const option = await sql.query(
        'SELECT data FROM route_options WHERE id=$1 AND owner_ref=$2 AND expires_at>now()',
        [alternativeId, owner],
      );
      if (!option.rows[0]) throw new Problem(410, 'ROUTE_OPTION_EXPIRED');
      const route = option.rows[0].data;
      if (Date.parse(route.risk.validUntil) <= Date.now())
        route.risk = { ...route.risk, level: 'UNKNOWN', score: null, cause: 'ASSESSMENT_EXPIRED' };
      const id = randomUUID();
      const row = await sql.query(
        "INSERT INTO journeys(id,owner_ref,status,route,geometry,expires_at) VALUES($1,$2,'ACTIVE',$3,ST_GeomFromGeoJSON($4)::geography,now()+interval '3 hours') RETURNING *",
        [id, owner, route, JSON.stringify(route.geometry)],
      );
      const result = map(row.rows[0]);
      await appendEvent(sql, 'route-planning', 'JourneyStarted', id, 1, { journeyId: id });
      await sql.query(
        'INSERT INTO idempotency(owner_ref,key,request_hash,result) VALUES($1,$2,$3,$4)',
        [owner, key, hash, result],
      );
      return result;
    });
  }
  async find(id: string, owner?: string) {
    const r = await this.pool.query(
      'SELECT * FROM journeys WHERE id=$1 AND ($2::text IS NULL OR owner_ref=$2)',
      [id, owner || null],
    );
    return r.rows[0] ? map(r.rows[0]) : null;
  }
  async change(owner: string, id: string, version: number, alternativeId: string) {
    return transaction(this.pool, async (sql) => {
      const row = await sql.query(
        'SELECT * FROM journeys WHERE id=$1 AND owner_ref=$2 FOR UPDATE',
        [id, owner],
      );
      const j = row.rows[0];
      if (!j) throw new Problem(404, 'JOURNEY_NOT_FOUND');
      const aggregate = new JourneyAggregate(
        j.id,
        j.owner_ref,
        j.version,
        j.status,
        j.route?.id || '',
      );
      try {
        aggregate.selectRoute(alternativeId, version);
      } catch (e) {
        if (e instanceof JourneyRuleViolation) throw new Problem(409, e.message);
        throw e;
      }
      const option = await sql.query(
        'SELECT data FROM route_options WHERE id=$1 AND owner_ref=$2 AND expires_at>now()',
        [alternativeId, owner],
      );
      if (!option.rows[0]) throw new Problem(410, 'ROUTE_OPTION_EXPIRED');
      const route = option.rows[0].data;
      if (Date.parse(route.risk.validUntil) <= Date.now())
        route.risk = { ...route.risk, level: 'UNKNOWN', score: null, cause: 'ASSESSMENT_EXPIRED' };
      const changed = await sql.query(
        'UPDATE journeys SET route=$2,geometry=ST_GeomFromGeoJSON($3)::geography,version=version+1,progress=NULL WHERE id=$1 RETURNING *',
        [id, route, JSON.stringify(route.geometry)],
      );
      await appendEvent(sql, 'route-planning', 'JourneyRouteChanged', id, version + 1, {
        journeyId: id,
      });
      return map(changed.rows[0]);
    });
  }
  async progress(owner: string, id: string, version: number, p: Progress) {
    const r = await this.pool.query(
      "UPDATE journeys SET progress=$4 WHERE id=$1 AND owner_ref=$2 AND version=$3 AND status='ACTIVE' AND (progress IS NULL OR (progress->>'observedAt')::timestamptz < $5::timestamptz)",
      [id, owner, version, p, p.observedAt],
    );
    if (!r.rowCount) throw new Problem(409, 'PROGRESS_CONFLICT');
  }
  async close(owner: string, id: string) {
    await transaction(this.pool, async (sql) => {
      const row = await sql.query(
        'SELECT * FROM journeys WHERE id=$1 AND owner_ref=$2 FOR UPDATE',
        [id, owner],
      );
      if (!row.rows[0]) throw new Problem(404, 'JOURNEY_NOT_FOUND');
      const r = row.rows[0];
      const aggregate = new JourneyAggregate(
        r.id,
        r.owner_ref,
        r.version,
        r.status,
        r.route?.id || '',
      );
      if (!aggregate.close()) return;
      await sql.query(
        "UPDATE journeys SET status='CLOSED',version=version+1,purge_at=now(),route=NULL,geometry=NULL,progress=NULL WHERE id=$1",
        [id],
      );
      await appendEvent(sql, 'route-planning', 'JourneyClosed', id, row.rows[0].version + 1, {
        journeyId: id,
      });
      await sql.query('DELETE FROM route_options WHERE owner_ref=$1', [owner]);
      await sql.query(
        `UPDATE idempotency SET result=result || '{"route":null,"progress":null,"status":"CLOSED"}'::jsonb WHERE owner_ref=$1 AND result->>'id'=$2`,
        [owner, id],
      );
    });
  }
  async purge() {
    await this.pool.query(
      `UPDATE idempotency SET result=result || '{"route":null,"progress":null,"status":"CLOSED"}'::jsonb WHERE result->>'id' IN(SELECT id::text FROM journeys WHERE purge_at<=now() OR expires_at<=now())`,
    );
    await this.pool.query(
      "UPDATE journeys SET route=NULL,geometry=NULL,progress=NULL,status='CLOSED' WHERE (purge_at<=now() OR expires_at<=now()) AND route IS NOT NULL",
    );
    await this.pool.query('DELETE FROM route_options WHERE expires_at<now()');
    await this.pool.query("DELETE FROM idempotency WHERE created_at<now()-interval '24 hours'");
  }
}
