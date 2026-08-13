// gif.js ships its worker as a separate file that must be served over HTTP.
// Next cannot bundle it (it is loaded via `new Worker(url)` at runtime), so we
// copy it into /public at install time.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'gif.js', 'dist', 'gif.worker.js');
const destDir = join(root, 'public');
const dest = join(destDir, 'gif.worker.js');

if (!existsSync(src)) {
  console.warn('[copy-gif-worker] gif.js not installed yet, skipping.');
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log('[copy-gif-worker] public/gif.worker.js written.');
