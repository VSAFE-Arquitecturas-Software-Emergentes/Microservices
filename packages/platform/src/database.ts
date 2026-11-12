import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { IntegrationEvent } from '@vsafe/contracts';
export type Sql = Pool | PoolClient;
export function database(name: string): Pool {
  const url =
    process.env.DATABASE_URL ||
    process.env[`${name.replaceAll('-', '_').toUpperCase()}_DATABASE_URL`];
  if (!url) throw new Error(`DATABASE_URL missing for ${name}`);
  return new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    ssl:
      process.env.PGSSLMODE === 'require'
        ? { rejectUnauthorized: process.env.PGSSL_VERIFY !== 'false' }
        : undefined,
  });
}
export async function transaction<T>(pool: Pool, fn: (sql: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const value = await fn(c);
    await c.query('COMMIT');
    return value;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export async function appendEvent(
  sql: Sql,
  source: string,
  type: string,
  aggregateId: string,
  aggregateVersion: number,
  payload: Record<string, unknown>,
  correlationId = randomUUID(),
): Promise<void> {
  const event = {
    eventId: randomUUID(),
    type,
    schemaVersion: 1,
    aggregateId,
    aggregateVersion,
    occurredAt: new Date().toISOString(),
    correlationId,
    source,
    payload,
  };
  await sql.query('INSERT INTO outbox(event_id,event_type,envelope) VALUES($1,$2,$3)', [
    event.eventId,
    type,
    event,
  ]);
}
export async function withInbox(
  pool: Pool,
  event: IntegrationEvent,
  apply: (sql: PoolClient) => Promise<void>,
): Promise<void> {
  await transaction(pool, async (sql) => {
    await sql.query('SELECT pg_advisory_xact_lock(72816363)');
    const result = await sql.query(
      'INSERT INTO inbox(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id',
      [event.eventId],
    );
    if (!result.rowCount) return;
    await apply(sql);
    await sql.query(
      `INSERT INTO sync_checkpoints(source,sequence,synced_at) VALUES($1,$2,CASE WHEN $3 THEN LEAST(now(),$4::timestamptz) ELSE to_timestamp(0) END) ON CONFLICT(source) DO UPDATE SET sequence=GREATEST(sync_checkpoints.sequence,EXCLUDED.sequence),synced_at=CASE WHEN $3 THEN GREATEST(sync_checkpoints.synced_at,EXCLUDED.synced_at) ELSE sync_checkpoints.synced_at END`,
      [event.source, event.sequence, event.type === 'IncidentWatermark', event.occurredAt],
    );
  });
}
export async function projectionEvent(
  pool: Pool,
  event: IntegrationEvent,
  apply: (sql: PoolClient) => Promise<void>,
  reconcile: () => Promise<void>,
) {
  try {
    await withInbox(pool, event, async (sql) => {
      const checkpoint = await sql.query('SELECT sequence FROM sync_checkpoints WHERE source=$1', [
        event.source,
      ]);
      const processed = Number(checkpoint.rows[0]?.sequence || 0);
      if (
        event.sequence > processed + 1 ||
        (event.type === 'IncidentWatermark' && Number(event.payload.watermark) > processed)
      )
        throw new Error('PROJECTION_GAP');
      if (event.type !== 'IncidentWatermark') await apply(sql);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'PROJECTION_GAP') throw error;
    await reconcile();
    await withInbox(pool, event, async (sql) => {
      if (event.type !== 'IncidentWatermark') await apply(sql);
    });
  }
}
export const integrationSql = `
CREATE TABLE IF NOT EXISTS outbox(sequence bigserial PRIMARY KEY,event_id uuid NOT NULL UNIQUE,event_type text NOT NULL,envelope jsonb NOT NULL,published_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(sequence) WHERE published_at IS NULL;
CREATE TABLE IF NOT EXISTS inbox(event_id uuid PRIMARY KEY,processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sync_checkpoints(source text PRIMARY KEY,sequence bigint NOT NULL,synced_at timestamptz NOT NULL);
`;
