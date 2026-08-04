/**
 * TestCaseStrategy — ArtifactStrategy implementation for Spira Test Cases.
 *
 * Encapsulates all test-case-specific behavior:
 * - Field definitions (Name, Description, Priority, Status, Type, Owner, Components, Tags)
 * - Metadata fetching (priorities, statuses, types + custom properties + users + components)
 * - Validation rules (required Name, valid status/type/priority/owner, custom list values)
 * - API request building and creation
 * - Test step sub-items
 * - Test case folder hierarchy
 */

import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';
import type { CustomPropertyDefinition, CustomListValue } from '../types/spira.js';
import type { ValidationError } from '../types/validation.js';
import type { RemoteCustomProperty, CreateTestStepRequest } from '../types/import.js';
import type {
  ArtifactStrategy,
  ArtifactMetadata,
  FieldDefinition,
  FieldLookup,
  FolderSupport,
  TransformedArtifact,
  TransformedSubItem,
  ValidationRule,
} from '../types/strategy.js';

// --- Field Definitions ---

const TEST_CASE_FIELDS: FieldDefinition[] = [
  {
    name: 'Name',
    label: 'Name',
    type: 'string',
    required: true,
    description: 'The test case name/title',
  },
  {
    name: 'Description',
    label: 'Description',
    type: 'string',
    required: false,
    description: 'Detailed description of the test case (HTML supported)',
  },
  {
    name: 'TestCasePriorityId',
    label: 'Priority',
    type: 'integer',
    required: false,
    description: 'Priority level ID',
  },
  {
    name: 'TestCaseStatusId',
    label: 'Status',
    type: 'integer',
    required: false,
    description: 'Status ID (default assigned if omitted)',
  },
  {
    name: 'TestCaseTypeId',
    label: 'Type',
    type: 'integer',
    required: false,
    description: 'Type ID (default assigned if omitted)',
  },
  {
    name: 'OwnerId',
    label: 'Owner',
    type: 'integer',
    required: false,
    description: 'Assigned owner user ID',
  },
  {
    name: 'ComponentIds',
    label: 'Components',
    type: 'integer[]',
    required: false,
    description: 'Associated component IDs',
  },
  {
    name: 'Tags',
    label: 'Tags',
    type: 'string',
    required: false,
    description: 'Comma-separated tags',
  },
];

// --- Validation Rules ---

function requiredNameRule(artifact: TransformedArtifact): ValidationError[] {
  if (!artifact.name || artifact.name.trim().length === 0) {
    return [{
      rowIndex: artifact.sourceRowIndex,
      field: 'Name',
      message: 'Name is required and must not be empty',
      severity: 'error',
    }];
  }
  return [];
}

function validStatusRule(artifact: TransformedArtifact, metadata: ArtifactMetadata): ValidationError[] {
  const statusId = artifact.fields['TestCaseStatusId'];
  if (statusId == null) return [];

  const lookup = metadata.lookups.find(l => l.fieldName === 'TestCaseStatusId');
  if (!lookup) return [];

  const valid = lookup.entries.find(e => e.id === statusId);
  if (!valid) {
    return [{
      rowIndex: artifact.sourceRowIndex,
      field: 'TestCaseStatusId',
      message: `Status ID ${statusId} does not match any valid status in the template`,
      severity: 'error',
    }];
  }
  return [];
}

function validTypeRule(artifact: TransformedArtifact, metadata: ArtifactMetadata): ValidationError[] {
  const typeId = artifact.fields['TestCaseTypeId'];
  if (typeId == null) return [];

  const lookup = metadata.lookups.find(l => l.fieldName === 'TestCaseTypeId');
  if (!lookup) return [];

  const valid = lookup.entries.find(e => e.id === typeId);
  if (!valid) {
    return [{
      rowIndex: artifact.sourceRowIndex,
      field: 'TestCaseTypeId',
      message: `Type ID ${typeId} does not match any valid type in the template`,
      severity: 'error',
    }];
  }
  return [];
}

function validPriorityRule(artifact: TransformedArtifact, metadata: ArtifactMetadata): ValidationError[] {
  const priorityId = artifact.fields['TestCasePriorityId'];
  if (priorityId == null) return [];

  const lookup = metadata.lookups.find(l => l.fieldName === 'TestCasePriorityId');
  if (!lookup) return [];

  const valid = lookup.entries.find(e => e.id === priorityId && e.active);
  if (!valid) {
    return [{
      rowIndex: artifact.sourceRowIndex,
      field: 'TestCasePriorityId',
      message: `Priority ID ${priorityId} does not match any active priority in the template`,
      severity: 'error',
    }];
  }
  return [];
}

function validOwnerRule(artifact: TransformedArtifact, metadata: ArtifactMetadata): ValidationError[] {
  const ownerId = artifact.fields['OwnerId'];
  if (ownerId == null) return [];

  const valid = metadata.users.find(u => u.userId === ownerId && u.active);
  if (!valid) {
    return [{
      rowIndex: artifact.sourceRowIndex,
      field: 'OwnerId',
      message: `Owner ID ${ownerId} does not match any active project member`,
      severity: 'error',
    }];
  }
  return [];
}

// --- Strategy Implementation ---

export class TestCaseStrategy implements ArtifactStrategy {
  readonly artifactTypeName = 'TestCase';
  readonly displayName = 'Test Cases';

  getFieldDefinitions(): FieldDefinition[] {
    return TEST_CASE_FIELDS;
  }

  async fetchMetadata(
    client: SpiraApiClient,
    projectId: number,
    templateId: number,
    logger: Logger,
  ): Promise<ArtifactMetadata> {
    const lookups: FieldLookup[] = [];

    // Helper for partial failure handling
    async function tryFetch<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
      try {
        return await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Failed to retrieve ${label}: ${msg}`);
        return fallback;
      }
    }

    // Fetch all artifact-specific lookups
    const [priorities, statuses, types, customProperties, users, components, folders] =
      await Promise.all([
        tryFetch('priorities', () => client.getTestCasePriorities(), []),
        tryFetch('statuses', () => client.getTestCaseStatuses(), []),
        tryFetch('types', () => client.getTestCaseTypes(), []),
        tryFetch('customProperties', () => client.getCustomProperties('TestCase'), []),
        tryFetch('users', () => client.getProjectUsers(), []),
        tryFetch('components', () => client.getComponents(), []),
        tryFetch('folders', () => client.getTestFolders(), []),
      ]);

    lookups.push({
      fieldName: 'TestCasePriorityId',
      label: 'Priorities',
      entries: priorities.map(p => ({ id: p.priorityId, name: p.name, active: p.active })),
    });

    lookups.push({
      fieldName: 'TestCaseStatusId',
      label: 'Statuses',
      entries: statuses.map(s => ({ id: s.testCaseStatusId, name: s.name, active: s.active })),
    });

    lookups.push({
      fieldName: 'TestCaseTypeId',
      label: 'Types',
      entries: types.map(t => ({ id: t.testCaseTypeId, name: t.name, active: t.active })),
    });

    // Fetch custom list values
    const customLists = new Map<number, CustomListValue[]>();
    const listProps = customProperties.filter(
      cp => (cp.customPropertyTypeId === 6 || cp.customPropertyTypeId === 7) && cp.customListId != null,
    );
    const uniqueListIds = [...new Set(listProps.map(p => p.customListId!))];

    const listResults = await Promise.all(
      uniqueListIds.map(async (listId) => {
        const values = await tryFetch(`customList(${listId})`, () => client.getCustomListValues(listId), []);
        return { listId, values };
      }),
    );
    for (const { listId, values } of listResults) {
      customLists.set(listId, values);
    }

    return {
      projectId,
      templateId,
      customProperties,
      customLists,
      users,
      components,
      lookups,
      existingFolders: folders.map(f => ({
        id: f.testCaseFolderId,
        name: f.name,
        parentId: f.parentTestCaseFolderId,
        indentLevel: f.indentLevel,
      })),
    };
  }

  getValidationRules(): ValidationRule[] {
    return [
      requiredNameRule,
      validStatusRule,
      validTypeRule,
      validPriorityRule,
      validOwnerRule,
    ];
  }

  buildCreateRequest(
    artifact: TransformedArtifact,
    folderId: number | null,
    _customPropertyDefinitions: CustomPropertyDefinition[],
    serializedProperties: RemoteCustomProperty[],
  ): Record<string, unknown> {
    const request: Record<string, unknown> = {
      Name: artifact.name,
      TestCaseStatusId: artifact.fields['TestCaseStatusId'] ?? 0,
    };

    if (artifact.fields['Description'] != null) {
      request.Description = artifact.fields['Description'];
    }
    if (artifact.fields['TestCaseTypeId'] != null) {
      request.TestCaseTypeId = artifact.fields['TestCaseTypeId'];
    }
    if (artifact.fields['TestCasePriorityId'] != null) {
      request.TestCasePriorityId = artifact.fields['TestCasePriorityId'];
    }
    if (artifact.fields['OwnerId'] != null) {
      request.OwnerId = artifact.fields['OwnerId'];
    }
    if (folderId !== null) {
      request.TestCaseFolderId = folderId;
    }
    if (artifact.fields['ComponentIds'] != null) {
      request.ComponentIds = artifact.fields['ComponentIds'];
    }
    if (artifact.tags != null) {
      request.Tags = artifact.tags;
    }
    if (serializedProperties.length > 0) {
      request.CustomProperties = serializedProperties;
    }

    return request;
  }

  async createArtifact(client: SpiraApiClient, request: Record<string, unknown>): Promise<number> {
    const response = await client.createTestCase(request as any);
    return response.TestCaseId;
  }

  async createSubItems(client: SpiraApiClient, artifactId: number, subItems: TransformedSubItem[]): Promise<void> {
    if (subItems.length === 0) return;

    const steps: CreateTestStepRequest[] = subItems.map(item => ({
      Description: item.description,
      ExpectedResult: item.expectedResult,
      SampleData: item.sampleData,
      Position: item.position,
    }));

    await client.addTestSteps(artifactId, steps);
  }

  getFolderSupport(): FolderSupport {
    return {
      async getFolders(client: SpiraApiClient) {
        const folders = await client.getTestFolders();
        return folders.map(f => ({
          id: f.testCaseFolderId,
          name: f.name,
          parentId: f.parentTestCaseFolderId,
          indentLevel: f.indentLevel,
        }));
      },
      async createFolder(client: SpiraApiClient, name: string, parentId?: number) {
        const folder = await client.createTestFolder({
          Name: name,
          ParentTestCaseFolderId: parentId,
        });
        return { id: folder.testCaseFolderId, name: folder.name };
      },
    };
  }

  getSubItemLabel(): string {
    return 'Test Steps';
  }
}
