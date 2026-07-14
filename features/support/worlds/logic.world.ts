/**
 * Logic Layer World
 *
 * Tests business logic directly: transformer, validator, serializer, folder resolver.
 * No network calls, no LLM calls, no CLI. Pure function testing through Gherkin.
 */

import { setWorldConstructor, World } from '@cucumber/cucumber';
import type { MappingResult } from '../../../src/types/mapping.js';
import type { TransformedTestCase } from '../../../src/types/transform.js';
import type { ValidationResult } from '../../../src/types/validation.js';
import type { ImportResult } from '../../../src/types/import.js';
import type { TemplateMetadata } from '../../../src/types/spira.js';
import { createDataTransformer } from '../../../src/transformer/index.js';
import { createValidationEngine } from '../../../src/validator/index.js';
import { createImportEngine } from '../../../src/importer/index.js';
import { createLogger } from '../../../src/logger/index.js';

export class LogicWorld extends World {
  templateMetadata: TemplateMetadata | null = null;
  sourceData: { headers: string[]; rows: Record<string, unknown>[] } | null = null;
  mappingResult: MappingResult | null = null;
  transformedTestCases: TransformedTestCase[] | null = null;
  validationResult: ValidationResult | null = null;
  importResult: ImportResult | null = null;
  error: Error | null = null;
  dryRun = false;

  // For logic layer, we use fixture/stub metadata
  async loadTemplateMetadata(_projectId: number): Promise<void> {
    // Load from fixture — no real API call
    this.templateMetadata = {
      projectId: _projectId,
      templateId: 1,
      priorities: [
        { priorityId: 1, name: 'Critical', active: true, score: 4 },
        { priorityId: 2, name: 'High', active: true, score: 3 },
        { priorityId: 3, name: 'Medium', active: true, score: 2 },
        { priorityId: 4, name: 'Low', active: true, score: 1 },
      ],
      statuses: [
        { testCaseStatusId: 1, name: 'Draft', active: true },
        { testCaseStatusId: 2, name: 'Ready for Review', active: true },
        { testCaseStatusId: 3, name: 'Approved', active: true },
      ],
      types: [
        { testCaseTypeId: 1, name: 'Functional', active: true, isDefault: true },
        { testCaseTypeId: 2, name: 'Performance', active: true, isDefault: false },
        { testCaseTypeId: 3, name: 'Security', active: true, isDefault: false },
      ],
      customProperties: [
        {
          customPropertyId: 1,
          propertyNumber: 1,
          name: 'Automation Status',
          artifactTypeName: 'TestCase',
          customPropertyTypeId: 6,
          customPropertyTypeName: 'List',
          customListId: 1,
          isRequired: false,
        },
        {
          customPropertyId: 2,
          propertyNumber: 2,
          name: 'Test Environment',
          artifactTypeName: 'TestCase',
          customPropertyTypeId: 1,
          customPropertyTypeName: 'Text',
          isRequired: false,
        },
      ],
      customLists: new Map([
        [1, [
          { customPropertyValueId: 1, name: 'Not Automated', active: true },
          { customPropertyValueId: 2, name: 'Automated', active: true },
          { customPropertyValueId: 3, name: 'Planned', active: true },
        ]],
      ]),
      users: [
        { userId: 1, fullName: 'John Smith', userName: 'jsmith', active: true },
        { userId: 2, fullName: 'Jane Doe', userName: 'jdoe', active: true },
      ],
      components: [
        { componentId: 1, name: 'Login Module', active: true },
        { componentId: 2, name: 'Dashboard', active: true },
      ],
      existingFolders: [],
    };
  }

  async parseSpreadsheet(_filePath: string): Promise<void> {
    // For logic layer, source data is set directly via step definitions
    // (no actual file parsing — that's tested in the parser unit tests)
  }

  async performMapping(): Promise<void> {
    // For logic layer, mapping result is set directly via step definitions
    // (no LLM call — we provide a predetermined mapping)
  }

  async transformData(): Promise<void> {
    if (!this.sourceData || !this.mappingResult || !this.templateMetadata) {
      throw new Error('Missing source data, mapping, or metadata for transformation');
    }

    try {
      const transformer = createDataTransformer();
      const result = transformer.transform(
        this.sourceData.rows,
        this.mappingResult,
        this.templateMetadata,
      );
      this.transformedTestCases = result.testCases;
    } catch (err) {
      this.error = err instanceof Error ? err : new Error(String(err));
    }
  }

  async validateData(): Promise<void> {
    if (!this.transformedTestCases || !this.templateMetadata) {
      throw new Error('Missing transformed test cases or metadata for validation');
    }

    try {
      const validator = createValidationEngine();
      this.validationResult = validator.validate(this.transformedTestCases, this.templateMetadata);
    } catch (err) {
      this.error = err instanceof Error ? err : new Error(String(err));
    }
  }

  async executeImport(): Promise<void> {
    if (!this.transformedTestCases || !this.templateMetadata) {
      throw new Error('Missing test cases or metadata for import');
    }

    // For logic layer, use a mock client that tracks calls
    const mockCalls: { method: string; path: string }[] = [];
    const mockClient = {
      async createTestCase(request: any) {
        if (request.Name === '__FAIL__') {
          throw new Error('Simulated API failure for test case');
        }
        mockCalls.push({ method: 'POST', path: '/test-cases' });
        return { TestCaseId: mockCalls.length };
      },
      async addTestSteps(testCaseId: number, steps: unknown[]) {
        mockCalls.push({ method: 'POST', path: `/test-cases/${testCaseId}/test-steps` });
      },
      async createTestFolder(request: unknown) {
        mockCalls.push({ method: 'POST', path: '/test-folders' });
        return { testCaseFolderId: mockCalls.length, name: 'mock', indentLevel: '0' };
      },
    } as any;

    const logger = createLogger();
    const importEngine = createImportEngine({
      client: mockClient,
      logger,
      existingFolders: this.templateMetadata.existingFolders,
      customPropertyDefinitions: this.templateMetadata.customProperties,
    });

    try {
      this.importResult = await importEngine.import(this.transformedTestCases, {
        dryRun: this.dryRun,
        onProgress: () => {},
      });
    } catch (err) {
      this.error = err instanceof Error ? err : new Error(String(err));
    }
  }
}

setWorldConstructor(LogicWorld);
