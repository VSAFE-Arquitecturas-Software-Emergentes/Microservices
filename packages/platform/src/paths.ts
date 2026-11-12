import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
export function loadEnvironment() {
  config({ path: workspacePath('.env'), quiet: true });
}
export function workspacePath(...parts: string[]) {
  let root = process.env.VSAFE_ROOT || process.cwd();
  for (let n = 0; n < 8; n++) {
    try {
      if (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name === 'vsafe')
        return path.join(root, ...parts);
    } catch {}
    const parent = path.dirname(root);
    if (parent === root) break;
    root = parent;
  }
  return path.resolve(...parts);
}
