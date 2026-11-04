/**
 * Tests for resolveProvisionerNames.
 *
 * The SpiraProvisioner schema requires the program name to match an existing
 * program exactly, so the export must never fabricate a name. It uses what the
 * user typed, otherwise what Spira reports, otherwise fails loudly.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveProvisionerNames } from './server.js';
import type { SpiraApiClient } from '../spira/client.js';

function clientReturning(info: { productName: string; programName?: string }) {
  return { getProjectInfo: vi.fn().mockResolvedValue(info) } as unknown as SpiraApiClient;
}

describe('resolveProvisionerNames', () => {
  it('uses typed names as-is without calling Spira', async () => {
    const client = clientReturning({ productName: 'From Spira', programName: 'Spira Program' });
    const r = await resolveProvisionerNames(client, ' My Program ', ' My Product ');
    expect(r).toEqual({ programName: 'My Program', productName: 'My Product' });
    expect(client.getProjectInfo).not.toHaveBeenCalled();
  });

  it('fills both names from Spira when the fields are blank', async () => {
    const client = clientReturning({ productName: 'Real Product', programName: 'Real Program' });
    const r = await resolveProvisionerNames(client, '', undefined);
    expect(r).toEqual({ programName: 'Real Program', productName: 'Real Product' });
  });

  it('fills only the blank field, keeping what the user typed', async () => {
    const client = clientReturning({ productName: 'Real Product', programName: 'Real Program' });
    const r = await resolveProvisionerNames(client, 'Typed Program', '');
    expect(r).toEqual({ programName: 'Typed Program', productName: 'Real Product' });
  });

  it('throws a clear error rather than inventing a program name', async () => {
    const client = clientReturning({ productName: 'Real Product' }); // no program readable
    await expect(resolveProvisionerNames(client, '', '')).rejects.toThrow(/program name/i);
  });

  it('succeeds without a Spira lookup result for the program if the user typed it', async () => {
    const client = clientReturning({ productName: 'Real Product' });
    const r = await resolveProvisionerNames(client, 'Typed Program', '');
    expect(r).toEqual({ programName: 'Typed Program', productName: 'Real Product' });
  });
});
