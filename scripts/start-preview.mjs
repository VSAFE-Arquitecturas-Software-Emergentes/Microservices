import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { root, npm, background, waitFor } from './lib.mjs';
const processes = [];
for (const [name, port] of [
  ['incident-reporting', 3103],
  ['route-planning', 3101],
  ['risk-assessment', 3102],
  ['journey-alerts', 3104],
  ['gateway', 3100],
]) {
  try {
    await waitFor(`http://127.0.0.1:${port}/health/live`, 500);
  } catch {
    const pid = await background(
      name,
      process.execPath,
      [path.join(root, 'services', name, 'dist', 'main.js')],
      { ...process.env, VSAFE_ROOT: root },
    );
    processes.push({ name, pid });
    await waitFor(`http://127.0.0.1:${port}/health/ready`);
  }
}
await writeFile(path.join(root, '.local', 'preview-processes.json'), JSON.stringify(processes));
console.log('API: http://localhost:3100/docs');
