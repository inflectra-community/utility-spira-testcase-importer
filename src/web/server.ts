/**
 * Rudimentary Web UI server for the Spira Test Case Importer.
 *
 * Thin orchestration layer over the existing headless modules — it does NOT
 * reimplement pipeline logic. Each endpoint maps to a pipeline stage:
 *
 *   GET  /api/settings          current settings (API key masked)
 *   POST /api/settings          save settings
 *   POST /api/test-connection   authenticate + fetch metadata summary
 *   GET  /api/files             list uploaded sources in input/
 *   POST /api/upload            upload a file to input/
 *   POST /api/parse             parse + validate a Zephyr bundle, return a plan
 *   GET  /api/import            execute the import (SSE progress stream)
 *
 * The current UI targets the Zephyr bundle path end-to-end (deterministic, no
 * LLM review loop). Excel import is surfaced as "coming soon" in the UI.
 */

import express, { type Request, type Response } from 'express';
import multer from 'multer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadSettings, saveSettings, isConfigured, maskedSettings, type AppSettings } from './settings.js';
import { createLogger } from '../logger/index.js';
import { createSpiraClient } from '../spira/client.js';
import { fetchAllMetadata } from '../spira/metadata.js';
import { isZephyrBundle, parseZephyrBundle } from '../parser/zephyr-bundle.js';
import { resolveZephyrMetadata } from '../pipeline-zephyr.js';
import { createValidationEngine } from '../validator/index.js';
import { createImportEngine } from '../importer/index.js';
import { importTestSet } from '../importer/test-set-importer.js';
import { uploadAttachments, type PendingAttachment } from '../importer/attachment-handler.js';
import type { SpiraConfig } from '../types/config.js';
import type { TransformedTestCase } from '../types/transform.js';
import type { ZephyrBundleResult } from '../parser/zephyr-bundle.js';
import type { TemplateMetadata } from '../types/spira.js';

const INPUT_DIR = path.resolve(process.cwd(), 'input');
const PUBLIC_DIR = path.resolve(import.meta.dirname, 'public');

/** Session state for the current parse → import flow (single-user tool). */
interface ParsedSession {
  sourcePath: string;
  bundle: ZephyrBundleResult;
  testCases: TransformedTestCase[];
  metadata: TemplateMetadata;
  keyToRowIndex: Map<string, number>;
  warnings: string[];
}
let currentSession: ParsedSession | null = null;

function spiraConfigFromSettings(s: AppSettings): SpiraConfig {
  return {
    baseUrl: s.spira.baseUrl,
    username: s.spira.username,
    apiKey: s.spira.apiKey,
    projectId: s.spira.projectId,
  };
}

export function createServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  if (!fs.existsSync(INPUT_DIR)) fs.mkdirSync(INPUT_DIR, { recursive: true });

  const upload = multer({ dest: INPUT_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

  // ── Settings ──────────────────────────────────────────────────────────────
  app.get('/api/settings', (_req, res) => {
    const s = loadSettings();
    res.json({ settings: maskedSettings(s), configured: isConfigured(s) });
  });

  app.post('/api/settings', (req, res) => {
    const incoming = req.body as AppSettings;
    const current = loadSettings();
    // Preserve existing secrets if the client sent back the mask.
    if (incoming.spira?.apiKey === '********') incoming.spira.apiKey = current.spira.apiKey;
    if (incoming.llm?.apiKey === '********') incoming.llm.apiKey = current.spira.apiKey;
    saveSettings(incoming);
    res.json({ ok: true });
  });

  // ── Connection test ───────────────────────────────────────────────────────
  app.post('/api/test-connection', async (_req, res) => {
    const s = loadSettings();
    if (!isConfigured(s)) {
      res.status(400).json({ ok: false, error: 'Spira settings are incomplete.' });
      return;
    }
    const logger = createLogger();
    try {
      const client = createSpiraClient(spiraConfigFromSettings(s), logger);
      await client.authenticate();
      const { metadata } = await fetchAllMetadata(client, spiraConfigFromSettings(s), 0, logger);
      res.json({
        ok: true,
        project: { id: metadata.projectId, templateId: metadata.templateId },
        counts: {
          customProperties: metadata.customProperties.length,
          priorities: metadata.priorities.length,
          statuses: metadata.statuses.length,
          components: metadata.components.length,
        },
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── File listing / upload ─────────────────────────────────────────────────
  app.get('/api/files', (_req, res) => {
    const entries = fs.readdirSync(INPUT_DIR, { withFileTypes: true });
    const files = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => {
        const full = path.join(INPUT_DIR, e.name);
        return {
          name: e.name,
          isDirectory: e.isDirectory(),
          isZephyrBundle: e.isDirectory() && isZephyrBundle(full),
        };
      });
    res.json({ files });
  });

  app.post('/api/upload', upload.single('file'), (req: Request, res: Response) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ ok: false, error: 'No file received.' });
      return;
    }
    // Multer gives a random name; restore the original filename.
    const dest = path.join(INPUT_DIR, file.originalname);
    fs.renameSync(file.path, dest);
    res.json({ ok: true, name: file.originalname });
  });

  // ── Parse + validate (Zephyr bundle) ────────────────────────────────────────
  app.post('/api/parse', async (req, res) => {
    const s = loadSettings();
    if (!isConfigured(s)) {
      res.status(400).json({ ok: false, error: 'Configure Spira settings first.' });
      return;
    }
    const { name } = req.body as { name: string };
    const sourcePath = path.join(INPUT_DIR, name);
    if (!fs.existsSync(sourcePath)) {
      res.status(404).json({ ok: false, error: `Not found: ${name}` });
      return;
    }
    if (!isZephyrBundle(sourcePath)) {
      res.status(400).json({ ok: false, error: 'Only Zephyr bundles are supported in the web UI so far.' });
      return;
    }

    const logger = createLogger();
    try {
      const client = createSpiraClient(spiraConfigFromSettings(s), logger);
      await client.authenticate();
      const { metadata } = await fetchAllMetadata(client, spiraConfigFromSettings(s), 0, logger);

      const bundle = parseZephyrBundle(sourcePath);

      // Capture key → row index before resolution strips _zephyrMeta.
      const keyToRowIndex = new Map<string, number>();
      for (const tc of bundle.testCases) {
        const key = (tc as unknown as { _zephyrMeta?: { key?: string } })._zephyrMeta?.key;
        if (key) keyToRowIndex.set(key, tc.sourceRowIndex);
      }

      const warnings = resolveZephyrMetadata(bundle.testCases, metadata);

      if (s.import.rootFolder) {
        for (const tc of bundle.testCases) {
          tc.folderPath = tc.folderPath
            ? `${s.import.rootFolder}/${tc.folderPath}`.replace(/\/+/g, '/')
            : s.import.rootFolder;
        }
      }

      const validation = createValidationEngine().validate(bundle.testCases, metadata);

      currentSession = {
        sourcePath,
        bundle,
        testCases: bundle.testCases,
        metadata,
        keyToRowIndex,
        warnings,
      };

      res.json({
        ok: true,
        plan: {
          testCaseCount: bundle.testCases.length,
          stepCount: bundle.testCases.reduce((n, tc) => n + tc.testSteps.length, 0),
          inlineImages: bundle.pendingAttachments.length,
          validationErrors: validation.stats.errorCount,
          validationWarnings: validation.stats.warningCount,
          warnings,
          testCases: bundle.testCases.map(tc => ({
            key: (tc as unknown as { _zephyrMeta?: { key?: string } })._zephyrMeta?.key ?? '',
            name: tc.name,
            folder: tc.folderPath ?? '(root)',
            steps: tc.testSteps.length,
          })),
          testSet: bundle.testSet
            ? {
                name: bundle.testSet.name,
                folder: bundle.testSet.folderPath ?? '(root)',
                members: bundle.testSet.memberKeys,
              }
            : null,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Import (SSE progress) ───────────────────────────────────────────────────
  app.get('/api/import', async (req, res) => {
    const dryRun = req.query.dryRun === 'true';
    const session = currentSession;
    if (!session) {
      res.status(400).json({ ok: false, error: 'Nothing parsed yet.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const s = loadSettings();
    const logger = createLogger();

    try {
      const client = createSpiraClient(spiraConfigFromSettings(s), logger);
      await client.authenticate();

      send('phase', { message: dryRun ? 'Dry-run: validating only' : 'Importing test cases' });

      const engine = createImportEngine({
        client,
        logger,
        customPropertyDefinitions: session.metadata.customProperties,
        existingFolders: session.metadata.existingFolders,
        pathSeparator: '/',
      });

      const importResult = await engine.import(session.testCases, {
        dryRun,
        onProgress: (current, total, item) => send('progress', { current, total, item }),
      });

      // Attachments
      let attachSummary: { uploaded: number; skipped: number; failed: number } | undefined;
      if (!dryRun && session.bundle.pendingAttachments.length > 0 && importResult.createdTestCases.size > 0) {
        send('phase', { message: 'Uploading inline images' });
        const pending: PendingAttachment[] = [];
        for (const ref of session.bundle.pendingAttachments) {
          const tcId = importResult.createdTestCases.get(ref.testCaseIndex);
          if (!tcId) continue;
          pending.push({
            testCaseId: tcId,
            sourceRowIndex: ref.testCaseIndex,
            filename: path.basename(ref.localPath),
            filePath: ref.localPath,
          });
        }
        if (pending.length > 0) {
          const ar = await uploadAttachments(pending, {
            client,
            logger,
            projectId: s.spira.projectId,
            baseDir: process.cwd(),
          });
          attachSummary = { uploaded: ar.successCount, skipped: ar.skippedCount, failed: ar.failureCount };
        }
      }

      // Test Set
      let testSetSummary: unknown;
      if (session.bundle.testSet) {
        send('phase', { message: 'Creating Test Set' });
        const keyToTestCaseId = new Map<string, number>();
        for (const [key, rowIndex] of session.keyToRowIndex) {
          if (dryRun) {
            keyToTestCaseId.set(key, rowIndex);
          } else {
            const id = importResult.createdTestCases.get(rowIndex);
            if (id !== undefined) keyToTestCaseId.set(key, id);
          }
        }
        const existingFolders = dryRun ? [] : await client.getTestSetFolders();
        const tsr = await importTestSet(
          { testSet: session.bundle.testSet, keyToTestCaseId },
          { client, logger, existingTestSetFolders: existingFolders, rootFolder: s.import.rootFolder },
          { dryRun },
        );
        testSetSummary = {
          name: tsr.testSetName,
          membersAdded: tsr.membersAdded,
          membersSkipped: tsr.membersSkipped,
          ordered: tsr.orderingApplied,
          error: tsr.error,
        };
      }

      send('complete', {
        dryRun,
        totalAttempted: importResult.totalAttempted,
        successCount: importResult.successCount,
        failureCount: importResult.failureCount,
        foldersCreated: importResult.createdFolders.length,
        durationMs: importResult.duration,
        failures: importResult.failures.slice(0, 20),
        attachments: attachSummary,
        testSet: testSetSummary,
      });
    } catch (err) {
      send('error', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      res.end();
    }
  });

  // SPA fallback
  app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  return app;
}

export function startServer(port = Number(process.env.WEB_PORT ?? 4321)) {
  const app = createServer();
  app.listen(port, () => {
    process.stdout.write(`\n  Spira Importer UI → http://localhost:${port}\n\n`);
  });
}
