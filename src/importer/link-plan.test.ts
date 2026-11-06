/**
 * Tests for the Test Set link plan: members whose test case doesn't exist yet
 * are recorded, then linked (in cycle order) once it does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  addToLinkPlan,
  buildSourceKeyIndex,
  loadLinkPlan,
  resolveLinkPlan,
  saveLinkPlan,
  syncLinkPlan,
  type LinkPlan,
} from './link-plan.js';
import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

/** A fake product: test cases tagged with [Source: KEY], plus one test set's mappings. */
function fakeProduct(
  testCases: Array<{ id: number; key?: string }>,
  initiallyMapped: number[] = [],
) {
  let mapped = initiallyMapped.map((id, i) => ({
    TestSetTestCaseId: 1000 + id, TestSetId: 5, TestCaseId: id, Position: i + 1,
  }));
  const added: number[] = [];
  const positions: Array<{ testCaseId: number; position: number }> = [];

  const client = {
    getTestCasesPage: vi.fn(async (start: number, rows: number) =>
      testCases
        .slice(start - 1, start - 1 + rows)
        .map(t => ({
          testCaseId: t.id,
          name: `tc ${t.id}`,
          description: t.key ? `[Source: ${t.key}] | Created by: x` : 'no tag here',
        }))),
    getTestCaseMappings: vi.fn(async () => mapped),
    addTestCaseToSet: vi.fn(async (_setId: number, tcId: number) => {
      added.push(tcId);
      mapped = [...mapped, { TestSetTestCaseId: 1000 + tcId, TestSetId: 5, TestCaseId: tcId, Position: mapped.length + 1 }];
    }),
    updateTestCaseMapping: vi.fn(async (_setId: number, m: { TestCaseId: number; Position: number }) => {
      positions.push({ testCaseId: m.TestCaseId, position: m.Position });
      mapped = mapped.map(x => (x.TestCaseId === m.TestCaseId ? { ...x, Position: m.Position } : x));
    }),
  } as unknown as SpiraApiClient;

  /** Final position of every test case in the set, after all updates. */
  const finalPositions = () => new Map(mapped.map(m => [m.TestCaseId, m.Position]));

  return { client, added, positions, finalPositions };
}

const basePlan = (pending: string[]): LinkPlan => ({
  productId: 73,
  entries: [{
    testSetId: 5,
    testSetName: 'Cycle A',
    orderedKeys: ['JBPT-T1', 'TCP1-T9', 'JBPT-T2', 'TCP1-T8'],
    pendingKeys: pending,
    createdAt: '2026-01-01T00:00:00.000Z',
  }],
});

describe('buildSourceKeyIndex', () => {
  it('indexes test cases by their [Source: KEY] tag and ignores untagged ones', async () => {
    const { client } = fakeProduct([{ id: 11, key: 'JBPT-T1' }, { id: 12 }, { id: 13, key: 'TCP1-T9' }]);
    const idx = await buildSourceKeyIndex(client);
    expect(idx.totalTestCases).toBe(3);
    expect([...idx.byKey.keys()].sort()).toEqual(['JBPT-T1', 'TCP1-T9']);
  });

  it('pages through more test cases than one page holds', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, key: `P-T${i + 1}` }));
    const { client } = fakeProduct(many);
    const idx = await buildSourceKeyIndex(client);
    expect(idx.totalTestCases).toBe(250);
    expect(idx.byKey.size).toBe(250);
  });

  it('keeps every id when a key was imported more than once (ascending)', async () => {
    const { client } = fakeProduct([{ id: 40, key: 'TCP1-T9' }, { id: 7, key: 'TCP1-T9' }]);
    expect((await buildSourceKeyIndex(client)).byKey.get('TCP1-T9')).toEqual([7, 40]);
  });
});

describe('resolveLinkPlan', () => {
  it('links pending members whose test case now exists, and drops the entry when nothing is left', async () => {
    // JBPT-T1 (id 11) and JBPT-T2 (id 12) are already in the set; TCP1 cases now exist.
    const { client, added } = fakeProduct(
      [{ id: 11, key: 'JBPT-T1' }, { id: 12, key: 'JBPT-T2' }, { id: 21, key: 'TCP1-T9' }, { id: 22, key: 'TCP1-T8' }],
      [11, 12],
    );
    const out = await resolveLinkPlan(client, logger, basePlan(['TCP1-T9', 'TCP1-T8']));

    expect(added.sort()).toEqual([21, 22]);
    expect(out.results[0].linked.sort()).toEqual(['TCP1-T8', 'TCP1-T9']);
    expect(out.results[0].stillPending).toEqual([]);
    expect(out.plan.entries).toHaveLength(0); // fully resolved → removed
  });

  it('keeps members whose test case still does not exist (nothing is dropped)', async () => {
    const { client, added } = fakeProduct([{ id: 11, key: 'JBPT-T1' }, { id: 21, key: 'TCP1-T9' }], [11]);
    const out = await resolveLinkPlan(client, logger, basePlan(['TCP1-T9', 'TCP1-T8']));

    expect(added).toEqual([21]);
    expect(out.results[0].stillPending).toEqual(['TCP1-T8']);
    expect(out.plan.entries[0].pendingKeys).toEqual(['TCP1-T8']);
  });

  it('does nothing — and makes no Spira calls — when no entry has pending members', async () => {
    const { client } = fakeProduct([]);
    const out = await resolveLinkPlan(client, logger, { productId: 73, entries: [] });
    expect(out.results).toEqual([]);
    expect(client.getTestCasesPage).not.toHaveBeenCalled();
  });

  it('applies the FULL cycle order across old and newly linked members', async () => {
    // Set currently holds JBPT-T2 (12) then JBPT-T1 (11) — the wrong order.
    const { client, finalPositions } = fakeProduct(
      [{ id: 11, key: 'JBPT-T1' }, { id: 12, key: 'JBPT-T2' }, { id: 21, key: 'TCP1-T9' }, { id: 22, key: 'TCP1-T8' }],
      [12, 11],
    );
    await resolveLinkPlan(client, logger, basePlan(['TCP1-T9', 'TCP1-T8']));

    // Cycle order: JBPT-T1, TCP1-T9, JBPT-T2, TCP1-T8  →  ids 11, 21, 12, 22 → positions 1..4
    const finalPos = finalPositions();
    expect(finalPos.get(11)).toBe(1);
    expect(finalPos.get(21)).toBe(2);
    expect(finalPos.get(12)).toBe(3);
    expect(finalPos.get(22)).toBe(4);
  });

  it('with duplicate test cases for one key, prefers the one already in the set and warns', async () => {
    // TCP1-T9 exists twice (ids 21 and 99); 99 is already in the set.
    const { client, added } = fakeProduct(
      [{ id: 11, key: 'JBPT-T1' }, { id: 21, key: 'TCP1-T9' }, { id: 99, key: 'TCP1-T9' }],
      [11, 99],
    );
    const out = await resolveLinkPlan(client, logger, basePlan(['TCP1-T9']));

    expect(added).toEqual([]); // already linked via 99 — no second copy added
    expect(out.results[0].linked).toEqual(['TCP1-T9']);
    expect(out.results[0].warnings.some(w => w.includes('matches 2 test cases'))).toBe(true);
  });

  it('with duplicates and none in the set, links the earliest-created one', async () => {
    const { client, added } = fakeProduct([{ id: 50, key: 'TCP1-T9' }, { id: 21, key: 'TCP1-T9' }], []);
    await resolveLinkPlan(client, logger, basePlan(['TCP1-T9']));
    expect(added).toEqual([21]);
  });

  it('reports a failure for one entry without throwing, and keeps its pending members', async () => {
    const { client } = fakeProduct([{ id: 21, key: 'TCP1-T9' }], []);
    (client.addTestCaseToSet as any).mockRejectedValueOnce(new Error('boom'));
    const out = await resolveLinkPlan(client, logger, basePlan(['TCP1-T9']));

    expect(out.results[0].error).toBe('boom');
    expect(out.plan.entries[0].pendingKeys).toEqual(['TCP1-T9']);
  });

  it('keeps the whole plan intact if the product cannot be read', async () => {
    const { client } = fakeProduct([]);
    (client.getTestCasesPage as any).mockRejectedValueOnce(new Error('network down'));
    const plan = basePlan(['TCP1-T9']);
    const out = await resolveLinkPlan(client, logger, plan);

    expect(out.plan).toEqual(plan);
    expect(out.results[0].error).toBe('network down');
  });
});

describe('plan persistence + syncLinkPlan', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkplan-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('saves a plan per product, reloads it, and deletes the file when empty', () => {
    const plan = basePlan(['TCP1-T9']);
    saveLinkPlan(plan, dir);
    expect(fs.existsSync(path.join(dir, 'product-73.json'))).toBe(true);
    expect(loadLinkPlan(73, dir).entries[0].pendingKeys).toEqual(['TCP1-T9']);
    expect(loadLinkPlan(74, dir).entries).toEqual([]); // other product unaffected

    saveLinkPlan({ productId: 73, entries: [] }, dir);
    expect(fs.existsSync(path.join(dir, 'product-73.json'))).toBe(false);
  });

  it('survives a corrupt plan file instead of blocking an import', () => {
    fs.writeFileSync(path.join(dir, 'product-73.json'), '{ not json', 'utf-8');
    expect(loadLinkPlan(73, dir).entries).toEqual([]);
  });

  it('addToLinkPlan replaces an existing entry for the same test set', () => {
    let plan = addToLinkPlan({ productId: 73, entries: [] }, { testSetId: 5, testSetName: 'A', orderedKeys: ['x'], pendingKeys: ['x'] });
    plan = addToLinkPlan(plan, { testSetId: 5, testSetName: 'A', orderedKeys: ['x', 'y'], pendingKeys: ['y'] });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].pendingKeys).toEqual(['y']);
  });

  it('JBPT first, TCP1 later: records the deferred members, then a later sync links them', async () => {
    // 1) JBPT import: its cycle has 2 TCP1 members that don't exist yet.
    const first = fakeProduct([{ id: 11, key: 'JBPT-T1' }, { id: 12, key: 'JBPT-T2' }], [11, 12]);
    const s1 = await syncLinkPlan(first.client, logger, 73, [{
      testSetId: 5, testSetName: 'Cycle A',
      orderedKeys: ['JBPT-T1', 'TCP1-T9', 'JBPT-T2', 'TCP1-T8'],
      deferredKeys: ['TCP1-T9', 'TCP1-T8'],
    }], dir);

    expect(s1.deferred).toEqual([{ testSetName: 'Cycle A', keys: ['TCP1-T9', 'TCP1-T8'] }]);
    expect(s1.pendingTotal).toBe(2);
    expect(s1.planFile).toBeDefined();
    expect(loadLinkPlan(73, dir).entries[0].pendingKeys).toEqual(['TCP1-T9', 'TCP1-T8']);

    // 2) TCP1 import later: nothing deferred, but the sync completes the old plan.
    const second = fakeProduct(
      [{ id: 11, key: 'JBPT-T1' }, { id: 12, key: 'JBPT-T2' }, { id: 21, key: 'TCP1-T9' }, { id: 22, key: 'TCP1-T8' }],
      [11, 12],
    );
    const s2 = await syncLinkPlan(second.client, logger, 73, [], dir);

    expect(second.added.sort()).toEqual([21, 22]);
    expect(s2.pendingTotal).toBe(0);
    expect(s2.planFile).toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'product-73.json'))).toBe(false); // plan complete → file removed
  });

  it('TCP1 first, JBPT later: the deferred members link immediately, nothing is left pending', async () => {
    const { client, added } = fakeProduct(
      [{ id: 11, key: 'JBPT-T1' }, { id: 12, key: 'JBPT-T2' }, { id: 21, key: 'TCP1-T9' }, { id: 22, key: 'TCP1-T8' }],
      [11, 12],
    );
    const s = await syncLinkPlan(client, logger, 73, [{
      testSetId: 5, testSetName: 'Cycle A',
      orderedKeys: ['JBPT-T1', 'TCP1-T9', 'JBPT-T2', 'TCP1-T8'],
      deferredKeys: ['TCP1-T9', 'TCP1-T8'],
    }], dir);

    expect(added.sort()).toEqual([21, 22]);
    expect(s.pendingTotal).toBe(0);
    expect(s.deferred[0].keys).toHaveLength(2); // still reported as deferred by THIS import
    expect(fs.existsSync(path.join(dir, 'product-73.json'))).toBe(false);
  });

  it('does not touch the plan or Spira when this import deferred nothing and nothing is pending', async () => {
    const { client } = fakeProduct([]);
    const s = await syncLinkPlan(client, logger, 73, [{
      testSetId: 5, testSetName: 'All local', orderedKeys: ['a'], deferredKeys: [],
    }], dir);
    expect(s.pendingTotal).toBe(0);
    expect(client.getTestCasesPage).not.toHaveBeenCalled();
  });
});
