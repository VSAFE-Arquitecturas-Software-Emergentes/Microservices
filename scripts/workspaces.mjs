import { npmRun } from './lib.mjs';
const command = process.argv[2] || 'build';
for (const name of [
  'contracts',
  'platform',
  'gateway',
  'route-planning',
  'incident-reporting',
  'risk-assessment',
  'journey-alerts',
])
  await npmRun('run', command, '-w', `@vsafe/${name}`);
