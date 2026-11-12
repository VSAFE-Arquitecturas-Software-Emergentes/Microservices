import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { root, pause, waitFor } from './lib.mjs';
if (process.env.DATA_MODE !== 'demo')
  throw new Error('Integration writes are restricted to the isolated demo environment.');
for (const key of ['ROUTE_PLANNING', 'RISK_ASSESSMENT', 'INCIDENT_REPORTING', 'JOURNEY_ALERTS']) {
  const u = new URL(process.env[key + '_DATABASE_URL']);
  if (u.hostname !== '127.0.0.1' || u.port !== '55436')
    throw new Error('Integration targets must be isolated local databases.');
}
await waitFor('http://127.0.0.1:3100/health/ready');
const base = 'http://127.0.0.1:3100/api/v1';
const results = [];
const mark = (name) => {
  results.push({ name, status: 'passed' });
  console.log('OK', name);
};
async function client() {
  const r = await fetch(base + '/sessions');
  const data = await r.json();
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return {
    async call(route, options = {}) {
      const response = await fetch(base + route, {
        ...options,
        headers: {
          cookie,
          'content-type': 'application/json',
          'x-csrf-token': data.csrfToken,
          ...options.headers,
        },
      });
      return { response, data: await response.json() };
    },
    cookie,
    csrf: data.csrfToken,
  };
}
const a = await client(),
  b = await client();
const blocked = await fetch(base + '/routes/search', {
  method: 'POST',
  headers: { cookie: a.cookie, 'content-type': 'application/json' },
  body: '{}',
});
assert.equal(blocked.status, 403);
mark('CSRF enforced');
const origin = { lat: -12.15 + Math.random() * 0.008, lng: -77.025 + Math.random() * 0.008 },
  destination = { lat: origin.lat + 0.006, lng: origin.lng + 0.008 };
const search = await a.call('/routes/search', {
  method: 'POST',
  body: JSON.stringify({ origin, destination }),
});
assert.equal(search.response.status, 201, JSON.stringify(search.data));
assert.equal(search.data.routes.length, 3);
const withoutEvidence = await a.call('/routes/search', {
  method: 'POST',
  body: JSON.stringify({
    origin: { lat: -12.4, lng: -76.7 },
    destination: { lat: -12.39, lng: -76.69 },
  }),
});
assert.equal(withoutEvidence.data.routes[0].risk.level, 'UNKNOWN');
mark('Routes work without evidence and abstain');
const routes = search.data.routes;
const startKey = randomUUID();
const first = await a.call('/journeys', {
  method: 'POST',
  headers: { 'idempotency-key': startKey },
  body: JSON.stringify({ alternativeId: routes[0].id }),
});
assert.equal(first.response.status, 201, JSON.stringify(first.data));
const journey = first.data;
const again = await a.call('/journeys', {
  method: 'POST',
  headers: { 'idempotency-key': startKey },
  body: JSON.stringify({ alternativeId: routes[0].id }),
});
assert.equal(again.data.id, journey.id);
const conflict = await a.call('/journeys', {
  method: 'POST',
  headers: { 'idempotency-key': startKey },
  body: JSON.stringify({ alternativeId: routes[1].id }),
});
assert.equal(conflict.response.status, 409);
mark('Journey creation idempotent and conflicting payload rejected');
assert.equal((await b.call(`/journeys/${journey.id}`)).response.status, 404);
mark('Cross-session access denied');
const progress = await a.call(`/journeys/${journey.id}/progress`, {
  method: 'PATCH',
  body: JSON.stringify({
    routeVersion: 1,
    segmentIndex: 0,
    fractionAlong: 0,
    observedAt: new Date().toISOString(),
  }),
});
assert.equal(progress.response.status, 200, JSON.stringify(progress.data));
const reports = [];
for (let i = 0; i < 3; i++) {
  const coords = routes[0].geometry.coordinates[i];
  const input = {
    category: ['HARASSMENT', 'THEFT', 'OBSTRUCTION'][i],
    location: { lng: coords[0], lat: coords[1] },
    observedAt: new Date().toISOString(),
    description: 'Prueba sintética de integración.',
  };
  const key = randomUUID();
  const r = await a.call('/incident-reports', {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: JSON.stringify(input),
  });
  assert.equal(r.response.status, 201, JSON.stringify(r.data));
  reports.push(r.data);
  if (i === 0) {
    const duplicate = await a.call('/incident-reports', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify(input),
    });
    assert.equal(duplicate.data.id, r.data.id);
    const otherKey = await a.call('/incident-reports', {
      method: 'POST',
      headers: { 'idempotency-key': randomUUID() },
      body: JSON.stringify(input),
    });
    assert.equal(otherKey.data.status, 'DUPLICATE');
  }
}
mark('Report idempotency and spatial duplicate detection');
assert.equal((await b.call(`/incident-reports/${reports[0].id}/audit`)).response.status, 404);
mark('Audit ownership enforced');
let score;
for (let i = 0; i < 30; i++) {
  await pause(700);
  const r = await a.call('/routes/search', {
    method: 'POST',
    body: JSON.stringify({ origin, destination }),
  });
  score = r.data.routes?.[0]?.risk;
  if (score?.level !== 'UNKNOWN') break;
}
assert.ok(score && score.level !== 'UNKNOWN', JSON.stringify(score));
assert.ok(score.score >= 0 && score.score <= 1);
assert.equal(score.demo, true);
mark('RabbitMQ projection feeds real ONNX inference');
// Simulate restoring an older consumer checkpoint. The next heartbeat must rebuild it.
const riskDb = new pg.Pool({ connectionString: process.env.RISK_ASSESSMENT_DATABASE_URL });
await riskDb.query('DELETE FROM evidence_incidents WHERE id=$1', [reports[0].id]);
await riskDb.query(
  "UPDATE sync_checkpoints SET sequence=0,synced_at=to_timestamp(0) WHERE source='incident-reporting'",
);
let rebuilt = false;
for (let i = 0; i < 30; i++) {
  const r = await riskDb.query('SELECT 1 FROM evidence_incidents WHERE id=$1', [reports[0].id]);
  if (r.rowCount) {
    rebuilt = true;
    break;
  }
  await pause(500);
}
await riskDb.end();
assert.equal(rebuilt, true);
mark('Missing sequence reconciles from a consistent producer snapshot');
const streamController = new AbortController();
const timer = setTimeout(() => streamController.abort(), 15_000);
let alert;
try {
  const r = await fetch(base + `/journeys/${journey.id}/alerts/stream`, {
    headers: { cookie: a.cookie },
    signal: streamController.signal,
  });
  assert.equal(r.status, 200, await (r.status !== 200 ? r.text() : Promise.resolve('')));
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const reader = r.body.getReader();
  let buffer = '';
  while (!alert) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += new TextDecoder().decode(chunk.value);
    for (const block of buffer.split('\n\n')) {
      const data = block.split('\n').find((l) => l.startsWith('data: '));
      if (block.includes('event: alert') && data) {
        alert = JSON.parse(data.slice(6));
        break;
      }
    }
  }
  await reader.cancel();
} finally {
  clearTimeout(timer);
  streamController.abort();
}
assert.ok(alert);
assert.equal(alert.journeyId, journey.id);
assert.equal(
  (await a.call(`/journeys/${journey.id}/alerts/${alert.id}/ack`, { method: 'POST', body: '{}' }))
    .response.status,
  201,
);
mark('SSE delivered through gateway and acknowledged');
let audit;
for (let i = 0; i < 35; i++) {
  const r = await a.call(`/incident-reports/${reports[0].id}/audit`);
  audit = r.data;
  if (audit.versions?.[0]?.status === 'VERIFIED') break;
  await pause(1000);
}
assert.equal(audit.versions?.[0]?.status, 'VERIFIED', JSON.stringify(audit));
mark('Solidity transaction anchors and verifies actual record commitment');
const incidents = new pg.Pool({ connectionString: process.env.INCIDENT_REPORTING_DATABASE_URL });
const original = reports[0].category;
try {
  await incidents.query("UPDATE incidents SET category='ASSAULT' WHERE id=$1", [reports[0].id]);
  const r = await a.call(`/incident-reports/${reports[0].id}/audit`);
  assert.equal(r.data.versions[0].status, 'MISMATCH');
  mark('Modified record detected against blockchain');
} finally {
  await incidents.query('UPDATE incidents SET category=$2 WHERE id=$1', [reports[0].id, original]);
  await incidents.end();
}
const oldVersion = await a.call(`/journeys/${journey.id}/route`, {
  method: 'PATCH',
  body: JSON.stringify({ expectedVersion: 99, alternativeId: routes[1].id }),
});
assert.equal(oldVersion.response.status, 409);
mark('Stale route update rejected');
const routeUrl = new URL(process.env.ROUTE_PLANNING_DATABASE_URL);
routeUrl.pathname = '/risk_assessment_db';
const forbidden = new pg.Client({ connectionString: routeUrl.toString() });
await assert.rejects(
  () => forbidden.connect(),
  (e) => e.code === '42501',
);
await forbidden.end().catch(() => {});
mark('Database roles cannot connect to another service database');
assert.equal((await a.call(`/journeys/${journey.id}`, { method: 'DELETE' })).response.status, 200);
await pause(2000);
const closed = await a.call(`/journeys/${journey.id}`);
assert.equal(closed.data.status, 'CLOSED');
assert.equal(closed.data.route, null);
const routesDb = new pg.Pool({ connectionString: process.env.ROUTE_PLANNING_DATABASE_URL });
const retained = await routesDb.query(
  "SELECT result->'route' AS route FROM idempotency WHERE result->>'id'=$1",
  [journey.id],
);
assert.equal(retained.rows[0].route, null);
await routesDb.end();
mark('Journey closure and event propagation');
await mkdir(path.join(root, 'docs', 'validation'), { recursive: true });
await writeFile(
  path.join(root, 'docs', 'validation', 'integration.json'),
  JSON.stringify(
    { testedAt: new Date().toISOString(), environment: 'isolated native demo', results },
    null,
    2,
  ),
);
console.log(`${results.length} integration checks passed.`);
