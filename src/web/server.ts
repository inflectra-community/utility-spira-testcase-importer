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
import { isZephyrBundle, parseZephyrBundle, findZephyrBundles } from '../parser/zephyr-bundle.js';
import { resolveZephyrMetadata, analyzeZephyrGaps, type ZephyrGapAnalysis } from '../pipeline-zephyr.js';
import { createExcelParser, type SheetData } from '../parser/index.js';
import { createValidationEngine } from '../validator/index.js';
import { createDataTransformer } from '../transformer/index.js';
import { createImportEngine } from '../importer/index.js';
import { createMappingEngine } from '../mapping/engine.js';
import { importTestSet } from '../importer/test-set-importer.js';
import { createTestSetFolderResolver } from '../importer/test-set-folder-resolver.js';
import { uploadAttachments, type PendingAttachment } from '../importer/attachment-handler.js';
import {
  generateExcelMapping,
  processValueSuggestions,
  availableTargetsForField,
  DEFAULT_TEST_CASE_FIELDS,
} from '../core/excel-mapping.js';
import { extractColumnInfo, findMissingListValues, generateProvisionerConfig, inferFieldType } from '../provisioner/index.js';
import type { SpiraConfig } from '../types/config.js';
import type { TransformedTestCase } from '../types/transform.js';
import type { ZephyrBundleResult } from '../parser/zephyr-bundle.js';
import type { TemplateMetadata } from '../types/spira.js';
import type { MappingResult } from '../types/mapping.js';
import type { PreAnalysisResult } from '../heuristics/index.js';

const INPUT_DIR = path.resolve(process.cwd(), 'input');
const PUBLIC_DIR = path.resolve(import.meta.dirname, 'public');

/** Session state for the current parse → import flow (single-user tool). */
interface ParsedSession {
  format: 'zephyr' | 'excel';
  sourcePath: string;
  metadata: TemplateMetadata;
  /** Final transformed test cases ready to import (set once the mapping is accepted). */
  testCases: TransformedTestCase[];
  // Zephyr extras
  bundle?: ZephyrBundleResult;
  keyToRowIndex?: Map<string, number>;
  zephyrGaps?: ZephyrGapAnalysis;
  warnings: string[];
}
let currentSession: ParsedSession | null = null;

/** Excel mapping-in-progress state (between /api/parse and accept). */
interface ExcelMappingSession {
  sourcePath: string;
  sheet: SheetData;
  metadata: TemplateMetadata;
  mapping: MappingResult;
  preAnalysis: PreAnalysisResult;
}
let excelMappingSession: ExcelMappingSession | null = null;

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
    const files: Array<{ name: string; isDirectory: boolean; isZephyrBundle: boolean; bundleLabel?: string }> = [];

    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(INPUT_DIR, e.name);

      if (e.isDirectory()) {
        const bundles = findZephyrBundles(full);
        if (bundles.length === 0) {
          // A plain folder with nothing parseable inside.
          files.push({ name: e.name, isDirectory: true, isZephyrBundle: false });
        } else if (bundles.length === 1 && bundles[0].path === full) {
          // Flat export: the folder itself is the bundle.
          files.push({ name: e.name, isDirectory: true, isZephyrBundle: true });
        } else {
          // Nested / multi-project export: expose each project as its own entry.
          // The `name` is a path relative to input/ so /api/parse can resolve it.
          for (const b of bundles) {
            const relName = path.relative(INPUT_DIR, b.path).split(path.sep).join('/');
            files.push({
              name: relName,
              isDirectory: true,
              isZephyrBundle: true,
              bundleLabel: `${e.name} › ${b.name}`,
            });
          }
        }
      } else {
        files.push({ name: e.name, isDirectory: false, isZephyrBundle: false });
      }
    }

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
    const logger = createLogger();

    // ── Excel branch ────────────────────────────────────────────────────────
    if (!isZephyrBundle(sourcePath)) {
      const ext = path.extname(sourcePath).toLowerCase();
      if (ext !== '.xlsx' && ext !== '.xls') {
        res.status(400).json({ ok: false, error: 'Unsupported source. Use a Zephyr bundle folder or an .xlsx/.xls file.' });
        return;
      }
      try {
        const client = createSpiraClient(spiraConfigFromSettings(s), logger);
        await client.authenticate();
        const { metadata } = await fetchAllMetadata(client, spiraConfigFromSettings(s), 0, logger);

        const spreadsheet = await createExcelParser().parse(sourcePath);
        const { sheet: requestedSheet } = req.body as { sheet?: string };

        // Pick the sheet: explicit request, single sheet, or ask the user to choose.
        let sheet: SheetData | undefined;
        if (requestedSheet) {
          sheet = spreadsheet.sheets.find(x => x.name === requestedSheet);
          if (!sheet) { res.status(400).json({ ok: false, error: `Worksheet "${requestedSheet}" not found.` }); return; }
        } else if (spreadsheet.sheets.length === 1) {
          sheet = spreadsheet.sheets[0];
        } else {
          // Multiple sheets and none chosen yet — return the list for selection.
          res.json({
            ok: true,
            format: 'excel',
            needsSheetSelection: true,
            sheets: spreadsheet.sheets.map(x => ({ name: x.name, rowCount: x.rowCount, columns: x.headers.length })),
          });
          return;
        }

        if (sheet.rowCount === 0) {
          res.status(400).json({ ok: false, error: `Worksheet "${sheet.name}" has no data rows.` });
          return;
        }

        // Heuristics + LLM mapping via the shared core.
        const fieldDefinitions = DEFAULT_TEST_CASE_FIELDS;
        const { mapping, preAnalysis, llmFailed, llmError } = await generateExcelMapping(
          sheet, metadata, s.llm, fieldDefinitions, logger,
        );

        excelMappingSession = { sourcePath, sheet, metadata, mapping, preAnalysis };

        res.json({
          ok: true,
          format: 'excel',
          sheet: sheet.name,
          llmFailed,
          llmError: llmError ?? null,
          resolvedColumnCount: preAnalysis.resolvedMappings.length,
          unresolvedColumnCount: preAnalysis.unresolvedColumns.length,
          hasUnresolved: preAnalysis.unresolvedColumns.length > 0,
          mapping: {
            fieldMappings: mapping.fieldMappings,
            unmappedSourceColumns: mapping.unmappedSourceColumns,
            confidence: mapping.confidence,
            notes: mapping.notes,
            testStepMapping: mapping.testStepMapping ?? null,
            folderMapping: mapping.folderMapping ?? null,
            valueSuggestions: (mapping.valueSuggestions ?? []).map(vs => ({
              field: vs.field,
              sourceValue: vs.sourceValue,
              suggestedTarget: vs.suggestedTarget,
              options: availableTargetsForField(vs.field, metadata),
            })),
          },
        });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // ── Zephyr branch ─────────────────────────────────────────────────────────
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

      // Collect template gaps BEFORE resolution strips _zephyrMeta / named CPs.
      const gaps = analyzeZephyrGaps(bundle.testCases, metadata);

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
        format: 'zephyr',
        sourcePath,
        bundle,
        testCases: bundle.testCases,
        metadata,
        keyToRowIndex,
        warnings,
        zephyrGaps: gaps,
      };

      const hasGaps = gaps.newProperties.length > 0 || gaps.missingListValues.length > 0;

      // Only count members this bundle can actually resolve (cycles in a
      // multi-project export may reference test cases from sibling projects).
      const resolvableMembers = (ts: typeof bundle.testSets[number]) =>
        ts.memberKeys.filter(k => keyToRowIndex.has(k));

      res.json({
        ok: true,
        format: 'zephyr',
        hasGaps,
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
          testSets: bundle.testSets.map(ts => ({
            name: ts.name,
            folder: ts.folderPath ?? '(root)',
            members: resolvableMembers(ts),
            skipped: ts.memberKeys.length - resolvableMembers(ts).length,
          })),
          // Back-compat for any older client code reading a single testSet.
          testSet: bundle.testSet
            ? {
                name: bundle.testSet.name,
                folder: bundle.testSet.folderPath ?? '(root)',
                members: resolvableMembers(bundle.testSet),
              }
            : null,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Excel: regenerate mapping with user feedback ────────────────────────────
  app.post('/api/excel/feedback', async (req, res) => {
    if (!excelMappingSession) { res.status(400).json({ ok: false, error: 'No Excel mapping in progress.' }); return; }
    const { feedback } = req.body as { feedback: string };
    if (!feedback?.trim()) { res.status(400).json({ ok: false, error: 'Feedback is required.' }); return; }

    const s = loadSettings();
    const logger = createLogger();
    try {
      const engine = createMappingEngine(s.llm);
      const revised = await engine.retryMapping(excelMappingSession.mapping, feedback);
      // Re-resolve value suggestions against metadata after regeneration.
      processValueSuggestions(revised, excelMappingSession.metadata);
      excelMappingSession.mapping = revised;

      res.json({
        ok: true,
        mapping: {
          fieldMappings: revised.fieldMappings,
          unmappedSourceColumns: revised.unmappedSourceColumns,
          confidence: revised.confidence,
          notes: revised.notes,
          testStepMapping: revised.testStepMapping ?? null,
          folderMapping: revised.folderMapping ?? null,
          valueSuggestions: (revised.valueSuggestions ?? []).map(vs => ({
            field: vs.field,
            sourceValue: vs.sourceValue,
            suggestedTarget: vs.suggestedTarget,
            options: availableTargetsForField(vs.field, excelMappingSession!.metadata),
          })),
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Excel: accept mapping (with optional value edits) → transform + validate ─
  app.post('/api/excel/accept', (req, res) => {
    if (!excelMappingSession) { res.status(400).json({ ok: false, error: 'No Excel mapping in progress.' }); return; }
    const s = loadSettings();
    const { valueEdits } = req.body as { valueEdits?: { field: string; sourceValue: string; target: string }[] };

    const { sheet, metadata, mapping } = excelMappingSession;

    // Apply user edits to the value suggestions, then re-resolve to IDs.
    if (valueEdits && mapping.valueSuggestions) {
      for (const edit of valueEdits) {
        const vs = mapping.valueSuggestions.find(v => v.field === edit.field && v.sourceValue === edit.sourceValue);
        if (vs) vs.suggestedTarget = edit.target;
      }
      processValueSuggestions(mapping, metadata);
    }

    // Transform + validate.
    const transform = createDataTransformer().transform(sheet.rows, mapping, metadata);
    const validation = createValidationEngine().validate(transform.testCases, metadata);

    // Apply root folder prefix.
    if (s.import.rootFolder) {
      const sep = mapping.folderMapping?.pathSeparator ?? '/';
      for (const tc of transform.testCases) {
        tc.folderPath = tc.folderPath ? `${s.import.rootFolder}${sep}${tc.folderPath}` : s.import.rootFolder;
      }
    }

    currentSession = {
      format: 'excel',
      sourcePath: excelMappingSession.sourcePath,
      metadata,
      testCases: transform.testCases,
      warnings: transform.warnings.map(w => `Row ${w.rowIndex}: ${w.message}`),
    };

    res.json({
      ok: true,
      plan: {
        testCaseCount: transform.testCases.length,
        stepCount: transform.testCases.reduce((n, tc) => n + tc.testSteps.length, 0),
        validationErrors: validation.stats.errorCount,
        validationWarnings: validation.stats.warningCount,
        transformErrors: transform.errors.length,
        testCases: transform.testCases.slice(0, 200).map(tc => ({
          name: tc.name,
          folder: tc.folderPath ?? '(root)',
          steps: tc.testSteps.length,
        })),
      },
    });
  });

  // ── Excel: export a SpiraProvisioner structure file ─────────────────────────
  // Returns the provisioner JSON plus a human-readable summary of what it adds.
  app.post('/api/excel/provisioner', (req, res) => {
    if (!excelMappingSession) { res.status(400).json({ ok: false, error: 'No Excel mapping in progress.' }); return; }
    const { programName, productName } = req.body as { programName?: string; productName?: string };
    const { sheet, metadata, preAnalysis } = excelMappingSession;

    // New columns the heuristics/LLM couldn't map to anything in the template.
    const newColumns = extractColumnInfo(sheet.rows, preAnalysis.unresolvedColumns);

    // Existing list properties that are missing some of the source's values.
    const missingValues = findMissingListValues(
      sheet.rows,
      preAnalysis.resolvedMappings,
      metadata.customProperties,
      metadata.customLists,
    );

    if (newColumns.length === 0 && missingValues.length === 0) {
      res.json({ ok: true, empty: true, message: 'Nothing to provision — every column and value is already covered by the template.' });
      return;
    }

    const config = generateProvisionerConfig({
      programName: programName?.trim() || 'My Program',
      productName: productName?.trim() || (metadata.projectId ? `Project ${metadata.projectId}` : 'My Product'),
      newColumns,
      missingValues,
    });

    // Build a readable summary for the UI (type inference + variability).
    const newFieldSummary = newColumns.map(col => {
      const { type, variabilityScore } = inferFieldType(col, 20);
      return {
        name: col.columnName,
        type,
        variability: Math.round(variabilityScore * 100),
        uniqueValues: col.uniqueValues.length,
      };
    });
    const missingValueSummary = missingValues.map(mv => ({
      property: mv.propertyName,
      added: mv.missingValues.length,
      sample: mv.missingValues.slice(0, 8),
    }));

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.json({
      ok: true,
      empty: false,
      filename: `spira-provisioner-${stamp}.json`,
      newFields: newFieldSummary,
      missingValues: missingValueSummary,
      config,
    });
  });

  // ── Zephyr: export a SpiraProvisioner structure file ────────────────────────
  // Uses the gaps collected during parse (new custom properties + missing list
  // values). Reuses the same generateProvisionerConfig/inferFieldType as Excel.
  app.post('/api/zephyr/provisioner', (req, res) => {
    const session = currentSession;
    if (!session || session.format !== 'zephyr' || !session.zephyrGaps) {
      res.status(400).json({ ok: false, error: 'No Zephyr bundle parsed.' });
      return;
    }
    const { programName, productName } = req.body as { programName?: string; productName?: string };
    const gaps = session.zephyrGaps;

    if (gaps.newProperties.length === 0 && gaps.missingListValues.length === 0) {
      res.json({ ok: true, empty: true, message: 'Nothing to provision — every field and value is already in the template.' });
      return;
    }

    // Adapt Zephyr gaps to the provisioner module's input shapes.
    const newColumns = gaps.newProperties.map(p => ({
      columnName: p.name,
      uniqueValues: p.uniqueValues,
      rowCount: p.rowCount,
    }));
    const missingValues = gaps.missingListValues.map(m => ({
      propertyName: m.propertyName,
      existingValues: m.existingValues,
      missingValues: m.missingValues,
    }));

    const config = generateProvisionerConfig({
      programName: programName?.trim() || 'My Program',
      productName: productName?.trim() || (session.metadata.projectId ? `Project ${session.metadata.projectId}` : 'My Product'),
      newColumns,
      missingValues,
    });

    const newFieldSummary = newColumns.map(col => {
      const { type, variabilityScore } = inferFieldType(col, 20);
      return { name: col.columnName, type, variability: Math.round(variabilityScore * 100), uniqueValues: col.uniqueValues.length };
    });
    const missingValueSummary = missingValues.map(mv => ({
      property: mv.propertyName,
      added: mv.missingValues.length,
      sample: mv.missingValues.slice(0, 8),
    }));

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.json({
      ok: true,
      empty: false,
      filename: `spira-provisioner-${stamp}.json`,
      newFields: newFieldSummary,
      missingValues: missingValueSummary,
      unprovisionable: gaps.unprovisionableLookups,
      config,
    });
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

      // Attachments (Zephyr only — inline images from the bundle)
      let attachSummary: { uploaded: number; skipped: number; failed: number } | undefined;
      if (!dryRun && session.bundle && session.bundle.pendingAttachments.length > 0 && importResult.createdTestCases.size > 0) {
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

      // Test Sets (Zephyr only — one per test cycle). A nested-format project
      // can carry several cycles; each becomes its own Spira Test Set.
      const testSetSummaries: Array<{
        name: string;
        membersAdded: number;
        membersSkipped: number;
        ordered: boolean;
        error?: string;
      }> = [];
      const testSets = session.bundle?.testSets ?? [];
      if (testSets.length > 0 && session.keyToRowIndex) {
        const keyToTestCaseId = new Map<string, number>();
        for (const [key, rowIndex] of session.keyToRowIndex) {
          if (dryRun) {
            keyToTestCaseId.set(key, rowIndex);
          } else {
            const id = importResult.createdTestCases.get(rowIndex);
            if (id !== undefined) keyToTestCaseId.set(key, id);
          }
        }
        // Resolve test-set folders once and reuse across all sets so cycles
        // sharing a folder path don't each recreate it.
        const existingFolders = dryRun ? [] : await client.getTestSetFolders();
        const sharedFolderResolver = createTestSetFolderResolver(client, existingFolders, logger, '/');
        for (const testSet of testSets) {
          send('phase', { message: `Creating Test Set "${testSet.name}"` });
          const tsr = await importTestSet(
            { testSet, keyToTestCaseId },
            {
              client,
              logger,
              existingTestSetFolders: existingFolders,
              rootFolder: s.import.rootFolder,
              folderResolver: dryRun ? undefined : sharedFolderResolver,
            },
            { dryRun },
          );
          testSetSummaries.push({
            name: tsr.testSetName,
            membersAdded: tsr.membersAdded,
            membersSkipped: tsr.membersSkipped,
            ordered: tsr.orderingApplied,
            error: tsr.error,
          });
        }
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
        testSets: testSetSummaries,
        // Back-compat: expose the first set under the old key too.
        testSet: testSetSummaries[0],
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
