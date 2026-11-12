import { Pool, PoolClient } from 'pg';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { ReportInput, Problem, Incident } from '@vsafe/contracts';
import { transaction, appendEvent } from '@vsafe/platform';
import { ReportRepository } from '../application/report-service';
import { ReportPolicy } from '../domain/report-policy';
import { IncidentAggregate } from '../domain/incident-aggregate';
export function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
      .join(',') +
    '}'
  );
}
export function commitment(salt: string, payload: unknown) {
  return (
    '0x' +
    createHash('sha256')
      .update(salt + canonical(payload))
      .digest('hex')
  );
}
export function incident(r: any): Incident {
  return {
    id: r.id,
    category: r.category,
    location: { lat: Number(r.lat), lng: Number(r.lng) },
    observedAt: r.observed_at.toISOString(),
    validUntil: r.valid_until.toISOString(),
    version: r.version,
    status: r.status,
    demo: r.demo,
  };
}
export const columns = '*,ST_Y(location::geometry) AS lat,ST_X(location::geometry) AS lng';
export async function enqueueAudit(sql: PoolClient, item: Incident) {
  const salt = randomBytes(32).toString('hex');
  const reference = '0x' + randomBytes(32).toString('hex');
  await sql.query(
    'INSERT INTO audit_records(id,incident_id,version,salt,reference,commitment,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(incident_id,version) DO NOTHING',
    [randomUUID(), item.id, item.version, salt, reference, commitment(salt, item), item],
  );
}
export class PgReports implements ReportRepository {
  constructor(private readonly pool: Pool) {}
  async create(owner: string, input: ReportInput, key: string) {
    return transaction(this.pool, async (sql) => {
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('incident-reporting-create',0))",
      );
      const hash = createHash('sha256').update(canonical(input)).digest('hex');
      const previous = await sql.query('SELECT * FROM idempotency WHERE owner_ref=$1 AND key=$2', [
        owner,
        key,
      ]);
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== hash) throw new Problem(409, 'IDEMPOTENCY_CONFLICT');
        return previous.rows[0].result;
      }
      const duplicate = await sql.query(
        "SELECT id FROM incidents WHERE category=$1 AND status='PUBLISHED' AND valid_until>now() AND abs(extract(epoch from observed_at-$4::timestamptz))<600 AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,25) LIMIT 1",
        [input.category, input.location.lng, input.location.lat, input.observedAt],
      );
      const id = randomUUID();
      const aggregate = new IncidentAggregate(
        id,
        input.category,
        input.observedAt,
        duplicate.rows[0]?.id || null,
      );
      const status = aggregate.status;
      const row = await sql.query(
        `INSERT INTO incidents(id,owner_ref,category,location,observed_at,valid_until,description,status,duplicate_of,demo) VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,$6,$7,$8,$9,$10,$11) RETURNING ${columns}`,
        [
          id,
          owner,
          input.category,
          input.location.lng,
          input.location.lat,
          input.observedAt,
          aggregate.validUntil,
          input.description,
          status,
          duplicate.rows[0]?.id || null,
          process.env.DATA_MODE === 'demo',
        ],
      );
      const item = incident(row.rows[0]);
      if (aggregate.publishesIncident)
        await appendEvent(sql, 'incident-reporting', 'IncidentPublished', id, 1, {
          incident: item,
        });
      await enqueueAudit(sql, item);
      const result = {
        ...item,
        description: input.description,
        duplicateOf: duplicate.rows[0]?.id || null,
        verification: 'COMMUNITY_UNVERIFIED',
        auditStatus: 'PENDING',
      };
      await sql.query(
        'INSERT INTO idempotency(owner_ref,key,request_hash,result) VALUES($1,$2,$3,$4)',
        [owner, key, hash, result],
      );
      return result;
    });
  }
  async list(owner: string) {
    const r = await this.pool.query(
      `SELECT ${columns} FROM incidents WHERE owner_ref=$1 ORDER BY created_at DESC LIMIT 100`,
      [owner],
    );
    return r.rows.map((r) => ({
      ...incident(r),
      description: r.description,
      duplicateOf: r.duplicate_of,
      verification: 'COMMUNITY_UNVERIFIED',
    }));
  }
  async find(owner: string, id: string) {
    const r = await this.pool.query(
      `SELECT ${columns} FROM incidents WHERE id=$1 AND owner_ref=$2`,
      [id, owner],
    );
    if (!r.rowCount) throw new Problem(404, 'REPORT_NOT_FOUND');
    return {
      ...incident(r.rows[0]),
      description: r.rows[0].description,
      duplicateOf: r.rows[0].duplicate_of,
      verification: 'COMMUNITY_UNVERIFIED',
    };
  }
  async incidents(bounds?: number[]) {
    const r = await this.pool.query(
      `SELECT ${columns} FROM incidents WHERE status='PUBLISHED' AND valid_until>now() ${bounds ? 'AND ST_Intersects(location::geometry,ST_MakeEnvelope($1,$2,$3,$4,4326))' : ''} ORDER BY observed_at DESC LIMIT 500`,
      bounds,
    );
    return r.rows.map(incident);
  }
  async snapshot() {
    return transaction(this.pool, async (sql) => {
      await sql.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const r = await sql.query(
        `SELECT ${columns} FROM incidents WHERE status='PUBLISHED' AND valid_until>now()`,
      );
      const w = await sql.query('SELECT COALESCE(max(sequence),0)::text AS sequence FROM outbox');
      return { incidents: r.rows.map(incident), watermark: Number(w.rows[0].sequence) };
    });
  }
  async expire() {
    await transaction(this.pool, async (sql) => {
      const r = await sql.query(
        `UPDATE incidents SET status='EXPIRED',version=version+1 WHERE status='PUBLISHED' AND valid_until<=now() RETURNING ${columns}`,
      );
      for (const row of r.rows) {
        const item = incident(row);
        await appendEvent(sql, 'incident-reporting', 'IncidentExpired', item.id, item.version, {
          incident: item,
        });
        await enqueueAudit(sql, item);
      }
    });
    await this.pool.query("DELETE FROM idempotency WHERE created_at<now()-interval '24 hours'");
    await this.pool.query(
      "UPDATE incidents SET owner_ref=NULL,description='' WHERE created_at<now()-interval '30 days' AND owner_ref IS NOT NULL",
    );
  }
}
