# Pipeline Refactor Plan: Core / Adapter Split

## Current State

```mermaid
flowchart TD
    subgraph "Already Headless (no changes needed)"
        CLIENT["spira/client.ts<br/>SpiraApiClient"]
        META["spira/metadata.ts<br/>fetchAllMetadata()"]
        PARSER["parser/index.ts<br/>createExcelParser()"]
        ZPARSER["parser/zephyr-bundle.ts<br/>parseZephyrBundle()"]
        HEURISTICS["heuristics/index.ts<br/>analyzeSpreadsheet()"]
        MAPPING["mapping/engine.ts<br/>createMappingEngine()"]
        TRANSFORMER["transformer/index.ts<br/>createDataTransformer()"]
        VALIDATOR["validator/index.ts<br/>createValidationEngine()"]
        REPORT["report/index.ts<br/>generateValidationReport()"]
        IMPORTER["importer/index.ts<br/>createImportEngine()"]
        PROVISIONER["provisioner/index.ts<br/>generateProvisionerConfig()"]
        FUZZY["pipeline-zephyr.ts<br/>fuzzyMatchName()<br/>resolveZephyrMetadata()"]
    end

    subgraph "Tangled: Logic + I/O Mixed (needs refactoring)"
        PIPELINE["pipeline.ts<br/>runPipeline() — 872 lines"]
        ZPIPELINE["pipeline-zephyr.ts<br/>runZephyrPipeline() — 230 lines"]
    end

    subgraph "I/O Concerns Embedded in Pipelines"
        direction LR
        BANNER["Config banner<br/>(ANSI stdout)"]
        PROMPTS["Inquirer prompts<br/>(select, input)"]
        PROGRESS["Progress display<br/>(stdout overwrite)"]
        SUMMARY["Summary display<br/>(ANSI tables)"]
    end

    PIPELINE --> BANNER
    PIPELINE --> PROMPTS
    PIPELINE --> PROGRESS
    PIPELINE --> SUMMARY
    ZPIPELINE --> BANNER
    ZPIPELINE --> PROMPTS
    ZPIPELINE --> PROGRESS
    ZPIPELINE --> SUMMARY

    style PIPELINE fill:#f99,stroke:#c00
    style ZPIPELINE fill:#f99,stroke:#c00
    style BANNER fill:#fcc
    style PROMPTS fill:#fcc
    style PROGRESS fill:#fcc
    style SUMMARY fill:#fcc
```

## Target State

```mermaid
flowchart TD
    subgraph "Core (headless, typed I/O, no terminal dependency)"
        STAGES["src/core/stages.ts<br/><br/>connect() → ConnectResult<br/>fetchMetadata() → MetadataResult<br/>parseSource() → ParseResult<br/>analyzeHeuristics() → PreAnalysisResult<br/>generateMapping() → MappingResult<br/>applyFeedback() → MappingResult<br/>transform() → TransformResult<br/>validate() → ValidationResult<br/>executeImport(onProgress) → ImportResult<br/>uploadAttachments() → AttachmentResult<br/>resolveZephyrMetadata() → ResolveResult"]
    end

    subgraph "Adapter Interface"
        ADAPTER["PipelineAdapter (interface)<br/><br/>displayBanner(config)<br/>selectWorksheet(sheets[]) → name<br/>displayPreAnalysis(summary)<br/>reviewMapping(mapping) → decision<br/>editValues(suggestions[]) → edits<br/>requestFeedback() → string<br/>approveImport(report) → decision<br/>reportProgress(current, total, item)<br/>displaySummary(result)"]
    end

    subgraph "CLI Adapter"
        CLI["src/cli/adapter.ts<br/><br/>implements PipelineAdapter<br/>using @inquirer/prompts<br/>+ ANSI terminal output"]
    end

    subgraph "Web Adapter"
        WEB["src/web/adapter.ts<br/><br/>implements PipelineAdapter<br/>using Express REST + SSE<br/>+ HTML/JS frontend"]
    end

    STAGES --> ADAPTER
    CLI --> ADAPTER
    WEB --> ADAPTER

    style STAGES fill:#9f9,stroke:#090
    style ADAPTER fill:#ff9,stroke:#990
    style CLI fill:#9cf,stroke:#06c
    style WEB fill:#9cf,stroke:#06c
```

## Decision Points (where adapters interact)

| # | Decision | Input | Output |
|---|----------|-------|--------|
| 1 | Worksheet selection | `sheets: {name, rowCount, headers}[]` | `selectedSheet: string` |
| 2 | Mapping review | `MappingResult + preAnalysis` | `'accept' \| 'editValues' \| 'feedback' \| 'provisioner' \| 'abort'` |
| 2a | Edit values | `ValueSuggestion[]` | `edited ValueSuggestion[]` |
| 2b | Export provisioner | needs program name + product name | `{programName, productName}` |
| 2c | Feedback | (free text prompt) | `string` |
| 3 | Import approval | `ValidationReport + stats` | `'proceed' \| 'revise' \| 'abort'` |
| 3a | Revision feedback | (free text prompt) | `string` |
| 4 | Zephyr approval | `validation stats + warnings` | `'proceed' \| 'abort'` |

## What Stays, What Moves

### Stays in place (already correct)
- `src/spira/client.ts` — headless HTTP client
- `src/spira/metadata.ts` — headless metadata fetch
- `src/parser/index.ts` — headless Excel parser
- `src/parser/zephyr-bundle.ts` — headless Zephyr parser
- `src/heuristics/index.ts` — headless analysis
- `src/mapping/engine.ts` — headless LLM mapping
- `src/transformer/index.ts` — headless data transform
- `src/validator/index.ts` — headless validation
- `src/report/index.ts` — headless report generation (returns string)
- `src/importer/index.ts` — headless import engine (progress via callback)
- `src/provisioner/index.ts` — headless config generation
- `src/types/*` — all type definitions

### Moves / Refactors

| Current Location | Moves To | Nature of Change |
|-----------------|----------|-----------------|
| `pipeline.ts` — orchestration logic | `src/core/orchestrator.ts` | Strip I/O, accept `PipelineAdapter` |
| `pipeline.ts` — `convertPreAnalysisToMapping()` | `src/core/orchestrator.ts` | Already pure, just relocate |
| `pipeline.ts` — `mergeLookupMaps()` | `src/core/orchestrator.ts` | Already pure, just relocate |
| `pipeline.ts` — `processValueSuggestions()` | `src/core/orchestrator.ts` | Already pure, just relocate |
| `pipeline.ts` — `displayMappingSummary()` | CLI adapter | Terminal-only presentation |
| `pipeline.ts` — `displayImportSummary()` | CLI adapter | Terminal-only presentation |
| `pipeline.ts` — all `select()`/`input()` calls | Adapter interface calls | Becomes `await adapter.reviewMapping(...)` etc. |
| `pipeline.ts` — ANSI banner | CLI adapter `displayBanner()` | Terminal-only |
| `pipeline-zephyr.ts` — `runZephyrPipeline()` | `src/core/orchestrator.ts` (Zephyr path) | Strip I/O, share adapter |
| `pipeline-zephyr.ts` — `fuzzyMatchName()` | `src/core/fuzzy-match.ts` | Already pure, extract to own module |
| `pipeline-zephyr.ts` — `resolveZephyrMetadata()` | `src/core/zephyr-resolver.ts` | Already pure, extract to own module |
| `src/cli.ts` | `src/cli/index.ts` | Thin: create CLI adapter, call orchestrator |

### New Files

| File | Purpose |
|------|---------|
| `src/core/orchestrator.ts` | Pipeline stage orchestration — calls modules + adapter at decision points |
| `src/core/fuzzy-match.ts` | Extracted fuzzy name matcher (already exported, just needs own file) |
| `src/core/zephyr-resolver.ts` | Extracted Zephyr metadata resolver |
| `src/core/types.ts` | `PipelineAdapter` interface + stage result types |
| `src/cli/adapter.ts` | CLI adapter — inquirer + ANSI output |
| `src/web/server.ts` | Express server |
| `src/web/adapter.ts` | Web adapter — translates HTTP ↔ adapter interface |
| `src/web/public/` | HTML/JS/CSS frontend |

## Estimated Effort

The refactor is primarily mechanical:
1. Define `PipelineAdapter` interface (1 file, ~50 lines)
2. Extract orchestration from `pipeline.ts` into `core/orchestrator.ts` (move logic, replace I/O with adapter calls)
3. Create `cli/adapter.ts` using existing display/prompt code (move, don't rewrite)
4. Verify everything still works via CLI
5. Build web adapter + frontend

Steps 1–4 are ~2 hours of focused work. The existing tests don't touch the pipeline orchestrator (they test the headless modules directly), so the refactor carries low regression risk.
