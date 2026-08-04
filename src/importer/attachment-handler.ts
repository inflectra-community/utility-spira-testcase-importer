/**
 * Attachment Handler — uploads file attachments and links them to test cases.
 *
 * After test cases are created, this handler processes any attachment columns,
 * resolves file paths, reads the file content, and uploads via the Spira Documents API.
 *
 * Spira API: POST /projects/{project_id}/documents/file
 * Body: { BinaryData (base64), AttachedArtifacts, FilenameOrUrl, AuthorId, ... }
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';

/**
 * Represents a pending attachment to upload.
 */
export interface PendingAttachment {
  /** The Spira test case ID this attachment belongs to */
  testCaseId: number;
  /** The source row index (for error reporting) */
  sourceRowIndex: number;
  /** The display filename */
  filename: string;
  /** The file path (absolute or relative to the spreadsheet) */
  filePath: string;
}

/**
 * Result of attachment upload processing.
 */
export interface AttachmentUploadResult {
  totalAttempted: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  failures: { filename: string; testCaseId: number; error: string }[];
}

/**
 * Configuration for the attachment handler.
 */
export interface AttachmentHandlerConfig {
  client: SpiraApiClient;
  logger: Logger;
  projectId: number;
  /** Base directory for resolving relative file paths (typically the spreadsheet's directory) */
  baseDir: string;
  /** The user ID to set as the document author */
  authorId?: number;
}

/**
 * Extracts attachment info from a cell value (ExcelJS hyperlink object or string).
 *
 * ExcelJS hyperlink objects look like: { text: "filename.png", hyperlink: "relative/path/to/file.png" }
 * Plain strings are treated as file paths directly.
 */
export function extractAttachmentInfo(
  cellValue: unknown,
): { filename: string; filePath: string } | null {
  if (cellValue === null || cellValue === undefined || cellValue === '') {
    return null;
  }

  // ExcelJS hyperlink object
  if (typeof cellValue === 'object' && cellValue !== null) {
    const obj = cellValue as Record<string, unknown>;
    if (obj.text || obj.hyperlink) {
      const filename = String(obj.text ?? obj.hyperlink ?? '').trim();
      const filePath = String(obj.hyperlink ?? obj.text ?? '').trim();
      if (!filename && !filePath) return null;
      return {
        filename: filename || path.basename(filePath),
        filePath: decodeURIComponent(filePath),
      };
    }
  }

  // Plain string — treat as file path
  if (typeof cellValue === 'string') {
    const trimmed = cellValue.trim();
    if (!trimmed) return null;
    return {
      filename: path.basename(trimmed),
      filePath: trimmed,
    };
  }

  return null;
}

/**
 * Uploads pending attachments to Spira and links them to their test cases.
 *
 * For each attachment:
 * 1. Resolves the file path (relative to baseDir)
 * 2. Checks if the file exists
 * 3. Reads the file and converts to base64
 * 4. POSTs to Spira Documents API with test case association
 *
 * Files that don't exist are skipped with a warning (not treated as errors).
 */
export async function uploadAttachments(
  attachments: PendingAttachment[],
  config: AttachmentHandlerConfig,
): Promise<AttachmentUploadResult> {
  const { client, logger, projectId, baseDir, authorId } = config;

  const result: AttachmentUploadResult = {
    totalAttempted: attachments.length,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    failures: [],
  };

  if (attachments.length === 0) {
    return result;
  }

  logger.info(`Uploading ${attachments.length} attachment(s)...`);

  for (const attachment of attachments) {
    // Resolve file path
    let resolvedPath = attachment.filePath;
    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.resolve(baseDir, resolvedPath);
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      logger.warn(`Attachment file not found: "${resolvedPath}" (for TC ${attachment.testCaseId}). Skipping.`);
      result.skippedCount++;
      continue;
    }

    try {
      // Read file and convert to base64
      const fileBuffer = fs.readFileSync(resolvedPath);
      const base64Data = fileBuffer.toString('base64');
      const fileSize = fileBuffer.length;

      // Build the document upload request
      const documentRequest = {
        BinaryData: base64Data,
        AttachedArtifacts: [
          {
            ArtifactId: attachment.testCaseId,
            ArtifactTypeId: 2, // 2 = Test Case
          },
        ],
        FilenameOrUrl: attachment.filename,
        Description: `Imported attachment for test case (row ${attachment.sourceRowIndex})`,
        Size: fileSize,
        CurrentVersion: '1.0',
        ProjectId: projectId,
        ...(authorId !== undefined && { AuthorId: authorId }),
      };

      // Upload via API
      await (client as any).uploadDocument(documentRequest);
      logger.info(`Uploaded attachment "${attachment.filename}" for TC ${attachment.testCaseId}`);
      result.successCount++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to upload "${attachment.filename}" for TC ${attachment.testCaseId}: ${errorMessage}`);
      result.failureCount++;
      result.failures.push({
        filename: attachment.filename,
        testCaseId: attachment.testCaseId,
        error: errorMessage,
      });
    }
  }

  logger.info(`Attachments: ${result.successCount} uploaded, ${result.skippedCount} skipped (file not found), ${result.failureCount} failed`);
  return result;
}
