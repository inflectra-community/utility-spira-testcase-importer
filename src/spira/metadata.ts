/**
 * Template metadata retrieval orchestrator.
 *
 * Calls all SpiraApiClient retrieval methods and assembles a complete TemplateMetadata object.
 * Handles partial failures gracefully: reports which metadata could not be retrieved and
 * continues with remaining metadata so the pipeline can proceed with available data.
 */

import type { Logger } from '../logger/index.js';
import type { SpiraApiClient } from './client.js';
import type { SpiraConfig } from '../types/config.js';
import type {
  TemplateMetadata,
  CustomPropertyDefinition,
  CustomListValue,
  TestCasePriority,
  TestCaseStatus,
  TestCaseType,
  ProjectUser,
  Component,
  TestCaseFolder,
} from '../types/spira.js';

/**
 * Describes a metadata retrieval failure for reporting purposes.
 */
export interface MetadataRetrievalFailure {
  field: string;
  error: string;
}

/**
 * Result of a fetchAllMetadata call, including retrieved metadata and any partial failures.
 */
export interface MetadataResult {
  metadata: TemplateMetadata;
  failures: MetadataRetrievalFailure[];
}

/**
 * Fetches all template metadata from the Spira API, assembling a TemplateMetadata object.
 *
 * Handles partial failures gracefully:
 * - Each metadata category is fetched independently
 * - If a category fails, the failure is recorded and the remaining categories are still fetched
 * - Custom list values are fetched for each custom property of type list (6) or multilist (7)
 *
 * @param client - Authenticated SpiraApiClient (authenticate() must have been called)
 * @param config - Spira configuration (needed for projectId and templateId context)
 * @param templateId - The project template ID (obtained from authenticate response)
 * @param logger - Logger instance for status reporting
 * @returns MetadataResult containing the assembled metadata and any retrieval failures
 */
export async function fetchAllMetadata(
  client: SpiraApiClient,
  config: SpiraConfig,
  templateId: number,
  logger: Logger,
): Promise<MetadataResult> {
  const failures: MetadataRetrievalFailure[] = [];

  // Helper to attempt a metadata fetch and record failures
  async function tryFetch<T>(field: string, fetcher: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fetcher();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      failures.push({ field, error: errorMessage });
      logger.warn(`Failed to retrieve ${field}: ${errorMessage}`);
      return fallback;
    }
  }

  logger.info('Retrieving template metadata from Spira...');

  // Fetch all independent metadata categories in parallel
  const [priorities, statuses, types, rawCustomProperties, users, components, existingFolders] =
    await Promise.all([
      tryFetch<any[]>('priorities', () => client.getTestCasePriorities(), []),
      tryFetch<any[]>('statuses', () => client.getTestCaseStatuses(), []),
      tryFetch<any[]>('types', () => client.getTestCaseTypes(), []),
      tryFetch<any[]>(
        'customProperties',
        () => client.getCustomProperties('TestCase'),
        [],
      ),
      tryFetch<any[]>('users', () => client.getProjectUsers(), []),
      tryFetch<any[]>('components', () => client.getComponents(), []),
      tryFetch<any[]>('existingFolders', () => client.getTestFolders(), []),
    ]);

  // Normalise Spira API PascalCase responses to our camelCase internal types.
  // This is the single boundary where API shape meets our domain model.
  const normPriorities: TestCasePriority[] = priorities.map((p: any) => ({
    priorityId: p.PriorityId ?? p.priorityId,
    name: p.Name ?? p.name,
    active: p.Active ?? p.active ?? true,
    score: p.Score ?? p.score ?? 0,
  }));

  const normStatuses: TestCaseStatus[] = statuses.map((s: any) => ({
    testCaseStatusId: s.TestCaseStatusId ?? s.testCaseStatusId,
    name: s.Name ?? s.name,
    active: s.Active ?? s.active ?? true,
  }));

  const normTypes: TestCaseType[] = types.map((t: any) => ({
    testCaseTypeId: t.TestCaseTypeId ?? t.testCaseTypeId,
    name: t.Name ?? t.name,
    active: t.Active ?? t.active ?? true,
    isDefault: t.IsDefault ?? t.isDefault ?? false,
  }));

  const customProperties: CustomPropertyDefinition[] = rawCustomProperties.map((cp: any) => ({
    customPropertyId: cp.CustomPropertyId ?? cp.customPropertyId,
    propertyNumber: cp.PropertyNumber ?? cp.propertyNumber,
    name: cp.Name ?? cp.name,
    artifactTypeName: cp.ArtifactTypeName ?? cp.artifactTypeName ?? 'TestCase',
    customPropertyTypeId: cp.CustomPropertyTypeId ?? cp.customPropertyTypeId,
    customPropertyTypeName: cp.CustomPropertyTypeName ?? cp.customPropertyTypeName ?? '',
    customListId: cp.CustomList?.CustomPropertyListId ?? cp.customListId,
    isRequired: cp.IsRequired ?? cp.isRequired ?? false,
  }));

  const normUsers: ProjectUser[] = users.map((u: any) => ({
    userId: u.UserId ?? u.userId,
    fullName: u.FullName ?? u.fullName ?? '',
    userName: u.UserName ?? u.userName ?? '',
    active: u.Active ?? u.active ?? true,
  }));

  const normComponents: Component[] = components.map((c: any) => ({
    componentId: c.ComponentId ?? c.componentId,
    name: c.Name ?? c.name,
    active: c.Active ?? c.active ?? true,
  }));

  const normFolders: TestCaseFolder[] = existingFolders.map((f: any) => ({
    testCaseFolderId: f.TestCaseFolderId ?? f.testCaseFolderId,
    name: f.Name ?? f.name,
    parentTestCaseFolderId: f.ParentTestCaseFolderId ?? f.parentTestCaseFolderId,
    indentLevel: f.IndentLevel ?? f.indentLevel ?? '0',
  }));

  // Fetch custom list values for properties of type list (6) or multilist (7)
  const customLists = new Map<number, CustomListValue[]>();
  const listProperties = customProperties.filter(
    (prop) =>
      (prop.customPropertyTypeId === 6 || prop.customPropertyTypeId === 7) &&
      prop.customListId !== undefined &&
      prop.customListId !== null,
  );

  if (listProperties.length > 0) {
    logger.info(`Fetching custom list values for ${listProperties.length} list properties...`);

    // Deduplicate list IDs — multiple properties can reference the same list
    const uniqueListIds = [...new Set(listProperties.map((p) => p.customListId!))];

    const listResults = await Promise.all(
      uniqueListIds.map(async (listId) => {
        const rawValues = await tryFetch<any>(
          `customList(${listId})`,
          () => client.getCustomListValues(listId),
          [],
        );
        // API may return a list object with Values array, or the array directly
        const valueArray = Array.isArray(rawValues) ? rawValues : (rawValues?.Values ?? rawValues?.values ?? []);
        const values: CustomListValue[] = valueArray.map((v: any) => ({
          customPropertyValueId: v.CustomPropertyValueId ?? v.customPropertyValueId,
          name: v.Name ?? v.name,
          active: v.Active ?? v.active ?? true,
        }));
        return { listId, values };
      }),
    );

    for (const { listId, values } of listResults) {
      customLists.set(listId, values);
    }
  }

  const metadata: TemplateMetadata = {
    projectId: config.projectId,
    templateId,
    priorities: normPriorities,
    statuses: normStatuses,
    types: normTypes,
    customProperties,
    customLists,
    users: normUsers,
    components: normComponents,
    existingFolders: normFolders,
  };

  if (failures.length > 0) {
    logger.warn(
      `Template metadata retrieval completed with ${failures.length} failure(s): ${failures.map((f) => f.field).join(', ')}`,
    );
  } else {
    logger.info(
      `Template metadata retrieved successfully. ` +
        `${normPriorities.length} priorities, ${normStatuses.length} statuses, ${normTypes.length} types, ` +
        `${customProperties.length} custom properties, ${customLists.size} custom lists, ` +
        `${normUsers.length} users, ${normComponents.length} components, ${normFolders.length} folders.`,
    );
  }

  return { metadata, failures };
}
