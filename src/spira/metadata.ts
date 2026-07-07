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
  const [priorities, statuses, types, customProperties, users, components, existingFolders] =
    await Promise.all([
      tryFetch<TestCasePriority[]>('priorities', () => client.getTestCasePriorities(), []),
      tryFetch<TestCaseStatus[]>('statuses', () => client.getTestCaseStatuses(), []),
      tryFetch<TestCaseType[]>('types', () => client.getTestCaseTypes(), []),
      tryFetch<CustomPropertyDefinition[]>(
        'customProperties',
        () => client.getCustomProperties('TestCase'),
        [],
      ),
      tryFetch<ProjectUser[]>('users', () => client.getProjectUsers(), []),
      tryFetch<Component[]>('components', () => client.getComponents(), []),
      tryFetch<TestCaseFolder[]>('existingFolders', () => client.getTestFolders(), []),
    ]);

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
        const values = await tryFetch<CustomListValue[]>(
          `customList(${listId})`,
          () => client.getCustomListValues(listId),
          [],
        );
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
    priorities,
    statuses,
    types,
    customProperties,
    customLists,
    users,
    components,
    existingFolders,
  };

  if (failures.length > 0) {
    logger.warn(
      `Template metadata retrieval completed with ${failures.length} failure(s): ${failures.map((f) => f.field).join(', ')}`,
    );
  } else {
    logger.info(
      `Template metadata retrieved successfully. ` +
        `${priorities.length} priorities, ${statuses.length} statuses, ${types.length} types, ` +
        `${customProperties.length} custom properties, ${customLists.size} custom lists, ` +
        `${users.length} users, ${components.length} components, ${existingFolders.length} folders.`,
    );
  }

  return { metadata, failures };
}
