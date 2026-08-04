import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

/**
 * A single structured log entry.
 */
export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
}

/**
 * A structured API request log entry.
 */
export interface ApiRequestLogEntry {
  timestamp: string;
  level: 'api';
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
}

export type AnyLogEntry = LogEntry | ApiRequestLogEntry;

/**
 * Logger interface as defined in the design document.
 */
export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  apiRequest(method: string, url: string, status: number, duration: number): void;
  persist(filePath?: string): Promise<void>;
}

/**
 * Creates the default log file path using the current ISO timestamp.
 */
function defaultLogFilePath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `import-log-${timestamp}.json`;
}

/**
 * Creates a structured logger that accumulates entries in memory
 * and can persist them to a JSON file.
 *
 * - info messages are written to stdout for real-time visibility
 * - warn and error messages are written to stderr
 * - All entries are stored in memory and flushed to disk via persist()
 */
export function createLogger(): Logger {
  const entries: AnyLogEntry[] = [];

  function info(message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      ...(context !== undefined && { context }),
    };
    entries.push(entry);
    process.stdout.write(`[INFO] ${message}\n`);
  }

  function warn(message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      ...(context !== undefined && { context }),
    };
    entries.push(entry);
    process.stderr.write(`[WARN] ${message}\n`);
  }

  function error(message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      ...(context !== undefined && { context }),
    };
    entries.push(entry);
    process.stderr.write(`[ERROR] ${message}\n`);
  }

  function apiRequest(method: string, url: string, status: number, duration: number): void {
    const entry: ApiRequestLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'api',
      method,
      url,
      statusCode: status,
      durationMs: duration,
    };
    entries.push(entry);
    process.stdout.write(`[API] ${method} ${url} → ${status} (${duration}ms)\n`);
  }

  async function persist(filePath?: string): Promise<void> {
    const outputPath = filePath ?? defaultLogFilePath();
    const dir = dirname(outputPath);
    if (dir && dir !== '.') {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(outputPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  return { info, warn, error, apiRequest, persist };
}

/**
 * Provides read access to accumulated entries for testing purposes.
 */
export function createTestableLogger(): Logger & { getEntries(): AnyLogEntry[] } {
  const entries: AnyLogEntry[] = [];

  function info(message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      ...(context !== undefined && { context }),
    };
    entries.push(entry);
    process.stdout.write(`[INFO] ${message}\n`);
  }

  function warn(message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      ...(context !== undefined && { context }),
    };
    entries.push(entry);
    process.stderr.write(`[WARN] ${message}\n`);
  }

  function error(message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      ...(context !== undefined && { context }),
    };
    entries.push(entry);
    process.stderr.write(`[ERROR] ${message}\n`);
  }

  function apiRequest(method: string, url: string, status: number, duration: number): void {
    const entry: ApiRequestLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'api',
      method,
      url,
      statusCode: status,
      durationMs: duration,
    };
    entries.push(entry);
    process.stdout.write(`[API] ${method} ${url} → ${status} (${duration}ms)\n`);
  }

  async function persist(filePath?: string): Promise<void> {
    const outputPath = filePath ?? defaultLogFilePath();
    const dir = dirname(outputPath);
    if (dir && dir !== '.') {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(outputPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  return { info, warn, error, apiRequest, persist, getEntries: () => entries };
}
