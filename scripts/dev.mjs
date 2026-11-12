import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { root, npm, npmRun } from './lib.mjs';
if (!existsSync(path.join(root, '.env'))) throw new Error('Run npm run setup first.');
await npmRun('run', 'build', '-w', '@vsafe/contracts');
await npmRun('run', 'build', '-w', '@vsafe/platform');
const children = [];
for (const name of [
  'incident-reporting',
  'route-planning',
  'risk-assessment',
  'journey-alerts',
  'gateway',
]) {
  const p = spawn(process.execPath, [npm, 'run', 'dev', '-w', `@vsafe/${name}`], {
    cwd: root,
    env: { ...process.env, VSAFE_ROOT: root },
    windowsHide: true,
    stdio: 'inherit',
  });
  children.push(p);
  p.on('error', (e) => console.error(name, e.message));
}
const close = () => {
  for (const p of children) p.kill();
  process.exit();
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
