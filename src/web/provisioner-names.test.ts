/**
 * Tests for resolveProvisionerNames.
 *
 * The importer is bound to one Spira product, and the SpiraProvisioner schema
 * requires the program name to match an existing program exactly. So the names
 * come from Spira, and the export must never fabricate one.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveProvisionerNames } from './server.js';
import type { SpiraApiClient } from '../spira/client.js';

function clientReturning(info: { productName: string; programName?: string }) {
  return { getProjectInfo: vi.fn().mockResolvedValue(info) } as unknown as SpiraApiClient;
}

describe('resolveProvisionerNames', () => {
  it('returns the program and product names reported by Spira', async () => {
    const client = clientReturning({ productName: 'Real Product', programName: 'Real Program' });
    const r = await resolveProvisionerNames(client);
    expect(r).toEqual({ programName: 'Real Program', productName: 'Real Product' });
    expect(client.getProjectInfo).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error rather than inventing a program name', async () => {
    const client = clientReturning({ productName: 'Real Product' }); // program not readable
    await expect(resolveProvisionerNames(client)).rejects.toThrow(/program name/i);
  });

  it('propagates Spira lookup failures', async () => {
    const client = { getProjectInfo: vi.fn().mockRejectedValue(new Error('401')) } as unknown as SpiraApiClient;
    await expect(resolveProvisionerNames(client)).rejects.toThrow('401');
  });
});
