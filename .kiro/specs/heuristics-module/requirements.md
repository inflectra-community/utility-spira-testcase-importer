# Requirements Document: Heuristics Pre-Analysis Module

## Introduction

The Heuristics Module is a deterministic pre-processing layer that sits between spreadsheet parsing and LLM-assisted mapping. It analyses the source spreadsheet structure and values against the Spira template metadata, resolving as many column mappings and value translations as possible without invoking the LLM. Only genuinely ambiguous or unresolvable cases are passed to the LLM, significantly reducing the LLM's scope and improving mapping accuracy.

## Glossary

- **Tier 1 (Deterministic)**: Mappings resolved by exact match, regex, or direct string comparison against known metadata. Zero ambiguity.
- **Tier 2 (Heuristic)**: Mappings resolved by fuzzy matching, pattern detection, or structural inference. High confidence but not certain.
- **Tier 3 (LLM-Required)**: Mappings that cannot be resolved deterministically — require semantic understanding or domain knowledge.
- **Confidence**: A score (0.0–1.0) indicating how certain the heuristic is about a mapping.
- **Pre-Filled Mapping**: A partial MappingResult populated by Tiers 1 and 2, with unresolved columns flagged for LLM processing.
- **Structure Detection**: Identifying spreadsheet layout patterns (separate-rows test steps, inline steps, folder hierarchy) from data shape rather than content meaning.
- **Value Resolution**: Translating a source spreadsheet value (e.g., "Medium") to the corresponding Spira entity ID (e.g., priorityId: 3) by matching against template metadata.

## Requirements

### Requirement 1: Column-to-Field Matching

**User Story:** As the pipeline, I want source column names matched to Spira field names deterministically where possible, so the LLM only handles ambiguous column assignments.

#### Acceptance Criteria

1. WHEN a source column name exactly matches a known Spira field name (case-insensitive), THE matcher SHALL assign it with confidence 1.0
2. WHEN a source column name matches a known Spira field name after stripping common prefixes/suffixes (e.g., "Test Case Name" → "Name"), THE matcher SHALL assign it with confidence 0.95
3. WHEN a source column name fuzzy-matches a known Spira field name (normalised Levenshtein distance > 0.8), THE matcher SHALL assign it with confidence proportional to the similarity score
4. WHEN a source column name matches a custom property name from the template metadata, THE matcher SHALL assign it with confidence 1.0
5. WHEN multiple Spira fields could match a source column, THE matcher SHALL flag it as ambiguous (Tier 3) and defer to the LLM
6. THE matcher SHALL provide the list of unmatched columns to downstream processing

### Requirement 2: Value Resolution

**User Story:** As the pipeline, I want source values resolved to Spira IDs without LLM involvement where the values are recognisable variants of known metadata entries.

#### Acceptance Criteria

1. WHEN a source value exactly matches a known Spira lookup name (case-insensitive), THE resolver SHALL return the corresponding ID with confidence 1.0
2. WHEN a source value matches after stripping numeric prefixes (e.g., "2 - High" → "High", "3 - Medium" → "Medium"), THE resolver SHALL return the corresponding ID with confidence 0.95
3. WHEN a source value is a substring of a known Spira lookup name (or vice versa), THE resolver SHALL return the best match with confidence 0.8
4. WHEN a source value has a normalised Levenshtein distance < 0.3 from a known Spira lookup name, THE resolver SHALL return it as a candidate with confidence proportional to similarity
5. WHEN no match can be found for a source value, THE resolver SHALL flag it as unresolved
6. THE resolver SHALL operate across all lookup types: priorities, statuses, types, users (by full name or username), components, and custom list values

### Requirement 3: Structure Detection — Separate-Rows Test Steps

**User Story:** As the pipeline, I want to automatically detect when a spreadsheet uses separate rows for test steps (grouped by a parent test case identifier), so the transformer handles them correctly without relying on the LLM to infer this.

#### Acceptance Criteria

1. WHEN a column contains repeating values where another column contains sequential integers (1, 2, 3...), THE detector SHALL identify this as a separate-rows step pattern
2. THE detector SHALL identify the grouping column (the one with repeating values — e.g., test case ID or name)
3. THE detector SHALL identify the step number column (sequential integers resetting per group)
4. THE detector SHALL identify candidate step description and expected result columns based on their position relative to the step number column
5. WHEN the ratio of unique values in the grouping column to total rows is < 0.5, THE detector SHALL consider this a strong signal for separate-rows mode
6. THE detector SHALL report its findings with a confidence score

### Requirement 4: Structure Detection — Inline Test Steps

**User Story:** As the pipeline, I want to detect when test steps are embedded within a single cell as formatted text, so they can be split into individual steps during transformation.

#### Acceptance Criteria

1. WHEN a cell contains text matching numbered line patterns (e.g., "1. Do X\n2. Do Y"), THE detector SHALL identify it as inline steps with delimiter "numbered-dot"
2. WHEN a cell contains text matching step-prefix patterns (e.g., "Step 1: Do X\nStep 2: Do Y"), THE detector SHALL identify it as inline steps with delimiter "step-prefix"
3. WHEN a cell contains text matching bullet patterns (e.g., "• Do X\n• Do Y" or "- Do X\n- Do Y"), THE detector SHALL identify it as inline steps with delimiter "bullet"
4. WHEN a cell contains text with consistent semicolon or pipe delimiters separating action-like phrases, THE detector SHALL identify it as inline steps with the corresponding delimiter
5. THE detector SHALL sample multiple cells from the candidate column to confirm the pattern is consistent (not a one-off)
6. THE detector SHALL distinguish between genuine step content and multi-line descriptions (steps have action-oriented phrasing; descriptions are narrative)

### Requirement 5: Structure Detection — Folder Hierarchy

**User Story:** As the pipeline, I want to detect columns that represent folder paths or hierarchical categories, so test cases can be organized into folders automatically.

#### Acceptance Criteria

1. WHEN a column contains values with hierarchical path separators (/, \, >, →, ::), THE detector SHALL flag it as a folder path column
2. WHEN a column contains values that share common prefixes and form a tree-like structure, THE detector SHALL flag it as a folder path column
3. THE detector SHALL report the detected path separator
4. WHEN multiple columns could be folder paths, THE detector SHALL rank them by structural signal strength

### Requirement 6: Pre-Analysis Orchestration

**User Story:** As the pipeline, I want all heuristic analyses coordinated into a single pre-analysis pass that produces a pre-filled mapping, so the LLM receives only the unresolved remainder.

#### Acceptance Criteria

1. THE orchestrator SHALL run all detectors and matchers in a single pass over the spreadsheet data
2. THE orchestrator SHALL produce a PreAnalysisResult containing: resolved column mappings (with confidence), resolved value lookups, detected structure (step mode, folder column), and unresolved columns requiring LLM
3. THE orchestrator SHALL not modify the source data — it produces analysis metadata only
4. THE orchestrator SHALL complete within 1 second for spreadsheets up to 1000 rows (no network calls, no LLM)
5. WHEN the pre-analysis resolves ALL columns with confidence > 0.9, THE pipeline MAY skip the LLM call entirely and present the mapping directly for user review
6. THE orchestrator SHALL provide a human-readable summary of what was resolved vs what needs LLM assistance

### Requirement 7: Integration with Existing Pipeline

**User Story:** As a developer, I want the heuristics module to integrate cleanly with the existing pipeline without breaking the current flow.

#### Acceptance Criteria

1. THE heuristics module SHALL accept the same inputs as the current LLM prompt builder: SheetData and TemplateMetadata (or ArtifactMetadata)
2. THE heuristics module SHALL produce output compatible with the existing MappingResult type
3. WHEN the LLM is invoked after pre-analysis, the prompt SHALL include the pre-analysis context (what was already resolved) so the LLM can focus on unresolved items
4. THE heuristics module SHALL be strategy-aware — it uses FieldDefinition[] from the ArtifactStrategy to know what fields exist
5. THE existing pipeline SHALL continue to work unchanged when the heuristics module is not enabled (backward compatible)
6. THE pre-analysis results SHALL be visible in the mapping review UI so the user can see what was heuristically resolved vs LLM-resolved

