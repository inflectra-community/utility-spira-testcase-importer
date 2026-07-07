# Implementation Plan: LLM Test Case Importer

## Overview

A standalone Node.js/TypeScript CLI tool implementing a multi-phase pipeline (Connect → Parse → Map → Transform/Validate → Import) that uses LLM-assisted mapping to import test cases from Excel spreadsheets into Spira. The implementation follows an incremental approach: project scaffolding, then core components built bottom-up, wired together through the pipeline orchestrator and CLI.

## Tasks

- [x] 1. Set up project structure and core interfaces
  - [x] 1.1 Initialize TypeScript project with build tooling
    - Initialize npm project with `package.json` (name: `spira-test-case-importer`, type: module)
    - Install dependencies: `typescript`, `zod`, `exceljs`, `ai` (Vercel AI SDK), `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/amazon-bedrock`, `commander`, `inquirer`, `fast-check`, `vitest`
    - Create `tsconfig.json` with strict mode, ES2022 target, NodeNext module resolution
    - Create `vitest.config.ts` with test configuration
    - Create directory structure: `src/config/`, `src/spira/`, `src/parser/`, `src/mapping/`, `src/transformer/`, `src/validator/`, `src/importer/`, `src/logger/`, `src/types/`
    - Add build and test scripts to `package.json`
    - _Requirements: 1.1, 4.1_

  - [x] 1.2 Define shared type definitions and Zod schemas
    - Create `src/types/spira.ts` with all Spira data model interfaces (`TestCasePriority`, `TestCaseStatus`, `TestCaseType`, `CustomPropertyDefinition`, `CustomListValue`, `ProjectUser`, `Component`, `TestCaseFolder`, `TemplateMetadata`)
    - Create `src/types/config.ts` with `SpiraConfig`, `LLMConfig`, and `ImporterConfig` interfaces and Zod validation schemas
    - Create `src/types/mapping.ts` with `FieldMapping`, `MappingResult`, `TestStepMappingConfig`, `FolderMappingConfig` interfaces and Zod schemas
    - Create `src/types/transform.ts` with `TransformedTestCase`, `TransformedTestStep`, `CustomPropertyValue`, `TransformationResult`, `TransformationError` interfaces
    - Create `src/types/validation.ts` with `ValidationError`, `ValidationResult` interfaces
    - Create `src/types/import.ts` with `ImportResult`, `ImportFailure`, `CreateTestCaseRequest`, `CreateTestStepRequest`, `CreateFolderRequest`, `RemoteCustomProperty` interfaces
    - _Requirements: 2.1, 2.2, 2.3, 5.3, 6.1, 7.1_

- [x] 2. Implement Configuration Module
  - [x] 2.1 Create configuration loader and validator
    - Create `src/config/index.ts` implementing configuration loading from CLI args and environment variables
    - Validate `SpiraConfig` (baseUrl, username, apiKey, projectId) using Zod schemas
    - Validate `LLMConfig` (provider, model, apiKey/region) using Zod schemas
    - Validate file path existence for `sourceFile`
    - Return clear error messages for invalid configuration
    - _Requirements: 1.2, 1.4, 4.1, 4.3, 4.5_

  - [ ]* 2.2 Write unit tests for Configuration Module
    - Test valid config parsing for all provider types
    - Test error messages for missing required fields
    - Test environment variable fallback behavior
    - _Requirements: 1.2, 4.1, 4.5_

- [x] 3. Implement Logger
  - [x] 3.1 Create structured logger with file persistence
    - Create `src/logger/index.ts` implementing the `Logger` interface
    - Implement `info`, `warn`, `error` methods with structured context and timestamps
    - Implement `apiRequest` method for logging HTTP method, URL, status code, and duration
    - Implement `persist` method that writes all accumulated log entries to a JSON file
    - Support configurable log file path (default: `import-log-{timestamp}.json` in working directory)
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]* 3.2 Write unit tests for Logger
    - Test log entry formatting and timestamp accuracy
    - Test file persistence writes valid JSON
    - Test API request logging captures all fields
    - _Requirements: 9.2, 9.3_

- [x] 4. Implement Spira API Client
  - [x] 4.1 Create HTTP client with authentication
    - Create `src/spira/client.ts` implementing the `SpiraApiClient` interface
    - Implement Base64 authentication header construction (`username:apiKey` encoded)
    - Implement `authenticate()` method that validates connection via `GET /projects/{project_id}`
    - Add request/response logging via the Logger
    - Implement single retry with 2-second delay for 5xx responses
    - _Requirements: 1.1, 1.2, 1.3, 9.2_

  - [ ]* 4.2 Write property test for authentication header round-trip
    - **Property 1: Authentication header round-trip**
    - For any valid username and API key, the constructed Authorization header is a valid Base64 encoding of `username:apiKey`, and decoding yields the original credentials
    - **Validates: Requirements 1.2**

  - [x] 4.3 Implement template metadata retrieval methods
    - Implement `getCustomProperties(artifactTypeName)` — GET `/project-templates/{template_id}/custom-properties/TestCase`
    - Implement `getCustomListValues(customListId)` — GET `/project-templates/{template_id}/custom-lists/{list_id}`
    - Implement `getTestCasePriorities()`, `getTestCaseStatuses()`, `getTestCaseTypes()`
    - Implement `getProjectUsers()` and `getComponents()`
    - Implement `getTestFolders()` — GET `/projects/{project_id}/test-folders`
    - Create `src/spira/metadata.ts` with a `fetchAllMetadata()` function that calls all retrieval methods and assembles the `TemplateMetadata` object
    - Handle partial failures: report which metadata could not be retrieved, continue with remaining
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 4.4 Implement test case and folder creation methods
    - Implement `createTestCase(testCase)` — POST `/projects/{project_id}/test-cases`
    - Implement `addTestSteps(testCaseId, steps)` — POST `/projects/{project_id}/test-cases/{id}/test-steps/multiple`
    - Implement `createTestFolder(folder)` — POST `/projects/{project_id}/test-folders`
    - _Requirements: 7.1, 7.2, 8.1_

  - [ ]* 4.5 Write unit tests for Spira API Client
    - Test authentication failure error messages
    - Test retry behavior on 5xx responses
    - Test no retry on 4xx responses
    - Test metadata assembly with partial failures
    - _Requirements: 1.3, 2.5_

- [x] 5. Checkpoint - Core infrastructure validated
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Excel Parser
  - [x] 6.1 Create spreadsheet parser with worksheet selection
    - Create `src/parser/index.ts` implementing the `ExcelParser` interface
    - Use ExcelJS to read `.xlsx` and `.xls` files
    - Extract headers from first row, map each subsequent row to `Record<string, unknown>` keyed by header
    - Preserve data types (strings, numbers, booleans, dates)
    - Implement `getSampleRows(sheet, count)` returning first N rows for LLM prompt
    - Return descriptive error if file cannot be read or parsed
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 6.2 Write property test for spreadsheet data preservation
    - **Property 2: Spreadsheet data preservation**
    - For any set of column headers and row data, writing to an Excel workbook and parsing back produces a structure where every original value is accessible via its original column header and row index
    - **Validates: Requirements 3.3**

  - [ ]* 6.3 Write unit tests for Excel Parser
    - Test multi-worksheet file handling
    - Test error cases (missing file, corrupted file, empty file)
    - Test date and boolean value preservation
    - _Requirements: 3.1, 3.4, 3.5_

- [x] 7. Implement LLM Mapping Engine
  - [x] 7.1 Create LLM provider factory and prompt builder
    - Create `src/mapping/provider.ts` with factory function that instantiates the correct Vercel AI SDK provider based on `LLMConfig.provider` (OpenAI, Anthropic, Bedrock)
    - Create `src/mapping/prompt.ts` implementing prompt construction that includes: all Spira field definitions, custom property definitions with list values, source column headers, 3-5 sample data rows
    - Define the `MappingResult` Zod schema for `generateObject` structured output
    - _Requirements: 4.1, 5.1, 5.2_

  - [ ]* 7.2 Write property test for LLM prompt completeness
    - **Property 3: LLM prompt completeness**
    - For any combination of source column headers, sample rows, and template metadata, the constructed prompt contains every source column header, every custom property name, every custom list value name, and all standard field definitions
    - **Validates: Requirements 5.1, 5.2**

  - [x] 7.3 Implement mapping generation and retry logic
    - Create `src/mapping/engine.ts` implementing the `LLMMappingEngine` interface
    - Implement `generateMapping()` using Vercel AI SDK's `generateObject` with MappingResult Zod schema
    - Implement `retryMapping()` that incorporates user feedback into a revised prompt
    - Add exponential backoff with 3 retries for transient LLM failures (rate limits, timeouts)
    - Handle and report LLM provider errors with descriptive messages
    - _Requirements: 5.1, 5.3, 5.6, 5.7_

  - [ ]* 7.4 Write unit tests for LLM Mapping Engine
    - Test provider factory creates correct SDK instances
    - Test retry logic with mocked transient failures
    - Test error handling for invalid LLM responses
    - _Requirements: 4.2, 4.4, 5.6_

- [x] 8. Implement Data Transformer
  - [x] 8.1 Create data transformation engine
    - Create `src/transformer/index.ts` implementing the `DataTransformer` interface
    - Implement `direct` transform: copy source value directly to target field
    - Implement `lookup` transform: map source value through `lookupMap` to Spira ID/value
    - Implement `template` transform: combine multiple source columns using template pattern
    - Implement `ignore` transform: skip the source column
    - Handle test step extraction (inline mode with delimiter splitting, separate-rows mode)
    - Handle folder path extraction from mapped column
    - Accumulate per-row errors and warnings in `TransformationResult`
    - _Requirements: 5.7, 6.1_

  - [ ]* 8.2 Write property test for data transformation correctness
    - **Property 4: Data transformation correctness**
    - For any set of source rows and valid confirmed mapping, the transformer produces one TransformedTestCase per source row where each mapped field contains the correctly transformed value according to its transform type and lookup map
    - **Validates: Requirements 5.7, 6.1**

  - [ ]* 8.3 Write unit tests for Data Transformer
    - Test each transform type with edge cases (empty values, missing keys in lookup)
    - Test test step inline extraction with various delimiters
    - Test error accumulation for malformed rows
    - _Requirements: 5.7, 6.1_

- [x] 9. Implement Validation Engine
  - [x] 9.1 Create validation engine with rule-based checks
    - Create `src/validator/index.ts` implementing the `ValidationEngine` interface
    - Implement required-field check: Name must be non-empty
    - Implement status/type validation: TestCaseStatusId and TestCaseTypeId must reference valid template values
    - Implement priority validation: TestCasePriorityId (if set) must reference an active priority
    - Implement owner validation: OwnerId (if set) must reference an active project member
    - Implement custom list value validation: list/multilist values must match active entries
    - Implement custom property type validation: values must match expected type (text, integer, decimal, boolean, date, list, multiselect)
    - Aggregate all errors and warnings with row index and field name
    - Compute stats (totalTestCases, validTestCases, totalTestSteps, errorCount, warningCount)
    - _Requirements: 6.2, 6.3, 6.4_

  - [ ]* 9.2 Write property test for required field validation
    - **Property 5: Required field validation**
    - For any TransformedTestCase, the validation engine reports an error if and only if the Name field is empty or missing
    - **Validates: Requirements 6.2**

  - [ ]* 9.3 Write property test for custom list value validation
    - **Property 6: Custom list value validation**
    - For any custom property of type "list" or "multilist", the validation engine reports an error if and only if the value does not match an active entry in the corresponding custom list
    - **Validates: Requirements 6.3**

  - [ ]* 9.4 Write unit tests for Validation Engine
    - Test each validation rule in isolation
    - Test combined validation across multiple rules
    - Test warning vs error severity classification
    - _Requirements: 6.2, 6.3, 6.4_

- [x] 10. Checkpoint - Transform and validate pipeline verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Custom Property Serializer
  - [x] 11.1 Create custom property serialization logic
    - Create `src/transformer/custom-property-serializer.ts`
    - Implement serialization from `CustomPropertyValue` to `RemoteCustomProperty` format
    - Map property types to correct value fields: StringValue (text), IntegerValue (integer/decimal), BooleanValue (boolean), DateTimeValue (date), IntegerListValue (list/multiselect)
    - Ensure exactly one value field is populated per property
    - _Requirements: 7.3_

  - [ ]* 11.2 Write property test for custom property serialization
    - **Property 9: Custom property serialization correctness**
    - For any custom property definition and value, the serialized RemoteCustomProperty uses exactly one value field matching the property's type
    - **Validates: Requirements 7.3**

  - [ ]* 11.3 Write unit tests for Custom Property Serializer
    - Test each property type serialization
    - Test null/undefined value handling
    - _Requirements: 7.3_

- [x] 12. Implement Folder Resolver
  - [x] 12.1 Create folder hierarchy resolution and creation
    - Create `src/importer/folder-resolver.ts`
    - Implement folder path parsing (handle configurable separator)
    - Build a folder tree from folder paths, creating intermediate folders as needed
    - Check existing folders in Spira before creating new ones (reuse existing)
    - Cache created folders to avoid duplicate creation within a session
    - Return `TestCaseFolderId` for each test case based on its deepest folder path
    - Assign `null` for test cases with no folder path (root level)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 12.2 Write property test for folder resolution correctness
    - **Property 12: Folder resolution correctness**
    - For any set of folder paths, the resolver creates all necessary folders forming a valid tree, and each test case is assigned the TestCaseFolderId of its deepest folder
    - **Validates: Requirements 8.1, 8.2, 8.4**

  - [ ]* 12.3 Write property test for folder reuse idempotence
    - **Property 13: Folder reuse idempotence**
    - For any folder path that already exists, the resolver returns the existing folder's ID without creating a new folder. Running resolution twice produces the same IDs without duplicates
    - **Validates: Requirements 8.3**

  - [ ]* 12.4 Write unit tests for Folder Resolver
    - Test deeply nested paths
    - Test mixed existing and new folders
    - Test empty folder path handling
    - _Requirements: 8.1, 8.3, 8.4_

- [x] 13. Implement Import Engine
  - [x] 13.1 Create import engine with progress tracking and resilient execution
    - Create `src/importer/index.ts` implementing the `ImportEngine` interface
    - Implement per-record import: create test case, then add test steps, then set custom properties
    - Use the Folder Resolver for folder hierarchy creation before test case import
    - Implement progress callback reporting (current/total/item name)
    - Implement resilient error handling: log failures per-record, continue with remaining
    - Track `ImportResult` with success/failure counts and failure details
    - Implement dry-run mode: validate and transform data without making any mutating API calls
    - Implement graceful shutdown on SIGINT/SIGTERM: complete in-flight request, log state, persist log, exit
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.6, 9.1, 9.4_

  - [ ]* 13.2 Write property test for no API writes before approval
    - **Property 8: No API writes before approval**
    - For any pipeline execution state where user approval has not been given, the number of mutating API calls to the Spira REST API is exactly zero
    - **Validates: Requirements 6.8**

  - [ ]* 13.3 Write property test for resilient import with correct accounting
    - **Property 10: Resilient import with correct accounting**
    - For any batch of N test cases where K arbitrary test cases fail, the importer attempts all N, and `successCount + failureCount == totalAttempted`, `failureCount == failures.length`
    - **Validates: Requirements 7.4, 7.5**

  - [ ]* 13.4 Write property test for dry-run zero API writes
    - **Property 11: Dry-run zero API writes**
    - For any input data processed with `dryRun: true`, the import engine makes exactly zero mutating HTTP requests
    - **Validates: Requirements 7.6**

  - [ ]* 13.5 Write property test for interruption state accuracy
    - **Property 14: Interruption state accuracy**
    - For any interruption at index K in a batch of N items, the logged state accurately reflects exactly which items were processed and which remain unprocessed
    - **Validates: Requirements 9.4**

  - [ ]* 13.6 Write unit tests for Import Engine
    - Test progress callback invocation
    - Test failure isolation (one failure doesn't stop others)
    - Test dry-run produces no HTTP calls
    - Test graceful shutdown logging
    - _Requirements: 7.4, 7.5, 7.6, 9.1, 9.4_

- [x] 14. Implement Approval Report Generator
  - [x] 14.1 Create mapping validation report generator
    - Create `src/report/index.ts`
    - Generate a structured report containing: total test case count, sample transformed records (first 3-5), validation error count and details, warning count, field mapping summary
    - Format report for terminal display (structured text with sections)
    - _Requirements: 6.5_

  - [ ]* 14.2 Write property test for validation report completeness
    - **Property 7: Validation report completeness**
    - For any TransformationResult and ValidationResult, the report contains: total count matching testCases.length, at least one sample record when test cases exist, error count matching errors.length, warning count matching warnings.length, and a non-empty field mapping summary
    - **Validates: Requirements 6.5**

  - [ ]* 14.3 Write unit tests for Report Generator
    - Test report with zero errors/warnings
    - Test report with many errors (truncation/summary)
    - Test sample record formatting
    - _Requirements: 6.5_

- [x] 15. Checkpoint - All components implemented and tested
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement CLI and Pipeline Orchestrator
  - [x] 16.1 Create CLI entry point with Commander.js
    - Create `src/cli.ts` as the main entry point
    - Define CLI commands and options using Commander.js: `--spira-url`, `--username`, `--api-key`, `--project-id`, `--provider`, `--model`, `--llm-api-key`, `--region`, `--source-file`, `--dry-run`, `--log-file`
    - Support environment variable fallbacks for credentials (`SPIRA_URL`, `SPIRA_USERNAME`, `SPIRA_API_KEY`, `LLM_API_KEY`, `AWS_REGION`)
    - Parse and validate all inputs via the Configuration Module
    - Wire to the pipeline orchestrator
    - Add shebang and `bin` entry in `package.json`
    - _Requirements: 1.2, 1.4, 4.1, 4.3, 4.5_

  - [x] 16.2 Create pipeline orchestrator with interactive prompts
    - Create `src/pipeline.ts` implementing the full pipeline flow
    - Phase 1: Authenticate against Spira and fetch template metadata
    - Phase 2: Parse Excel spreadsheet, prompt user for worksheet selection via Inquirer.js (if multiple sheets)
    - Phase 3: Invoke LLM Mapping Engine with source data and metadata
    - Phase 4: Present mapping result to user for review/modification via Inquirer.js
    - Phase 5: Transform data using confirmed mapping, run validation
    - Phase 6: Generate and display Mapping Validation Report, require explicit user approval
    - Phase 7 (if approved and not dry-run): Execute import with progress display
    - Phase 8: Persist log file and display summary report
    - Handle rejection at Phase 6: loop back to mapping review
    - _Requirements: 3.5, 5.4, 5.5, 6.5, 6.6, 6.7, 6.8, 7.5, 9.3_

  - [ ]* 16.3 Write integration tests for pipeline orchestrator
    - Test full pipeline with mocked Spira API and LLM provider
    - Test dry-run mode stops before import
    - Test rejection loops back to mapping
    - _Requirements: 6.6, 6.7, 6.8, 7.6_

- [x] 17. Final checkpoint - Full integration verified
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (14 properties total)
- Unit tests validate specific examples and edge cases
- The steering file rules about vanilla JS/SpiraApps do NOT apply to this project — this is a standalone Node.js/TypeScript CLI tool, not a SpiraApp
- All LLM interactions use Vercel AI SDK's `generateObject` with Zod schemas for type-safe structured output

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3"] },
    { "id": 5, "tasks": ["4.4", "4.5", "6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3"] },
    { "id": 8, "tasks": ["7.4", "8.1"] },
    { "id": 9, "tasks": ["8.2", "8.3", "9.1"] },
    { "id": 10, "tasks": ["9.2", "9.3", "9.4", "11.1"] },
    { "id": 11, "tasks": ["11.2", "11.3", "12.1"] },
    { "id": 12, "tasks": ["12.2", "12.3", "12.4", "13.1"] },
    { "id": 13, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6", "14.1"] },
    { "id": 14, "tasks": ["14.2", "14.3", "16.1"] },
    { "id": 15, "tasks": ["16.2"] },
    { "id": 16, "tasks": ["16.3"] }
  ]
}
```
