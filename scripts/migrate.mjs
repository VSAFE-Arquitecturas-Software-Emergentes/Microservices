import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root } from './lib.mjs';
import { integrationSql } from '../packages/platform/dist/database.js';
const only = process.argv[2];
for (const service of [
  'route-planning',
  'risk-assessment',
  'incident-reporting',
  'journey-alerts',
].filter((s) => !only || s === only)) {
  const url =
    only && process.env.DATABASE_URL
      ? process.env.DATABASE_URL
      : process.env[service.replaceAll('-', '_').toUpperCase() + '_DATABASE_URL'];
  if (!url) throw new Error(`Missing database URL for ${service}`);
  const pool = new pg.Pool({
    connectionString: url,
    ssl:
      process.env.PGSSLMODE === 'require'
        ? { rejectUnauthorized: process.env.PGSSL_VERIFY !== 'false' }
        : undefined,
  });
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(88263918)');
    await c.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const dir = path.join(root, 'services', service, 'migrations');
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = await readFile(path.join(dir, file), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const old = await c.query('SELECT checksum FROM schema_migrations WHERE name=$1', [file]);
      if (old.rowCount) {
        if (old.rows[0].checksum !== hash)
          throw new Error(`Applied migration changed: ${service}/${file}`);
        continue;
      }
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query(integrationSql);
        await c.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [file, hash]);
        await c.query('COMMIT');
        console.log(`${service}: ${file}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(88263918)');
    c.release();
    await pool.end();
  }
}
