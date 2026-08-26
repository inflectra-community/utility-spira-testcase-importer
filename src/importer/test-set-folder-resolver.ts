/**
 * Test Set Folder Resolver — resolves folder paths to Spira TestSetFolderIds.
 * Creates missing folders in the hierarchy as needed.
 *
 * Mirrors the test case FolderResolver, but operates on test-set-folders.
 */

import type { SpiraApiClient } from '../spira/client.js';
import type { TestSetFolder } from '../types/import.js';
import type { Logger } from '../logger/index.js';

export interface TestSetFolderResolver {
  /**
   * Resolves a folder path (e.g. "A/B/C") to the TestSetFolderId of the deepest folder.
   * Creates missing folders as needed. Returns null for empty paths (root level).
   */
  resolve(folderPath: string | undefined): Promise<number | null>;

  /** Returns the list of folder paths created during this session. */
  getCreatedFolders(): string[];
}

/**
 * Creates a TestSetFolderResolver instance.
 */
export function createTestSetFolderResolver(
  client: SpiraApiClient,
  existingFolders: TestSetFolder[],
  logger: Logger,
  pathSeparator?: string,
): TestSetFolderResolver {
  const separator = pathSeparator ?? '/';
  const createdFolders: string[] = [];

  const folderCache = new Map<string, number>();
  const folderById = new Map<number, TestSetFolder>();
  for (const folder of existingFolders) {
    folderById.set(folder.testSetFolderId, folder);
  }

  function buildFullPath(folder: TestSetFolder): string {
    const parts: string[] = [folder.name];
    let current = folder;
    while (current.parentTestSetFolderId != null) {
      const parent = folderById.get(current.parentTestSetFolderId);
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent;
    }
    return parts.join(separator);
  }

  for (const folder of existingFolders) {
    folderCache.set(buildFullPath(folder), folder.testSetFolderId);
  }

  async function resolve(folderPath: string | undefined): Promise<number | null> {
    if (!folderPath || folderPath.trim() === '') {
      return null;
    }

    const normalizedPath = folderPath.trim();
    if (folderCache.has(normalizedPath)) {
      return folderCache.get(normalizedPath)!;
    }

    const segments = normalizedPath.split(separator).filter(s => s.trim() !== '');
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

      logger.info(`Creating test set folder: "${currentPath}"`, { segment, parentId });
      const created = await client.createTestSetFolder({
        Name: segment,
        ParentTestSetFolderId: parentId,
      });

      folderCache.set(currentPath, created.testSetFolderId);
      folderById.set(created.testSetFolderId, created);
      parentId = created.testSetFolderId;
      createdFolders.push(currentPath);
    }

    return parentId ?? null;
  }

  function getCreatedFolders(): string[] {
    return [...createdFolders];
  }

  return { resolve, getCreatedFolders };
}
