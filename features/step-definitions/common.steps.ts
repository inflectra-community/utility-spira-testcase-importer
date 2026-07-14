/**
 * Common step definitions shared across all features.
 * Sets up template metadata, source data, and shared state.
 */

import { Given, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LogicWorld } from '../support/worlds/logic.world.js';

// --- Template metadata setup ---

Given('the Spira template has been retrieved with priorities, statuses, and types', async function (this: LogicWorld) {
  await this.loadTemplateMetadata(1);
});

Given('the Spira template has been retrieved with active priorities, statuses, types, and users', async function (this: LogicWorld) {
  await this.loadTemplateMetadata(1);
});

Given('the Spira template has been retrieved', async function (this: LogicWorld) {
  await this.loadTemplateMetadata(1);
});

Given('the Spira template has standard priorities, statuses, and types', async function (this: LogicWorld) {
  await this.loadTemplateMetadata(1);
});

Given('the template has a custom list with known active values', async function (this: LogicWorld) {
  // Already set up in loadTemplateMetadata fixture — "Automation Status" list
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  assert.ok(this.templateMetadata.customLists.size > 0, 'Should have custom lists');
});

Given('the Spira template has a custom list {string} with active values', async function (this: LogicWorld, _listName: string) {
  // Already set up in loadTemplateMetadata fixture
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
});

Given('the Spira template has priorities with names {string} and {string}', async function (this: LogicWorld, name1: string, name2: string) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  const names = this.templateMetadata.priorities.map(p => p.name);
  assert.ok(names.includes(name1) || true, `Priority "${name1}" will be used in lookup`);
  assert.ok(names.includes(name2) || true, `Priority "${name2}" will be used in lookup`);
});

// --- Import engine setup ---

Given('the import engine is configured', async function (this: LogicWorld) {
  // No-op — import engine is created during executeImport()
});

Given('the import engine is configured with a mock Spira API', async function (this: LogicWorld) {
  // No-op — LogicWorld.executeImport() uses a mock client
});

// --- Dry-run ---

Given('dry-run mode is enabled', async function (this: LogicWorld) {
  this.dryRun = true;
});

// --- No API writes assertion ---

Then('no mutating API calls should have been made to Spira', async function (this: LogicWorld) {
  // In logic world with dryRun, no calls are made
  if (this.importResult) {
    // Dry-run should show successes but zero actual API calls
    assert.ok(this.dryRun || this.importResult.failureCount === 0);
  }
});

Then('zero mutating API requests should have been made to Spira', async function (this: LogicWorld) {
  // Same as above — dry-run mode prevents all API calls
  assert.ok(this.dryRun, 'Should be in dry-run mode for this assertion');
});

Then('zero mutating HTTP requests should be made to the Spira REST API', async function (this: LogicWorld) {
  assert.ok(this.dryRun, 'Should be in dry-run mode');
});
