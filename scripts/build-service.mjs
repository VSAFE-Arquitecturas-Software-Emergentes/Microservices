import { npmRun } from './lib.mjs';
const service = process.argv[2];
if (
  ![
    'gateway',
    'route-planning',
    'risk-assessment',
    'incident-reporting',
    'journey-alerts',
  ].includes(service)
)
  throw new Error('Unknown service');
await npmRun('run', 'build', '-w', '@vsafe/contracts');
await npmRun('run', 'build', '-w', '@vsafe/platform');
await npmRun('run', 'build', '-w', `@vsafe/${service}`);
