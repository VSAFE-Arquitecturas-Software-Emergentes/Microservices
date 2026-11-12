import { test } from 'node:test';

import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';

import path from 'node:path';

import { JourneyPolicy } from '../services/route-planning/src/domain/journey';

import { JourneyAggregate } from '../services/route-planning/src/domain/journey-aggregate';

import { IncidentAggregate } from '../services/incident-reporting/src/domain/incident-aggregate';

import { RiskAssessmentAggregate } from '../services/risk-assessment/src/domain/risk-assessment';

import { RiskService } from '../services/risk-assessment/src/application/risk-service';

import { ReportPolicy } from '../services/incident-reporting/src/domain/report-policy';

import { RiskPolicy } from '../services/risk-assessment/src/domain/risk-policy';

import { AlertPolicy } from '../services/journey-alerts/src/domain/alert-policy';

import { targetFor } from '../services/gateway/src/application/routing';

import {
  canonical,
  commitment,
} from '../services/incident-reporting/src/infrastructure/pg-reports';

test('journey aggregate preserves lifecycle and version invariants', () => {
  const j = new JourneyAggregate('id', 'owner', 1, 'ACTIVE', 'route-a');
  j.selectRoute('route-b', 1);
  assert.equal(j.version, 2);
  assert.throws(() => j.selectRoute('route-c', 1), /VERSION_CONFLICT/);
  assert.equal(j.close(), true);
  assert.equal(j.close(), false);
  assert.throws(() => j.selectRoute('route-d', 3), /VERSION_CONFLICT/);
});

test('duplicate incident never publishes; expiry advances one version', () => {
  const d = new IncidentAggregate('d', 'THEFT', '2026-11-11T00:00:00Z', 'original');
  assert.equal(d.publishesIncident, false);
  const i = new IncidentAggregate('i', 'THEFT', '2026-11-11T00:00:00Z', null);
  assert.equal(i.expire(Date.parse('2026-11-11T07:00:00Z')), true);
  assert.equal(i.version, 2);
  assert.equal(i.expire(Date.now()), false);
});

test('comparison cannot mix model versions or give UNKNOWN a score', () => {
  const a = new RiskAssessmentAggregate('v1');
  assert.throws(() => a.add('a', { methodVersion: 'v2', score: 0, level: 'LOW' }), /MIXED/);
  assert.throws(() => a.add('a', { methodVersion: 'v1', score: 0, level: 'UNKNOWN' }), /NO_SCORE/);
  assert.throws(() => a.complete(1), /INCOMPLETE/);
});

test('synthetic ONNX metadata is rejected outside explicitly enabled demo', async () => {
  const repo = {
    evidence: async () => ({
      samples: 10,
      severe: 2,
      recent: 3,
      coverage: 1,
      syncedAt: Date.now(),
    }),
    saveMetadata: async () => {},
    apply: async () => {},
    reconcile: async () => {},
  };
  let predicted = false;
  const model = {
    metadata: () => ({ version: 'synthetic', validated: true, synthetic: true }),
    predict: async () => {
      predicted = true;
      return 0.2;
    },
  };
  const r = await new RiskService(repo, model).assess([
    {
      id: 'route',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    },
  ]);
  assert.equal(r.route.level, 'UNKNOWN');
  assert.equal(r.route.cause, 'MODEL_NOT_VALIDATED');
  assert.equal(predicted, false);
});

test('an old route version cannot overwrite a newer selection', () => {
  assert.equal(JourneyPolicy.canChange('ACTIVE', 2, 1), false);
  assert.equal(JourneyPolicy.canChange('ACTIVE', 2, 2), true);
  assert.equal(JourneyPolicy.canChange('CLOSED', 2, 2), false);
});

test('progress rejects stale or future samples and invalid segments', () => {
  const now = Date.now();
  const p = { segmentIndex: 0, fractionAlong: 0.4, observedAt: new Date(now).toISOString() };
  assert.equal(JourneyPolicy.validProgress(p, 3, now), true);
  assert.equal(
    JourneyPolicy.validProgress({ ...p, observedAt: new Date(now - 61000).toISOString() }, 3, now),
    false,
  );
  assert.equal(JourneyPolicy.validProgress({ ...p, segmentIndex: 3 }, 3, now), false);
});

test('remaining geometry starts at the observed progress', () => {
  assert.deepEqual(
    JourneyPolicy.remaining(
      [
        [0, 0],
        [2, 0],
        [3, 1],
      ],
      { segmentIndex: 0, fractionAlong: 0.5, observedAt: '' },
    ),
    [
      [1, 0],
      [2, 0],
      [3, 1],
    ],
  );
});

test('missing reports never mean low risk', () => {
  assert.equal(
    RiskPolicy.unknownCause({ samples: 0, ratio: 1, syncedAt: Date.now(), validatedModel: true }),
    'INSUFFICIENT_SAMPLES',
  );
});

test('stale projection and unvalidated model abstain', () => {
  assert.equal(
    RiskPolicy.unknownCause({ samples: 10, ratio: 1, syncedAt: 0, validatedModel: true }),
    'STALE_PROJECTION',
  );
  assert.equal(
    RiskPolicy.unknownCause({ samples: 10, ratio: 1, syncedAt: Date.now(), validatedModel: false }),
    'MODEL_NOT_VALIDATED',
  );
  assert.equal(
    RiskPolicy.unknownCause({
      samples: 10,
      ratio: 0.1,
      syncedAt: Date.now(),
      validatedModel: true,
    }),
    'INSUFFICIENT_COVERAGE',
  );
});

test('alert requires metric proximity, fresh progress and an active lease', () => {
  const now = Date.now();
  assert.equal(AlertPolicy.relevant(100, now + 1000, now, now + 1000, now), true);
  assert.equal(AlertPolicy.relevant(201, now + 1000, now, now + 1000, now), false);
  assert.equal(AlertPolicy.relevant(100, now + 1000, now - 61000, now + 1000, now), false);
  assert.equal(AlertPolicy.relevant(100, now + 1000, now, now - 1, now), false);
});

test('observation rejects future and old times; retention starts at observation', () => {
  const now = Date.now();
  assert.equal(ReportPolicy.validObservation(new Date(now + 120000).toISOString(), now), false);
  assert.equal(
    ReportPolicy.validObservation(new Date(now - 25 * 3600000).toISOString(), now),
    false,
  );
  assert.equal(
    ReportPolicy.expiresAt('THEFT', '2026-11-11T10:00:00Z').toISOString(),
    '2026-11-11T16:00:00.000Z',
  );
});

test('approximate reporting coordinates removes excess precision', () =>
  assert.deepEqual(ReportPolicy.approximate({ lat: -12.121123, lng: -77.030345 }), {
    lat: -12.1211,
    lng: -77.0303,
  }));

test('gateway cannot proxy internal endpoints', () => {
  assert.equal(targetFor('/internal/v1/incidents/snapshot'), null);
  assert.equal(targetFor('/api/v1/journeys/a123/alerts/stream'), 'journey-alerts');
  assert.equal(targetFor('/api/v1/incident-reports/a123/audit'), 'incident-reporting');
});

test('canonical commitments survive JSONB key order and detect changes', () => {
  assert.equal(canonical({ b: 2, a: { d: 4, c: 3 } }), canonical({ a: { c: 3, d: 4 }, b: 2 }));
  assert.equal(commitment('salt', { b: 2, a: 1 }), commitment('salt', { a: 1, b: 2 }));
  assert.notEqual(commitment('salt', { a: 1 }), commitment('salt', { a: 2 }));
});

test('domain and application do not import concrete adapters or UI frameworks', () => {
  const roots = [
    'services/route-planning',
    'services/risk-assessment',
    'services/incident-reporting',
    'services/journey-alerts',
  ];
  for (const base of roots) {
    for (const layer of ['domain', 'application']) {
      const dir = base.startsWith('services') ? `${base}/src/${layer}` : `${base}/${layer}`;
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
        const text = readFileSync(path.join(dir, f), 'utf8');
        assert.doesNotMatch(
          text,
          /from ['"](?:@nestjs|pg['"]|vue['"]|.*\/infrastructure\/)/,
          `${dir}/${f}`,
        );
      }
    }
  }
});
