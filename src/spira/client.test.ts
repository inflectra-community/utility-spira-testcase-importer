/**
 * Unit tests for the Spira API HTTP client.
 * Tests cover: auth header construction, authenticate() method, logging, retry logic, error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildAuthHeader, createSpiraClient, SpiraApiError } from './client.js';
import type { Logger } from '../logger/index.js';
import type { SpiraConfig } from '../types/config.js';

// --- Test helpers ---

function createMockLogger(): Logger & { calls: { method: string; args: unknown[] }[] } {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    info(message, context) { calls.push({ method: 'info', args: [message, context] }); },
    warn(message, context) { calls.push({ method: 'warn', args: [message, context] }); },
    error(message, context) { calls.push({ method: 'error', args: [message, context] }); },
    apiRequest(method, url, status, duration) {
      calls.push({ method: 'apiRequest', args: [method, url, status, duration] });
    },
    async persist() { /* no-op */ },
  };
}

function createTestConfig(overrides?: Partial<SpiraConfig>): SpiraConfig {
  return {
    baseUrl: 'https://spira.example.com',
    username: 'testuser',
    apiKey: 'test-api-key-123',
    projectId: 5,
    ...overrides,
  };
}

// --- Tests ---

describe('buildAuthHeader', () => {
  it('should encode username:apiKey as Base64 with Basic prefix', () => {
    const header = buildAuthHeader('admin', 'mykey123');
    // "admin:mykey123" → base64 = "YWRtaW46bXlrZXkxMjM="
    expect(header).toBe('Basic YWRtaW46bXlrZXkxMjM=');
  });

  it('should handle special characters in username and apiKey', () => {
    const header = buildAuthHeader('user@domain.com', 'key+with/special=chars');
    const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf-8');
    expect(decoded).toBe('user@domain.com:key+with/special=chars');
  });

  it('should handle empty strings', () => {
    const header = buildAuthHeader('', '');
    const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf-8');
    expect(decoded).toBe(':');
  });

  it('should handle unicode characters', () => {
    const header = buildAuthHeader('ユーザー', 'キー');
    const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf-8');
    expect(decoded).toBe('ユーザー:キー');
  });
});

describe('createSpiraClient', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let config: SpiraConfig;

  beforeEach(() => {
    mockLogger = createMockLogger();
    config = createTestConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('authenticate()', () => {
    it('should successfully authenticate when project endpoint returns 200', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ProjectId: 5,
          Name: 'My Test Project',
          ProjectTemplateId: 1,
        }),
      } as Response;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const client = createSpiraClient(config, mockLogger);
      await expect(client.authenticate()).resolves.toBeUndefined();

      // Verify fetch was called with correct URL and headers
      expect(fetch).toHaveBeenCalledWith(
        'https://spira.example.com/services/v7_0/RestService.svc/projects/5',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': buildAuthHeader('testuser', 'test-api-key-123'),
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }),
        }),
      );
    });

    it('should throw SpiraApiError on 401 with descriptive message', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const client = createSpiraClient(config, mockLogger);
      await expect(client.authenticate()).rejects.toThrow(SpiraApiError);
      await expect(client.authenticate()).rejects.toThrow(
        'Authentication failed: invalid username or API key',
      );
    });

    it('should throw SpiraApiError on 404 when project does not exist', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      } as Response;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const client = createSpiraClient(config, mockLogger);
      await expect(client.authenticate()).rejects.toThrow(SpiraApiError);
      await expect(client.authenticate()).rejects.toThrow('Resource not found');
    });

    it('should throw SpiraApiError on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const client = createSpiraClient(config, mockLogger);
      await expect(client.authenticate()).rejects.toThrow(SpiraApiError);
      await expect(client.authenticate()).rejects.toThrow('Network error connecting to Spira');
    });

    it('should strip trailing slashes from baseUrl', async () => {
      const configWithSlash = createTestConfig({ baseUrl: 'https://spira.example.com///' });
      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ProjectId: 5, Name: 'Proj', ProjectTemplateId: 1 }),
      } as Response;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const client = createSpiraClient(configWithSlash, mockLogger);
      await client.authenticate();

      expect(fetch).toHaveBeenCalledWith(
        'https://spira.example.com/services/v7_0/RestService.svc/projects/5',
        expect.anything(),
      );
    });
  });

  describe('logging', () => {
    it('should log API request with method, url, status, and duration', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ProjectId: 5, Name: 'Proj', ProjectTemplateId: 1 }),
      } as Response;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const client = createSpiraClient(config, mockLogger);
      await client.authenticate();

      const apiCalls = mockLogger.calls.filter((c) => c.method === 'apiRequest');
      expect(apiCalls.length).toBe(1);
      expect(apiCalls[0].args[0]).toBe('GET');
      expect(apiCalls[0].args[1]).toContain('/projects/5');
      expect(apiCalls[0].args[2]).toBe(200);
      expect(typeof apiCalls[0].args[3]).toBe('number');
    });

    it('should log info message before request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ProjectId: 5, Name: 'Proj', ProjectTemplateId: 1 }),
      } as Response;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const client = createSpiraClient(config, mockLogger);
      await client.authenticate();

      const infoCalls = mockLogger.calls.filter((c) => c.method === 'info');
      expect(infoCalls.some((c) => (c.args[0] as string).includes('Authenticating'))).toBe(true);
    });

    it('should log error on failed requests', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const client = createSpiraClient(config, mockLogger);
      await expect(client.authenticate()).rejects.toThrow();

      const errorCalls = mockLogger.calls.filter((c) => c.method === 'error');
      expect(errorCalls.length).toBeGreaterThan(0);
    });
  });

  describe('retry logic', () => {
    it('should retry once on 500 and succeed if retry returns 200', async () => {
      const failResponse = {
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response;

      const successResponse = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ProjectId: 5, Name: 'Proj', ProjectTemplateId: 1 }),
      } as Response;

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const client = createSpiraClient(config, mockLogger);
      await expect(client.authenticate()).resolves.toBeUndefined();

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw after retry if 500 persists', async () => {
      const failResponse = {
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(failResponse);

      const client = createSpiraClient(config, mockLogger);
      await expect(client.authenticate()).rejects.toThrow(SpiraApiError);

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 4xx errors', async () => {
      const failResponse = {
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as Response;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(failResponse);

      const client = createSpiraClient(config, mockLogger);
      await expect(client.authenticate()).rejects.toThrow(SpiraApiError);

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should log a warning before retrying', async () => {
      const failResponse = {
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      } as Response;

      const successResponse = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ProjectId: 5, Name: 'Proj', ProjectTemplateId: 1 }),
      } as Response;

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const client = createSpiraClient(config, mockLogger);
      await client.authenticate();

      const warnCalls = mockLogger.calls.filter((c) => c.method === 'warn');
      expect(warnCalls.some((c) => (c.args[0] as string).includes('retrying'))).toBe(true);
    });
  });
});
