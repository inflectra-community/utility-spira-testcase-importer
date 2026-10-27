# Requirements Document — Importer Beyond MVP

## Introduction

This document specifies the capabilities added to the Spira Test Case Importer **after** the original MVP (see `.kiro/specs/llm-test-case-importer/requirements.md`, which remains the authoritative record of the Excel → LLM → CLI import flow). It is a companion spec: the MVP requirements still hold, and everything here builds on the same shared infrastructure (Spira API client, template metadata, transformer, validator, import engine, logger).

The post-MVP surface covers: a second structured source format (Zephyr Scale bundles), Test Set creation, a browser-based UI, SpiraProvisioner structure-file export, heuristic pre-analysis as a first-class stage, and an artifact-strategy extensibility pattern.

> **Scope note (minimal, deliberate):** This companion spec currently contains the requirements only. A design document and task plan are intentionally deferred — the features are already implemented and covered by tests, so the highest-value artefact is an accurate requirements record. Design/tasks can be back-filled if the post-MVP surface undergoes further structured iteration.

## Glossary

Extends the MVP glossary. New or refined terms:

- **Source**: Any supported input the Importer can read — a `Source_Spreadsheet` (Excel) OR a `Zephyr_Bundle` (directory).
- **Zephyr_Bundle**: A directory exported from Zephyr Scale containing a `testcases/` folder of per-test-case JSON files, optional inline attachments (`attachments/inline/` with a `_map.json`), and an optional `testcycle/` folder describing a test cycle.
- **Test_Cycle**: A Zephyr Scale grouping of test cases scheduled for execution, including an ordered list of member test cases. Maps to a Spira `Test_Set`.
- **Test_Set**: A Spira artifact grouping test cases for execution, with an ordered membership. Lives in a test-set folder hierarchy.
- **Fuzzy_Match**: Deterministic name resolution that tolerates naming differences between a source and the Spira template (e.g. `High` → `2 - High`, `Country Code` → `Country`) via a cascade of exact, contains, suffix-strip and prefix-strip strategies.
- **Heuristic_Pre_Analysis**: A deterministic pass (no network, no LLM) that matches columns and resolves values before — and sometimes instead of — the LLM.
- **Provisioner_File**: A SpiraProvisioner-schema JSON document describing custom properties and list values that a Spira template is missing, so an admin can add them before re-running an import.
- **Artifact_Strategy**: A pluggable object that parameterises the Excel pipeline for a given Spira artifact type (field definitions, metadata fetch, validation rules, create requests).
- **Web_UI**: The browser-based front end served by the Importer's local web server, an alternative entry point to the CLI.

## Requirements

### Requirement 10: Zephyr Scale Bundle Import

**User Story:** As a user with test cases exported from Jira + Zephyr Scale, I want to import a Zephyr bundle directly, so that I do not have to convert it to a spreadsheet or rely on LLM mapping.

#### Acceptance Criteria

1. WHEN the Source path is a directory containing a `testcases/` subdirectory with at least one `.json` file, THE Importer SHALL treat it as a `Zephyr_Bundle` and use the Zephyr import path instead of the Excel path.
2. THE Importer SHALL map each Zephyr test case JSON directly to the internal test case model, including name, description, source key, test steps, folder path, tags, and custom field values, WITHOUT invoking an LLM.
3. WHEN a Zephyr test case references an inline image attachment, THE Importer SHALL resolve it via the bundle's `attachments/inline/_map.json` and upload it after the test case is created.
4. THE Importer SHALL resolve Zephyr field names and values (priority, status, component, custom properties, list values) to Spira IDs using `Fuzzy_Match`.
5. IF a Zephyr value cannot be resolved to a Spira template entry, THEN THE Importer SHALL record a warning and continue (the value is skipped, not treated as a failure).
6. THE Importer SHALL run the same validation and user-approval steps as the Excel path before performing any import.

### Requirement 11: Test Set Creation from a Test Cycle

**User Story:** As a user importing a Zephyr test cycle, I want a matching Spira Test Set created with its members in the right order, so that the execution grouping is preserved.

#### Acceptance Criteria

1. WHEN a `Zephyr_Bundle` contains a `testcycle/` definition, THE Importer SHALL create a Spira `Test_Set` named after the cycle after the member test cases have been imported.
2. THE Importer SHALL create the Test Set's folder hierarchy, reusing existing test-set folders where they already exist.
3. THE Importer SHALL add each imported member test case to the Test Set, preserving the cycle's member order via the Test Set mapping `Position`.
4. WHERE a member test case was not imported (e.g. it failed validation or creation), THE Importer SHALL skip it from the Test Set and record a warning.
5. THE Importer SHALL NOT import execution history (test runs or results) when creating the Test Set.
6. WHEN running in dry-run mode, THE Importer SHALL report the Test Set that would be created and its ordered members without making any mutating API calls.

### Requirement 12: Heuristic Pre-Analysis

**User Story:** As a user, I want obvious column and value mappings resolved deterministically, so that imports are faster, cheaper, and sometimes need no LLM at all.

#### Acceptance Criteria

1. WHEN Source_Spreadsheet data and Template metadata are available, THE Importer SHALL perform `Heuristic_Pre_Analysis` before any LLM call.
2. THE Heuristic_Pre_Analysis SHALL match source columns to Spira fields and custom properties, detect test-step and folder structure, and resolve lookup values to IDs, without network calls or LLM tokens.
3. WHEN Heuristic_Pre_Analysis resolves every column and value, THE Importer SHALL skip the LLM call entirely and proceed with the heuristic mapping.
4. WHEN Heuristic_Pre_Analysis cannot resolve all columns, THE Importer SHALL invoke the LLM only for the unresolved columns and SHALL merge the LLM result with the heuristic result, with heuristic resolutions taking precedence for columns both resolved.
5. IF Heuristic_Pre_Analysis fails unexpectedly, THEN THE Importer SHALL fall back to full-LLM mapping and continue.

### Requirement 13: SpiraProvisioner Structure-File Export

**User Story:** As a user whose Spira template lacks fields or list values my source data uses, I want to export a SpiraProvisioner file, so that an admin can extend the template and I can then import cleanly.

#### Acceptance Criteria

1. WHEN a Source has columns or custom properties that do not match any Spira template field, THE Importer SHALL offer to export a `Provisioner_File` describing them as new custom properties.
2. WHEN a Source uses list values not present in an existing Spira list property, THE Importer SHALL include those missing values in the `Provisioner_File`.
3. THE Importer SHALL infer each new custom property's type (list, text, integer, boolean, date) from the observed values, using a variability score to distinguish a likely drop-down (list) from free text.
4. THE `Provisioner_File` SHALL conform to the published SpiraProvisioner structure schema and SHALL reference it via the schema's canonical URL.
5. THE Importer SHALL present a human-readable summary of what the file adds, AND SHALL advise the user that inferred types are a best guess that should be reviewed before provisioning.
6. THE Importer SHALL support provisioner export for both the Excel and Zephyr source paths.
7. WHERE a gap cannot be expressed as a custom field (e.g. a missing priority, status, or component), THE Importer SHALL report it as informational rather than include it in the `Provisioner_File`.

### Requirement 14: Web User Interface

**User Story:** As a less technical user, I want a browser-based interface, so that I can configure, review, and run imports without using the command line.

#### Acceptance Criteria

1. THE Importer SHALL provide a local `Web_UI` as an alternative entry point to the CLI, serving the same import pipeline without reimplementing its logic.
2. THE Web_UI SHALL let the user enter and persist Spira connection and LLM settings locally, and SHALL test the Spira connection on request.
3. THE Web_UI SHALL let the user select or upload a Source, auto-detecting whether it is an Excel file or a Zephyr bundle.
4. FOR an Excel Source, THE Web_UI SHALL let the user choose a worksheet, review the generated mapping, edit value mappings, request LLM regeneration from feedback, and export a `Provisioner_File`.
5. FOR a Zephyr Source, THE Web_UI SHALL present the plan (test cases and the ordered Test Set) and offer provisioner export when gaps exist.
6. THE Web_UI SHALL run a dry-run or a live import and SHALL stream progress to the browser, and after a dry-run SHALL offer to proceed with the live import.
7. THE Web_UI SHALL store credentials only in a local settings file excluded from version control, consistent with the MVP's in-memory/environment-only credential handling intent.

### Requirement 15: Artifact Strategy Extensibility

**User Story:** As a maintainer, I want the Excel pipeline parameterised by artifact type, so that support for requirements, incidents, and other artifacts can be added without rewriting the pipeline.

#### Acceptance Criteria

1. THE Importer SHALL define an `Artifact_Strategy` interface covering field definitions, metadata retrieval, validation rules, create-request construction, artifact creation, and sub-item creation.
2. WHEN an `Artifact_Strategy` is supplied, THE Excel pipeline SHALL delegate artifact-specific behaviour to it; WHEN none is supplied, THE pipeline SHALL use the built-in test case behaviour.
3. THE Importer SHALL register at least the `test-case` strategy and SHALL expose the set of supported artifact types to the CLI.
4. THE Heuristic_Pre_Analysis and LLM prompt SHALL derive their field set from the active strategy's field definitions.

## Traceability

| Requirement | Primary code | Tests |
|-------------|--------------|-------|
| R10 Zephyr import | `src/parser/zephyr-bundle.ts`, `src/pipeline-zephyr.ts` | `src/pipeline-zephyr.test.ts` |
| R11 Test Sets | `src/importer/test-set-importer.ts`, `src/importer/test-set-folder-resolver.ts` | `src/importer/test-set-importer.test.ts` |
| R12 Heuristics | `src/heuristics/*`, `src/core/excel-mapping.ts` | `src/heuristics/*.test.ts`, `src/core/excel-mapping.test.ts` |
| R13 Provisioner | `src/provisioner/index.ts`, `analyzeZephyrGaps` | `src/provisioner/provisioner.test.ts` |
| R14 Web UI | `src/web/*` | (integration/manual; no feature file yet) |
| R15 Strategy | `src/strategies/*`, `src/types/strategy.ts` | (covered indirectly via pipeline) |
