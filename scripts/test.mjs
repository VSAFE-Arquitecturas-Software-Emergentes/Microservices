import { run, root } from './lib.mjs';
import path from 'node:path';
await run(process.execPath, [
  '--import',
  'tsx',
  '--test',
  path.join(root, 'tests', 'domain.test.ts'),
]);
