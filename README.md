# SpiraTestCaseImporter
Using LLMs to reconcile customer Test Case data to Spira's data model on import

## Architecture

The tool operates as a multi-phase pipeline, parameterized by an **ArtifactStrategy** that makes it extensible to any Spira artifact type (test cases, requirements, incidents, etc.).

```mermaid
flowchart TD
    CLI["CLI Entry Point<br/><code>--artifact-type test-case</code>"]
    CLI --> Strategy["Strategy Registry<br/><code>createStrategy()</code>"]
    Strategy --> TC["TestCaseStrategy"]
    Strategy -.-> RQ["RequirementStrategy<br/><i>(future)</i>"]
    Strategy -.-> IN["IncidentStrategy<br/><i>(future)</i>"]

    CLI --> Pipeline["Pipeline Orchestrator"]

    Pipeline --> P1["Phase 1: Authenticate"]
    Pipeline --> P2["Phase 2: Fetch Metadata"]
    Pipeline --> P3["Phase 3: Parse Excel"]
    Pipeline --> P4["Phase 4: LLM Mapping"]
    Pipeline --> P5["Phase 5: Transform & Validate"]
    Pipeline --> P6["Phase 6: Approval Report"]
    Pipeline --> P7["Phase 7: Import"]

    subgraph "Strategy-Driven (artifact-agnostic)"
        P2 -->|"strategy.fetchMetadata()"| SpiraClient
        P4 -->|"buildMappingPromptFromStrategy()"| LLM["LLM Provider<br/>(OpenAI / Anthropic / Bedrock)"]
        P5 -->|"strategy.getFieldDefinitions()"| Transformer
        P5 -->|"strategy.getValidationRules()"| Validator
        P7 -->|"strategy.buildCreateRequest()<br/>strategy.createArtifact()<br/>strategy.createSubItems()"| Importer
    end

    subgraph "Shared Infrastructure (universal)"
        SpiraClient["Spira API Client"]
        Parser["Excel Parser<br/>(ExcelJS)"]
        Transformer["Data Transformer"]
        Validator["Validation Engine"]
        Importer["Import Engine"]
        Logger["Logger"]
        FolderResolver["Folder Resolver"]
    end

    P3 --> Parser
    P7 --> FolderResolver
    FolderResolver --> SpiraClient
    Importer --> SpiraClient
    Pipeline --> Logger

    style TC fill:#e8f5e9
    style RQ fill:#fff3e0,stroke-dasharray: 5 5
    style IN fill:#fff3e0,stroke-dasharray: 5 5
```

### How the Strategy Plugs In

Each pipeline component accepts an optional strategy configuration. When provided, artifact-specific behavior is delegated to the strategy. When absent, the built-in test case logic runs (backward compatible).

| Component | Strategy Hook | What It Controls |
|-----------|--------------|-----------------|
| Transformer | `fieldDefinitions` | Which target fields are standard vs custom properties |
| Validator | `externalRules` | Artifact-specific validation (required fields, valid lookups) |
| Importer | `strategy` | Request building, API creation, sub-item creation |
| Prompt Builder | `StrategyPromptConfig` | LLM prompt field tables, lookup values, sub-item instructions |
| Pipeline | `PipelineOptions.strategy` | Metadata fetching, wiring all of the above |

### Adding a New Artifact Type

```bash
spira-import --artifact-type requirement --source-file data.xlsx --provider openai --model gpt-4o
```

1. Create `src/strategies/requirement.strategy.ts` implementing `ArtifactStrategy`
2. Register it in `src/strategies/index.ts`
3. Done — the pipeline handles the rest
