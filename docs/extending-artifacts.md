# Extending: New Artifact Types

The importer is designed to support any Spira artifact type via the `ArtifactStrategy` pattern. Currently only Test Cases are implemented, but the architecture supports Requirements, Incidents, Tasks, and any other artifact.

## The Strategy Interface

Each artifact type implements `ArtifactStrategy` (defined in `src/types/strategy.ts`):

```typescript
interface ArtifactStrategy {
  artifactTypeName: string;      // e.g., "TestCase", "Requirement"
  displayName: string;           // e.g., "Test Cases", "Requirements"

  getFieldDefinitions(): FieldDefinition[];
  fetchMetadata(client, projectId, templateId, logger): Promise<ArtifactMetadata>;
  getValidationRules(): ValidationRule[];
  buildCreateRequest(artifact, folderId, cpDefs, serializedProps): Record<string, unknown>;
  createArtifact(client, request): Promise<number>;
  createSubItems(client, artifactId, subItems): Promise<void>;
  getFolderSupport(): FolderSupport | null;
  getSubItemLabel(): string | null;
}
```

## Adding a New Artifact Type (e.g., Requirements)

### Step 1: Create the Strategy

Create `src/strategies/requirement.strategy.ts`:

```typescript
import type { ArtifactStrategy, FieldDefinition, ... } from '../types/strategy.js';

export class RequirementStrategy implements ArtifactStrategy {
  readonly artifactTypeName = 'Requirement';
  readonly displayName = 'Requirements';

  getFieldDefinitions(): FieldDefinition[] {
    return [
      { name: 'Name', label: 'Name', type: 'string', required: true, description: 'Requirement name' },
      { name: 'Description', label: 'Description', type: 'string', required: false, description: 'Rich text description' },
      { name: 'RequirementStatusId', label: 'Status', type: 'integer', required: false, description: 'Status ID' },
      { name: 'RequirementTypeId', label: 'Type', type: 'integer', required: false, description: 'Type ID' },
      { name: 'ImportanceId', label: 'Importance', type: 'integer', required: false, description: 'Importance/priority ID' },
      { name: 'OwnerId', label: 'Owner', type: 'integer', required: false, description: 'Owner user ID' },
      // ...
    ];
  }

  async fetchMetadata(client, projectId, templateId, logger) {
    // Call requirement-specific endpoints
    // GET /project-templates/{id}/requirements/statuses
    // GET /project-templates/{id}/requirements/types
    // GET /project-templates/{id}/requirements/importances
    // etc.
  }

  getValidationRules() {
    return [
      // Name required
      // Valid status/type/importance
    ];
  }

  async createArtifact(client, request) {
    // POST /projects/{id}/requirements
  }

  // Requirements have steps too (requirement steps)
  async createSubItems(client, artifactId, subItems) {
    // POST /projects/{id}/requirements/{id}/requirement-steps
  }

  getFolderSupport() {
    // Requirements use indent levels, not folders — return null or implement hierarchy
    return null;
  }

  getSubItemLabel() {
    return 'Requirement Steps';
  }
}
```

### Step 2: Register It

In `src/strategies/index.ts`:

```typescript
import { RequirementStrategy } from './requirement.strategy.js';

const STRATEGIES: Record<string, () => ArtifactStrategy> = {
  'test-case': () => new TestCaseStrategy(),
  'requirement': () => new RequirementStrategy(),
};
```

### Step 3: Use It

```bash
node --env-file=.env dist/cli.js --artifact-type requirement --sheet "Requirements"
```

The entire pipeline (heuristics, LLM, transform, validate, import) adapts to the new artifact type automatically.

## What Each Method Controls

| Method | Pipeline Phase | What It Does |
|--------|---------------|-------------|
| `getFieldDefinitions()` | Heuristics + Prompt | Tells the column matcher and LLM what fields exist |
| `fetchMetadata()` | Phase 2 | Calls the right API endpoints for this artifact |
| `getValidationRules()` | Phase 5 | Defines what's valid (required fields, valid lookups) |
| `buildCreateRequest()` | Phase 7 | Shapes the API POST body |
| `createArtifact()` | Phase 7 | Calls the right creation endpoint |
| `createSubItems()` | Phase 7 | Creates child items (steps, etc.) |
| `getFolderSupport()` | Phase 7 | Folder hierarchy creation (if applicable) |
| `getSubItemLabel()` | Prompt | Tells the LLM what sub-items are called |

## Heuristics Adapt Automatically

The column matcher uses `fieldDefinitions` to know what target fields exist. So a Requirement strategy that defines `ImportanceId` will cause the matcher to recognise "Importance" as an alias without any code changes to the heuristics module.

Custom property matching works identically — it's based on the template metadata, not the artifact type.
