/**
 * ArtifactStrategy — the extensibility abstraction.
 *
 * Each Spira artifact type (TestCase, Requirement, Incident, etc.) provides
 * a strategy implementation that tells the pipeline how to:
 * - Describe its standard fields (for LLM prompt construction)
 * - Fetch artifact-specific metadata from the Spira API
 * - Define validation rules
 * - Build API creation requests from transformed data
 * - Handle sub-items (test steps, requirement steps, etc.)
 *
 * The pipeline, transformer, validator, importer, and prompt builder are all
 * parameterized by the strategy — they don't know what artifact type they're
 * processing.
 */

import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';
import type { CustomPropertyDefinition, CustomListValue, ProjectUser, Component } from './spira.js';
import type { ValidationError } from './validation.js';
import type { RemoteCustomProperty } from './import.js';

// --- Generic transformed artifact (replaces TransformedTestCase at the boundary) ---

/**
 * A single sub-item belonging to an artifact (e.g., test step, requirement step).
 */
export interface TransformedSubItem {
  description: string;
  expectedResult?: string;
  sampleData?: string;
  position: number;
}

/**
 * A generic transformed artifact produced by the transformer.
 * The `fields` map holds standard field values keyed by their canonical field name.
 * Custom properties and sub-items are stored separately.
 */
export interface TransformedArtifact {
  sourceRowIndex: number;
  name: string;
  fields: Record<string, string | number | boolean | null>;
  customProperties: { propertyNumber: number; value: string | number | boolean | null }[];
  subItems: TransformedSubItem[];
  folderPath?: string;
  tags?: string;
}

// --- Field definitions (what the strategy publishes for prompts and transformation) ---

/**
 * Describes a standard field on the artifact type.
 */
export interface FieldDefinition {
  /** The canonical field name as it appears in the Spira API request (e.g., "Name", "Description") */
  name: string;
  /** Human-readable label for the LLM prompt */
  label: string;
  /** Data type hint */
  type: 'string' | 'integer' | 'boolean' | 'date' | 'integer[]';
  /** Whether this field is required for the artifact to be valid */
  required: boolean;
  /** Brief description for the LLM */
  description: string;
}

/**
 * A lookup table the strategy provides for a given field — maps IDs to names.
 * Used in prompt generation so the LLM can see available values.
 */
export interface FieldLookup {
  fieldName: string;
  label: string;
  entries: { id: number; name: string; active: boolean }[];
}

// --- Validation rule interface ---

/**
 * A validation rule that checks a single transformed artifact.
 * Returns an array of issues (empty if valid).
 */
export type ValidationRule = (
  artifact: TransformedArtifact,
  metadata: ArtifactMetadata,
) => ValidationError[];

// --- Artifact-specific metadata ---

/**
 * Metadata retrieved from Spira that's specific to the artifact type.
 * Extends the base template metadata with artifact-specific lookups.
 */
export interface ArtifactMetadata {
  projectId: number;
  templateId: number;
  customProperties: CustomPropertyDefinition[];
  customLists: Map<number, CustomListValue[]>;
  users: ProjectUser[];
  components: Component[];
  /** Artifact-specific lookups (priorities, statuses, types, severity, etc.) */
  lookups: FieldLookup[];
  /** Existing folder-like containers for this artifact type */
  existingFolders: { id: number; name: string; parentId?: number; indentLevel: string }[];
}

// --- The Strategy interface ---

/**
 * An ArtifactStrategy provides all the artifact-specific behavior needed
 * by the generic pipeline components.
 */
export interface ArtifactStrategy {
  /** The Spira artifact type name (e.g., "TestCase", "Requirement", "Incident") */
  readonly artifactTypeName: string;

  /** Human-readable display name (e.g., "Test Cases", "Requirements") */
  readonly displayName: string;

  /** Returns the standard field definitions for this artifact type */
  getFieldDefinitions(): FieldDefinition[];

  /**
   * Fetches artifact-specific metadata from Spira.
   * This includes priorities/statuses/types (whatever applies to this artifact)
   * plus custom properties and list values.
   */
  fetchMetadata(client: SpiraApiClient, projectId: number, templateId: number, logger: Logger): Promise<ArtifactMetadata>;

  /** Returns validation rules specific to this artifact type */
  getValidationRules(): ValidationRule[];

  /**
   * Builds the API creation request body from a transformed artifact.
   * Returns an opaque object ready to POST to the Spira API.
   */
  buildCreateRequest(
    artifact: TransformedArtifact,
    folderId: number | null,
    customPropertyDefinitions: CustomPropertyDefinition[],
    serializedProperties: RemoteCustomProperty[],
  ): Record<string, unknown>;

  /**
   * Creates the artifact in Spira and returns the created artifact's ID.
   */
  createArtifact(client: SpiraApiClient, request: Record<string, unknown>): Promise<number>;

  /**
   * Creates sub-items (test steps, requirement steps, etc.) for an artifact.
   * No-op if the artifact type doesn't support sub-items.
   */
  createSubItems(client: SpiraApiClient, artifactId: number, subItems: TransformedSubItem[]): Promise<void>;

  /**
   * Returns the folder-related API methods for this artifact type.
   * Returns null if the artifact type doesn't support folder hierarchy.
   */
  getFolderSupport(): FolderSupport | null;

  /**
   * Returns the sub-item mapping label for the LLM prompt.
   * E.g., "Test Steps" for test cases. Returns null if no sub-items.
   */
  getSubItemLabel(): string | null;
}

/**
 * Folder support for an artifact type — provides methods to get/create folders.
 */
export interface FolderSupport {
  getFolders(client: SpiraApiClient): Promise<{ id: number; name: string; parentId?: number; indentLevel: string }[]>;
  createFolder(client: SpiraApiClient, name: string, parentId?: number): Promise<{ id: number; name: string }>;
}
