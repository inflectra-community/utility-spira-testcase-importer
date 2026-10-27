/**
 * Web UI settings store.
 *
 * Persists connection + LLM settings to data/settings.json so the single user
 * doesn't have to re-enter them each session. This is an internal tool; the
 * API key is stored in plaintext locally (same trust level as a .env file).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const SETTINGS_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

export interface AppSettings {
  spira: {
    baseUrl: string;
    username: string;
    apiKey: string;
    projectId: number;
  };
  llm: {
    provider: 'bedrock' | 'openai' | 'anthropic';
    model: string;
    apiKey?: string;
    region?: string;
  };
  import: {
    rootFolder?: string;
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  spira: { baseUrl: '', username: '', apiKey: '', projectId: 0 },
  llm: { provider: 'bedrock', model: 'amazon.nova-lite-v1:0', region: 'us-east-1' },
  import: {},
};

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      return {
        spira: { ...DEFAULT_SETTINGS.spira, ...raw.spira },
        llm: { ...DEFAULT_SETTINGS.llm, ...raw.llm },
        import: { ...DEFAULT_SETTINGS.import, ...raw.import },
      };
    }
  } catch {
    // fall through to defaults
  }
  return structuredClone(DEFAULT_SETTINGS);
}

export function saveSettings(settings: AppSettings): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

export function isConfigured(s: AppSettings): boolean {
  return !!(s.spira.baseUrl && s.spira.username && s.spira.apiKey && s.spira.projectId > 0);
}

/** Masks the API key for safe display in the UI. */
export function maskedSettings(s: AppSettings): AppSettings {
  return {
    ...s,
    spira: { ...s.spira, apiKey: s.spira.apiKey ? '********' : '' },
    llm: { ...s.llm, apiKey: s.llm.apiKey ? '********' : undefined },
  };
}
