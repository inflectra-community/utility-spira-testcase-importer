/**
 * Test Set link plan
 *
 * A Zephyr cycle can contain test cases that belong to another project in the
 * same export. When such a cycle is imported, those members have no Spira test
 * case yet, so they can't be linked. Dropping them would silently lose data, so
 * instead they are recorded here as a *link plan* — one entry per Test Set,
 * holding the full cycle order and the keys still waiting.
 *
 * The plan is completed whenever the missing test cases exist in the product:
 *  - automatically at the end of every real import (so importing project B
 *    finishes project A's pending links, and the other way round), and
 *  - on demand from the UI.
 *
 * Test cases are found by the `[Source: KEY]` tag the importer writes into each
 * description. The plan is stored per Spira product in `data/link-plans/`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';
import { applyOrdering } from './test-set-importer.js';

export const DEFAULT_LINK_PLAN_DIR = path.resolve(process.cwd(), 'data', 'link-plans');

/** One Test Set with members still waiting for their test case to exist. */
export interface PendingLinkEntry {
  testSetId: number;
  testSetName: string;
  /** The whole cycle in order (Zephyr keys) — used to re-apply ordering once linked. */
  orderedKeys: string[];
  /** Keys that don't have a Spira test case yet. */
  pendingKeys: string[];
  createdAt: string;
}

export interface LinkPlan {
  productId: number;
  entries: PendingLinkEntry[];
}

/** What happened to one entry during a resolve pass. */
export interface LinkResolveResult {
  testSetId: number;
  testSetName: string;
  linked: string[];
  stillPending: string[];
  warnings: string[];
  error?: string;
}

// ── Persistence ─────────────────────────────────────────────────────────────

export function linkPlanPath(productId: number, dir = DEFAULT_LINK_PLAN_DIR): string {
  return path.join(dir, `product-${productId}.json`);
}

export function loadLinkPlan(productId: number, dir = DEFAULT_LINK_PLAN_DIR): LinkPlan {
  const file = linkPlanPath(productId, dir);
  if (!fs.existsSync(file)) return { productId, entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as LinkPlan;
    return { productId, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    // A corrupt plan must not block an import; start empty (the file is rewritten on save).
    return { productId, entries: [] };
  }
}

/** Saves the plan, or removes the file when nothing is pending. */
export function saveLinkPlan(plan: LinkPlan, dir = DEFAULT_LINK_PLAN_DIR): void {
  const file = linkPlanPath(plan.productId, dir);
  if (plan.entries.length === 0) {
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(plan, null, 2), 'utf-8');
}

/** Adds (or replaces) the entry for a Test Set. */
export function addToLinkPlan(
  plan: LinkPlan,
  entry: { testSetId: number; testSetName: string; orderedKeys: string[]; pendingKeys: string[] },
): LinkPlan {
  const others = plan.entries.filter(e => e.testSetId !== entry.testSetId);
  if (entry.pendingKeys.length === 0) return { ...plan, entries: others };
  return {
    ...plan,
    entries: [...others, { ...entry, createdAt: new Date().toISOString() }],
  };
}

// ── Finding test cases by source key ────────────────────────────────────────

const SOURCE_TAG = /\[Source:\s*([^\]\s]+)\s*\]/;
const PAGE_SIZE = 100;

export interface SourceKeyIndex {
  /** Zephyr key → Spira test case ids carrying that tag (ascending). Usually one. */
  byKey: Map<string, number[]>;
  totalTestCases: number;
}

/** Pages through the product's test cases and indexes them by `[Source: KEY]`. */
export async function buildSourceKeyIndex(client: SpiraApiClient): Promise<SourceKeyIndex> {
  const byKey = new Map<string, number[]>();
  let total = 0;
  for (let start = 1; ; start += PAGE_SIZE) {
    const page = await client.getTestCasesPage(start, PAGE_SIZE);
    for (const tc of page) {
      total++;
      const key = tc.description ? SOURCE_TAG.exec(tc.description)?.[1] : undefined;
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), tc.testCaseId]);
    }
    if (page.length < PAGE_SIZE) break;
  }
  for (const ids of byKey.values()) ids.sort((a, b) => a - b);
  return { byKey, totalTestCases: total };
}

// ── Resolving the plan ──────────────────────────────────────────────────────

/**
 * Tries to link every pending member whose test case now exists.
 * Returns the updated plan (entries with nothing left are dropped) and a
 * per-entry report. Never throws for one entry's failure; it is reported.
 */
export async function resolveLinkPlan(
  client: SpiraApiClient,
  logger: Logger,
  plan: LinkPlan,
): Promise<{ plan: LinkPlan; results: LinkResolveResult[] }> {
  const results: LinkResolveResult[] = [];
  const active = plan.entries.filter(e => e.pendingKeys.length > 0);
  if (active.length === 0) return { plan: { ...plan, entries: [] }, results };

  let index: SourceKeyIndex;
  try {
    index = await buildSourceKeyIndex(client);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Link plan: could not read the product's test cases: ${message}`);
    return {
      plan,
      results: active.map(e => ({
        testSetId: e.testSetId, testSetName: e.testSetName,
        linked: [], stillPending: e.pendingKeys, warnings: [], error: message,
      })),
    };
  }

  const remaining: PendingLinkEntry[] = [];

  for (const entry of plan.entries) {
    const result: LinkResolveResult = {
      testSetId: entry.testSetId,
      testSetName: entry.testSetName,
      linked: [],
      stillPending: entry.pendingKeys,
      warnings: [],
    };

    try {
      const resolvable = entry.pendingKeys.filter(k => index.byKey.has(k));
      if (resolvable.length > 0) {
        const mapped = new Set((await client.getTestCaseMappings(entry.testSetId)).map(m => m.TestCaseId));

        // A key may match several test cases if a bundle was imported more than once.
        // Prefer one already in the set; otherwise the earliest created.
        const pick = (key: string): number | undefined => {
          const ids = index.byKey.get(key) ?? [];
          return ids.find(id => mapped.has(id)) ?? ids[0];
        };

        for (const key of resolvable) {
          const ids = index.byKey.get(key)!;
          if (ids.length > 1) {
            result.warnings.push(`"${key}" matches ${ids.length} test cases (${ids.join(', ')}) — linked #${pick(key)}.`);
          }
          const id = pick(key)!;
          if (!mapped.has(id)) {
            await client.addTestCaseToSet(entry.testSetId, id);
            mapped.add(id);
          }
          result.linked.push(key);
        }

        // Re-apply the full cycle order now that more members exist.
        const orderedIds = entry.orderedKeys
          .map(pick)
          .filter((id): id is number => id !== undefined);
        if (orderedIds.length > 1) {
          await applyOrdering(client, entry.testSetId, orderedIds, logger, result.warnings);
        }
      }

      result.stillPending = entry.pendingKeys.filter(k => !result.linked.includes(k));
      logger.info(
        `Link plan: "${entry.testSetName}" — linked ${result.linked.length}, ${result.stillPending.length} still pending.`,
      );
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      result.stillPending = entry.pendingKeys.filter(k => !result.linked.includes(k));
      logger.error(`Link plan: "${entry.testSetName}" failed: ${result.error}`);
    }

    results.push(result);
    if (result.stillPending.length > 0) {
      remaining.push({ ...entry, pendingKeys: result.stillPending });
    }
  }

  return { plan: { ...plan, entries: remaining }, results };
}

// ── One call for the import flows ───────────────────────────────────────────

/** A Test Set that was just created, with the members it couldn't link yet. */
export interface CreatedTestSetLinks {
  testSetId: number;
  testSetName: string;
  orderedKeys: string[];
  deferredKeys: string[];
}

export interface LinkSyncResult {
  /** Members recorded as waiting by THIS import. */
  deferred: Array<{ testSetName: string; keys: string[] }>;
  /** What the resolve pass linked (includes older plan entries). */
  resolved: LinkResolveResult[];
  /** Members still waiting in the plan afterwards. */
  pendingTotal: number;
  /** Where the plan is stored, when anything is pending. */
  planFile?: string;
}

/**
 * Records this import's deferred members in the product's link plan, then
 * tries to complete the plan straight away (the other project may already be
 * in the product). Persists the result.
 */
export async function syncLinkPlan(
  client: SpiraApiClient,
  logger: Logger,
  productId: number,
  created: CreatedTestSetLinks[],
  dir = DEFAULT_LINK_PLAN_DIR,
): Promise<LinkSyncResult> {
  let plan = loadLinkPlan(productId, dir);

  const deferred: LinkSyncResult['deferred'] = [];
  for (const c of created) {
    if (c.deferredKeys.length === 0) continue;
    deferred.push({ testSetName: c.testSetName, keys: c.deferredKeys });
    plan = addToLinkPlan(plan, {
      testSetId: c.testSetId,
      testSetName: c.testSetName,
      orderedKeys: c.orderedKeys,
      pendingKeys: c.deferredKeys,
    });
  }

  const outcome = await resolveLinkPlan(client, logger, plan);
  plan = outcome.plan;
  saveLinkPlan(plan, dir);

  const pendingTotal = plan.entries.reduce((n, e) => n + e.pendingKeys.length, 0);
  return {
    deferred,
    resolved: outcome.results,
    pendingTotal,
    planFile: plan.entries.length ? linkPlanPath(productId, dir) : undefined,
  };
}
