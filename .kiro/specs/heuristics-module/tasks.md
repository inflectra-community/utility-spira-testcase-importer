# Implementation Plan: Heuristics Pre-Analysis Module

## Overview

Implement a deterministic heuristics layer (`src/heuristics/`) that pre-analyses spreadsheet data against Spira metadata before LLM invocation. The module resolves column mappings, value translations, and structural patterns, reducing LLM scope to genuinely ambiguous cases only.

## Tasks

- [ ] 1. Create heuristics module structure and types
  - [ ] 1.1 Create `src/heuristics/types.ts` with interfaces: ColumnMatch, ColumnMatchResult, ValueResolutionResult, StepStructure, FolderStructure, StructureDetectionResult, PreAnalysisResult, PreAnalysisConfig
  - [ ] 1.2 Create `src/heuristics/index.ts` as the orchestrator entry point (stub)
  - _Requirements: 6.1, 6.2, 7.1_

- [ ] 2. Implement Column Matcher
  - [ ] 2.1 Create `src/heuristics/column-matcher.ts` with the alias table and matching strategies
  - [ ] 2.2 Implement exact match (case-insensitive) → confidence 1.0
  - [ ] 2.3 Implement known alias lookup → confidence 0.98
  - [ ] 2.4 Implement prefix/suffix stripping → confidence 0.95
  - [ ] 2.5 Implement custom property name matching → confidence 1.0
  - [ ] 2.6 Implement normalised Levenshtein similarity → confidence = similarity score
  - [ ] 2.7 Handle ambiguity: multiple candidates above threshold → flag for LLM
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 3. Implement Value Resolver
  - [ ] 3.1 Create `src/heuristics/value-resolver.ts`
  - [ ] 3.2 Implement exact match (case-insensitive) for all lookup types
  - [ ] 3.3 Implement numeric prefix stripping (`/^\d+\s*[-–—:.\)]\s*/`)
  - [ ] 3.4 Implement substring containment matching (both directions)
  - [ ] 3.5 Implement Levenshtein distance matching (threshold < 0.3)
  - [ ] 3.6 Implement user matching (fullName, userName, partial)
  - [ ] 3.7 Collect unique values per column first to avoid redundant matching
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 4. Implement Structure Detector
  - [ ] 4.1 Create `src/heuristics/structure-detector.ts`
  - [ ] 4.2 Implement separate-rows detection: grouping column identification (uniqueRatio < 0.5)
  - [ ] 4.3 Implement separate-rows detection: step number column identification (sequential integers resetting per group)
  - [ ] 4.4 Implement separate-rows detection: step content column identification (proximity + name heuristics)
  - [ ] 4.5 Implement inline step detection: numbered-dot pattern recognizer
  - [ ] 4.6 Implement inline step detection: step-prefix pattern recognizer
  - [ ] 4.7 Implement inline step detection: bullet pattern recognizer
  - [ ] 4.8 Implement inline step detection: semicolon/pipe delimiter recognizer
  - [ ] 4.9 Implement inline step detection: sampling + consistency threshold (60%)
  - [ ] 4.10 Implement folder hierarchy detection: separator scanning + prefix tree analysis
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4_

- [ ] 5. Implement Pre-Analysis Orchestrator
  - [ ] 5.1 Wire structure detection → column matching → value resolution in correct order
  - [ ] 5.2 Exclude structure-claimed columns from general column matching
  - [ ] 5.3 Compute `fullyResolved` flag based on confidence thresholds
  - [ ] 5.4 Generate human-readable summary string for CLI display
  - [ ] 5.5 Export `analyzeSpreadsheet()` as the public API
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 6. Integrate with pipeline
  - [ ] 6.1 Insert pre-analysis between Phase 3 (parse) and Phase 4 (LLM mapping) in pipeline.ts
  - [ ] 6.2 When `fullyResolved === true`, skip LLM and convert PreAnalysisResult to MappingResult directly
  - [ ] 6.3 When not fully resolved, build enhanced LLM prompt with pre-analysis context (resolved columns, remaining columns)
  - [ ] 6.4 Merge LLM result with heuristic result to produce final MappingResult
  - [ ] 6.5 Display pre-analysis summary in CLI before mapping review
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 7. Write tests
  - [ ] 7.1 Unit tests for column matcher: exact, alias, prefix-strip, fuzzy, ambiguity
  - [ ] 7.2 Unit tests for value resolver: exact, prefix-strip, substring, Levenshtein, user matching
  - [ ] 7.3 Unit tests for structure detector: separate-rows (Dr. Oetker pattern), inline steps (multiple formats), folder detection
  - [ ] 7.4 Integration test: run full pre-analysis against the Sample-TestCase-Import.xlsx fixture
  - [ ] 7.5 Verify all 64 existing Cucumber scenarios still pass (backward compatibility)

- [ ] 8. Add Gherkin features for heuristic behavior
  - [ ] 8.1 Create `features/heuristic-column-matching.feature` with scenarios for each matching tier
  - [ ] 8.2 Create `features/heuristic-value-resolution.feature` with scenarios for each resolution strategy
  - [ ] 8.3 Create `features/heuristic-structure-detection.feature` with scenarios for separate-rows, inline, and folder detection

## Future Tasks (not in this iteration)

- [ ] * Mapping persistence: save confirmed mappings to a local store after user approval
- [ ] * Vector embedding: encode mapping records for similarity search
- [ ] * RAG retrieval: before heuristics, retrieve similar past mappings as Tier 2 hints
- [ ] * Learning feedback loop: user corrections update stored mapping vectors

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10"] },
    { "id": 3, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 4, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 6, "tasks": ["8.1", "8.2", "8.3"] }
  ]
}
```
