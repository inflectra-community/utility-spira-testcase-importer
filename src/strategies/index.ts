/**
 * Strategy registry — maps artifact type names to their strategy implementations.
 *
 * To add a new artifact type:
 * 1. Create a new strategy file (e.g., requirement.strategy.ts)
 * 2. Implement the ArtifactStrategy interface
 * 3. Register it in the STRATEGIES map below
 * 4. Add the artifact type to the CLI --artifact-type option
 */

import type { ArtifactStrategy } from '../types/strategy.js';
import { TestCaseStrategy } from './test-case.strategy.js';

/** All registered artifact strategies, keyed by their CLI name. */
const STRATEGIES: Record<string, () => ArtifactStrategy> = {
  'test-case': () => new TestCaseStrategy(),
  // Future:
  // 'requirement': () => new RequirementStrategy(),
  // 'incident': () => new IncidentStrategy(),
};

/**
 * Returns the list of supported artifact type names (for CLI help).
 */
export function getSupportedArtifactTypes(): string[] {
  return Object.keys(STRATEGIES);
}

/**
 * Creates an ArtifactStrategy instance for the given artifact type name.
 * @throws Error if the artifact type is not supported.
 */
export function createStrategy(artifactType: string): ArtifactStrategy {
  const factory = STRATEGIES[artifactType];
  if (!factory) {
    const supported = Object.keys(STRATEGIES).join(', ');
    throw new Error(
      `Unsupported artifact type "${artifactType}". Supported types: ${supported}`,
    );
  }
  return factory();
}

export { TestCaseStrategy } from './test-case.strategy.js';
