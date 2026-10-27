/**
 * Web UI entry point — `spira-import-ui` / `node dist/web/index.js`.
 *
 * Loads a local .env (if present) before starting so that environment-based
 * credentials — notably AWS keys for the Bedrock LLM provider, which are
 * resolved via the AWS provider chain — are available to the server process.
 * Without this, launching via `npm start` (no --env-file) would leave Bedrock
 * with no credentials and the Excel mapping would silently fall back to
 * heuristic-only mode.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { startServer } from './server.js';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Non-fatal: settings can still be entered in the UI.
  }
}

startServer();
