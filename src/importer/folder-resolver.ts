/**
 * Folder Resolver — resolves folder paths to Spira TestCaseFolderIds.
 * Creates missing folders in the hierarchy as needed.
 *
 * This is a stub placeholder. The full implementation is created in task 12.1.
 */

import type { SpiraApiClient } from '../spira/client.js';
import type { TestCaseFolder } from '../types/spira.js';
import type { Logger } from '../logger/index.js';

export interface FolderResolver {
  /**
   * Resolves a folder path (e.g., "A/B/C") to the TestCaseFolderId of the deepest folder.
   * Creates missing folders as needed.
   * Returns null for empty/undefined folder paths (root level).
   */
  resolve(folderPath: string | undefined): Promise<number | null>;

  /**
   * Returns the list of folder paths that were created during this session.
   */
  getCreatedFolders(): string[];
}

/**
 * Creates a FolderResolver instance.
 */
export function createFolderResolver(
  client: SpiraApiClient,
  existingFolders: TestCaseFolder[],
  logger: Logger,
  pathSeparator?: string,
): FolderResolver {
  const separator = pathSeparator ?? '/';
  const createdFolders: string[] = [];

  // Cache: full path -> folder ID
  const folderCache = new Map<string, number>();

  // Initialize cache with existing folders by building full paths
  const folderById = new Map<number, TestCaseFolder>();
  for (const folder of existingFolders) {
    folderById.set(folder.testCaseFolderId, folder);
  }

  function buildFullPath(folder: TestCaseFolder): string {
    const parts: string[] = [folder.name];
    let current = folder;
    while (current.parentTestCaseFolderId != null) {
      const parent = folderById.get(current.parentTestCaseFolderId);
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent;
    }
    return parts.join(separator);
  }

  // Pre-populate cache with existing folders
  for (const folder of existingFolders) {
    const fullPath = buildFullPath(folder);
    folderCache.set(fullPath, folder.testCaseFolderId);
  }

  async function resolve(folderPath: string | undefined): Promise<number | null> {
    if (!folderPath || folderPath.trim() === '') {
      return null;
    }

    const normalizedPath = folderPath.trim();

    // Check cache first
    if (folderCache.has(normalizedPath)) {
      return folderCache.get(normalizedPath)!;
    }

    // Split into segments and create each missing folder
    const segments = normalizedPath.split(separator).filter((s) => s.trim() !== '');
    if (segments.length === 0) {
      return null;
    }

    let parentId: number | undefined = undefined;
    let currentPath = '';

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}${separator}${segment}` : segment;

      if (folderCache.has(currentPath)) {
        parentId = folderCache.get(currentPath)!;
        continue;
      }

      // Create the folder
      logger.info(`Creating folder: "${currentPath}"`, { segment, parentId });
      const created = await client.createTestFolder({
        Name: segment,
        ParentTestCaseFolderId: parentId,
      });

      folderCache.set(currentPath, created.testCaseFolderId);
      folderById.set(created.testCaseFolderId, created);
      parentId = created.testCaseFolderId;
      createdFolders.push(currentPath);
    }

    return parentId ?? null;
  }

  function getCreatedFolders(): string[] {
    return [...createdFolders];
  }

  return { resolve, getCreatedFolders };
}
