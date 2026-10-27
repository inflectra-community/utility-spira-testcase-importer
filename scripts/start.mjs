/**
 * One-command launcher for non-developers.
 *
 *   npm start
 *
 * - Verifies the Node.js version is new enough.
 * - Builds the project if it hasn't been built yet (or if sources changed).
 * - Starts the web UI and prints the URL to open.
 *
 * The goal: a user who has only just installed Node can run `npm start`
 * and get a working browser UI without understanding the build pipeline.
 */

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

function line(msg) { process.stdout.write(msg + '\n'); }

// npm's executable name differs on Windows; invoke it directly (no shell) to
// avoid the DEP0190 shell-argument warning.
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// ── 1. Node version check ────────────────────────────────────────────────────
const [major, minor] = process.versions.node.split('.').map(Number);
const okVersion = major > 20 || (major === 20 && minor >= 6);
if (!okVersion) {
  line(`${RED}${BOLD}Your Node.js is too old.${RESET}`);
  line(`  You have:  v${process.versions.node}`);
  line(`  Required:  v20.6 or newer (v22 LTS recommended)`);
  line('');
  line(`  Download the latest from ${CYAN}https://nodejs.org${RESET} , then run ${BOLD}npm start${RESET} again.`);
  process.exit(1);
}

// ── 2. Dependencies present? ─────────────────────────────────────────────────
if (!existsSync(join(root, 'node_modules'))) {
  line(`${YELLOW}Dependencies not installed yet — running "npm install" first…${RESET}`);
  const install = spawnSync(npmCmd, ['install'], { cwd: root, stdio: 'inherit' });
  if (install.status !== 0) {
    line(`${RED}npm install failed. Please check the messages above.${RESET}`);
    process.exit(1);
  }
}

// ── 3. Build if needed ───────────────────────────────────────────────────────
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

const distEntry = join(root, 'dist', 'web', 'index.js');
let needsBuild = !existsSync(distEntry);
if (!needsBuild) {
  // Rebuild if any source file is newer than the built entry point.
  try {
    const srcNewest = newestMtime(join(root, 'src'));
    const builtAt = statSync(distEntry).mtimeMs;
    if (srcNewest > builtAt) needsBuild = true;
  } catch {
    needsBuild = true;
  }
}

if (needsBuild) {
  line(`${CYAN}Building the app (first run or sources changed)…${RESET}`);
  const build = spawnSync(npmCmd, ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) {
    line(`${RED}Build failed. Please check the messages above.${RESET}`);
    process.exit(1);
  }
}

// ── 4. Launch the web UI ─────────────────────────────────────────────────────
line('');
line(`${BOLD}${CYAN}Starting the Spira Test Case Importer…${RESET}`);
line(`When it's ready, open the address shown below in your web browser.`);
line('');

const server = spawn(process.execPath, [distEntry], { cwd: root, stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));
