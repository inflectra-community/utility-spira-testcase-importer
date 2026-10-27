/**
 * Copies static web assets (not handled by tsc) into dist/.
 * Keeps dist/web/public alongside the compiled server so import.meta.dirname resolves.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'src/web/public');
const dest = resolve(root, 'dist/web/public');

if (!existsSync(src)) {
  console.error('No src/web/public to copy.');
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied web assets → ${dest}`);
