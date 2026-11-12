import pg from 'pg';
import { root } from './lib.mjs';
import { PgReports } from '../services/incident-reporting/dist/infrastructure/pg-reports.js';
if (process.env.DATA_MODE !== 'demo')
  throw new Error('Synthetic seed is restricted to DATA_MODE=demo.');
const pool = new pg.Pool({ connectionString: process.env.INCIDENT_REPORTING_DATABASE_URL });
const repo = new PgReports(pool);
const points = [
  [-12.1211, -77.0303],
  [-12.1228, -77.0325],
  [-12.1248, -77.0344],
  [-12.1267, -77.0369],
  [-12.123, -77.0302],
  [-12.128, -77.0304],
  [-12.116, -77.034],
  [-12.113, -77.0355],
];
const hour = new Date().toISOString().slice(0, 13);
for (let i = 0; i < points.length; i++) {
  const [lat, lng] = points[i];
  await repo.create(
    'demo-dataset',
    {
      category: i % 3 === 0 ? 'THEFT' : i % 3 === 1 ? 'OBSTRUCTION' : 'HARASSMENT',
      location: { lat, lng },
      observedAt: new Date(Date.parse(hour + ':00:00Z') - 20 * 60000 - i * 60000).toISOString(),
      description: 'Dato sintético para demostración académica.',
    },
    `seed-v2-${hour}-${i}`,
  );
}
await pool.end();
console.log('Incidentes sintéticos preparados en incident_reporting_db.');
