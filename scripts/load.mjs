import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { root, pause } from './lib.mjs';
if (process.env.DATA_MODE !== 'demo')
  throw new Error('This load scenario is for isolated demo data only.');
const base = 'http://127.0.0.1:3100/api/v1';
const clients = await Promise.all(
  Array.from({ length: 50 }, async () => {
    const r = await fetch(base + '/sessions');
    const s = await r.json();
    return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: s.csrfToken };
  }),
);
const tasks = [];
for (const client of clients) {
  tasks.push(
    (async () => {
      const start = performance.now();
      const r = await fetch(base + '/routes/search', {
        method: 'POST',
        headers: {
          cookie: client.cookie,
          'x-csrf-token': client.csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          origin: { lat: -12.1211, lng: -77.0303 },
          destination: { lat: -12.1267, lng: -77.0369 },
        }),
        signal: AbortSignal.timeout(7000),
      });
      await r.json();
      return { ms: performance.now() - start, ok: r.ok };
    })(),
  );
  await pause(200);
}
const responses = await Promise.all(tasks);
const sorted = responses.map((r) => r.ms).sort((a, b) => a - b);
const pool = new pg.Pool({ connectionString: process.env.INCIDENT_REPORTING_DATABASE_URL });
const dataset = await pool.query('SELECT count(*)::int AS count FROM incidents');
await pool.end();
const result = {
  testedAt: new Date().toISOString(),
  environment: 'native local demo',
  sessions: 50,
  requests: 50,
  arrivalRatePerSecond: 5,
  incidentRows: dataset.rows[0].count,
  p95ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  p99ms: sorted[Math.ceil(sorted.length * 0.99) - 1],
  successRate: responses.filter((r) => r.ok).length / responses.length,
  scope:
    'Synthetic routes and small demo dataset. Not the 100000-incident full pilot or external Mapbox performance.',
};
await writeFile(
  path.join(root, 'docs', 'validation', 'load.json'),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (result.p95ms > 4000 || result.successRate < 0.99) process.exitCode = 1;
