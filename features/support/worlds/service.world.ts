/**
 * Service Layer World
 *
 * Tests the pipeline orchestrator with mocked Spira API and mocked LLM responses.
 * Verifies the integration between components without real network calls.
 *
 * TODO: Implement when pipeline integration tests are needed.
 * For now, this is a placeholder that inherits from LogicWorld.
 */

import { setWorldConstructor } from '@cucumber/cucumber';
import { LogicWorld } from './logic.world.js';

export class ServiceWorld extends LogicWorld {
  // Service layer overrides will go here
  // - Mock HTTP server for Spira API
  // - Canned LLM responses for mapping
  // - Full pipeline orchestration
}

setWorldConstructor(ServiceWorld);
