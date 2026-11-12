import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from 'dotenv';
export const root = fileURLToPath(new URL('../', import.meta.url));
config({ path: path.join(root, '.env'), quiet: true });
export const npm =
  process.env.npm_execpath ||
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
export async function run(exe, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { cwd: root, windowsHide: true, stdio: 'inherit', ...options });
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(exe)} exited ${code}`)),
    );
  });
}
export const npmRun = (...args) => run(process.execPath, [npm, ...args]);
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(url, timeout = 45_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return;
    } catch {}
    await pause(500);
  }
  throw new Error(`Service not ready: ${url}`);
}
export async function background(name, exe, args = [], env = process.env, cwd = root) {
  await mkdir(path.join(root, '.local', 'logs'), { recursive: true });
  const out = await open(path.join(root, '.local', 'logs', `${name}.log`), 'a');
  const p = spawn(exe, args, {
    cwd,
    env,
    windowsHide: true,
    windowsVerbatimArguments: exe.toLowerCase().endsWith('cmd.exe'),
    detached: true,
    stdio: ['ignore', out.fd, out.fd],
  });
  p.unref();
  await out.close();
  return p.pid;
}
export async function runtime() {
  return JSON.parse(await readFile(path.join(root, '.local', 'runtime.json'), 'utf8'));
}
