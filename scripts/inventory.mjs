import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './lib.mjs';
const excluded = new Set([
  '.git',
  'repositories',
  '.local',
  'node_modules',
  'dist',
  'artifacts',
  'cache',
  'test-results',
  'playwright-report',
  'coverage',
]);
const files = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (
      excluded.has(e.name) ||
      e.name === '.env' ||
      e.name.endsWith('.local') ||
      e.name.endsWith('.log')
    )
      continue;
    const file = path.join(dir, e.name);
    if (e.isDirectory()) await walk(file);
    else files.push(path.relative(root, file).replaceAll('\\', '/'));
  }
}
await walk(root);
if (!files.includes('docs/FILES.md')) files.push('docs/FILES.md');
files.sort();
await writeFile(
  path.join(root, 'docs', 'FILES.md'),
  '# Archivos creados en VSafe\n\nEl directorio estaba vacío antes de esta implementación. Inventario de fuentes, configuración, documentación y evidencias. Se excluyen dependencias, compilados y estado local privado (.env y .local/). No se modificó el PDF ni se generaron C4.\n\n' +
    files.map((f) => `- ${f}`).join('\n') +
    '\n',
);
console.log(`${files.length} archivos de proyecto inventariados.`);
