import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, background, waitFor } from './lib.mjs';
const name = process.argv[2];
const ports = {
  gateway: 3100,
  'route-planning': 3101,
  'risk-assessment': 3102,
  'incident-reporting': 3103,
  'journey-alerts': 3104,
};
if (!ports[name]) throw new Error('Unknown backend service');
const file = path.join(root, '.local', 'preview-processes.json');
const rows = JSON.parse(await readFile(file, 'utf8'));
const old = rows.find((r) => r.name === name);
const entry = path.join(root, 'services', name, 'dist', 'main.js');
if (old) {
  if (process.platform === 'win32') {
    const ps = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(old.pid)}'; if ($p -and $p.CommandLine.Contains('${entry.replaceAll("'", "''")}')) { Stop-Process -Id ${Number(old.pid)} } elseif ($p) { throw 'Process does not belong to this workspace' }`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
    });
  } else process.kill(old.pid);
}
const pid = await background(name, process.execPath, [entry], { ...process.env, VSAFE_ROOT: root });
await waitFor(`http://127.0.0.1:${ports[name]}/health/ready`);
if (old) old.pid = pid;
else rows.push({ name, pid });
await writeFile(file, JSON.stringify(rows));
console.log(`Restarted ${name}`);
