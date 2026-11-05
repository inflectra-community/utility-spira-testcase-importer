/**
 * Tests for applyProvisioning — the direct-to-Spira provisioner.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyProvisioning } from './apply.js';
import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';
import type { TemplateMetadata } from '../types/spira.js';
import type { ZephyrGapAnalysis } from '../pipeline-zephyr.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

function mockClient(overrides?: Partial<SpiraApiClient>): SpiraApiClient {
  return {
    addCustomListValues: vi.fn().mockResolvedValue([]),
    createCustomList: vi.fn().mockResolvedValue({ customListId: 999 }),
    createCustomProperty: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as SpiraApiClient;
}

function metadata(): TemplateMetadata {
  return {
    projectId: 1,
    templateId: 1,
    priorities: [],
    statuses: [],
    types: [],
    components: [],
    customProperties: [
      {
        customPropertyId: 1, propertyNumber: 1, name: 'Country',
        artifactTypeName: 'TestCase', customPropertyTypeId: 6, customPropertyTypeName: 'List',
        customListId: 44, isRequired: false,
      },
    ],
    customLists: new Map(),
    users: [],
    existingFolders: [],
  } as unknown as TemplateMetadata;
}

function gaps(partial: Partial<ZephyrGapAnalysis>): ZephyrGapAnalysis {
  return {
    newProperties: [],
    missingListValues: [],
    missingComponents: [],
    unprovisionableLookups: [],
    ...partial,
  };
}

describe('applyProvisioning', () => {
  it('adds missing values to an existing list property', async () => {
    const client = mockClient();
    const res = await applyProvisioning(client, {
      metadata: metadata(),
      gaps: gaps({ missingListValues: [{ propertyName: 'Country', existingValues: ['DE'], missingValues: ['HU', 'CH'], multiValued: true }] }),
    }, logger);

    expect(client.addCustomListValues).toHaveBeenCalledWith(44, ['HU', 'CH']);
    expect(res.totals.valuesAdded).toBe(2);
    expect(res.valuesAdded[0]).toEqual({ property: 'Country', values: ['HU', 'CH'] });
  });

  it('warns and skips when an existing property has no backing list', async () => {
    const md = metadata();
    md.customProperties[0].customListId = undefined;
    const client = mockClient();
    const res = await applyProvisioning(client, {
      metadata: md,
      gaps: gaps({ missingListValues: [{ propertyName: 'Country', existingValues: [], missingValues: ['HU'], multiValued: false }] }),
    }, logger);

    expect(client.addCustomListValues).not.toHaveBeenCalled();
    expect(res.totals.valuesAdded).toBe(0);
    expect(res.warnings[0]).toMatch(/no backing custom list/i);
  });

  it('creates a new list-backed property, honouring the multi-select override', async () => {
    const client = mockClient();
    const res = await applyProvisioning(client, {
      metadata: metadata(),
      gaps: gaps({ newProperties: [{ name: 'Region', uniqueValues: ['EMEA', 'APAC'], rowCount: 20, multiValued: false }] }),
      multiSelect: ['Region'], // force multilist despite multiValued=false
    }, logger);

    expect(client.createCustomList).toHaveBeenCalledWith('Region', ['APAC', 'EMEA']);
    // multilist == type 7, bound to the newly created list id.
    expect(client.createCustomProperty).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Region', customPropertyTypeId: 7, customListId: 999 }),
    );
    expect(res.propertiesCreated[0]).toMatchObject({ name: 'Region', type: 'multilist' });
  });

  it('creates a free-text property without a backing list', async () => {
    const client = mockClient();
    // Many unique, long-ish values → inferred as text, no list created.
    const uniqueValues = Array.from({ length: 40 }, (_, i) => `free text note number ${i} with detail`);
    const res = await applyProvisioning(client, {
      metadata: metadata(),
      gaps: gaps({ newProperties: [{ name: 'Notes', uniqueValues, rowCount: 40, multiValued: false }] }),
    }, logger);

    expect(client.createCustomList).not.toHaveBeenCalled();
    expect(client.createCustomProperty).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Notes', customPropertyTypeId: 1 }),
    );
    expect(res.propertiesCreated[0].type).toBe('text');
  });

  it('captures a Spira error as a warning instead of throwing', async () => {
    const client = mockClient({ addCustomListValues: vi.fn().mockRejectedValue(new Error('duplicate value')) });
    const res = await applyProvisioning(client, {
      metadata: metadata(),
      gaps: gaps({ missingListValues: [{ propertyName: 'Country', existingValues: [], missingValues: ['HU'], multiValued: false }] }),
    }, logger);

    expect(res.totals.valuesAdded).toBe(0);
    expect(res.warnings[0]).toMatch(/duplicate value/);
  });
});
