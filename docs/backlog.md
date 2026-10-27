# Feature Backlog

## Shipped

- **SpiraProvisioner integration** — exports unmatched columns + missing list values as a SpiraProvisioner JSON file (with list-vs-text inference via variability scoring). Available in the Excel mapping-review step.
- **Zephyr Scale bundle import** — `src/parser/zephyr-bundle.ts` parses a bundle directory (`testcases/*.json`, inline attachments, `testcycle/*.json`) and maps directly to the import pipeline. Auto-detected when `SOURCE_PATH` is a directory containing `testcases/`.
- **Zephyr Test Set creation with ordering** — the bundle's test cycle becomes a Spira Test Set: folder hierarchy built, members added, `Position` set to preserve cycle order. Execution history intentionally excluded.
- **Web UI (Zephyr + Excel)** — Express server (`src/web/`) + single-page front end for settings, source selection/upload, plan review, and live (SSE) import progress. Both import paths work: Zephyr bundles (plan review + ordered Test Set) and Excel (worksheet selection → mapping review with editable value dropdowns and LLM feedback → validation plan). The Excel mapping stage is shared with the CLI via `src/core/excel-mapping.ts`.

## Planned Features (Next Iterations)

### A. Web UI polish (follow-ups)
**Priority:** Low

The Excel path works end-to-end, including SpiraProvisioner structure-file export from the mapping review. Remaining niceties:
- Editable field-mapping table (currently value mappings are editable, but field→target reassignment is only via LLM feedback).
- Drag-and-drop upload (currently a file picker).

### B. Bulk Test Set Creation / Cross-Product Copy
**Priority:** Medium (customer follow-up)

Copying test structures between Spira products, beyond the single-cycle Test Set we now create from Zephyr.

Option A: Read from Spira Product #1 via API, write to Product #2 (remap IDs, handle cross-template differences)
Option B: Use Spira's Product Export schema as input
Option C: New input format (JSON/YAML) defining test sets with test case references

---

### C. Heuristic Improvements (from second customer test)
**Priority:** Medium

Issues surfaced by a customer dataset:
- **"Sub Functionality" substring false positive (High priority):** when a custom property "Functionality" exists AND "Sub Functionality" also exists, the substring matcher maps "Sub Functionality" → "Functionality". Exact name match on an existing CP should take priority and block partial matches against other CPs with overlapping names.
- "Module" → ComponentIds alias is too aggressive when the column likely represents a custom property
  - Fix: if a custom property named "Module" exists, prefer it over the ComponentIds alias
- Inline step detection was correct but step columns still ended up in LLM's unresolved list
  - Fix: structure-claimed columns should not appear in unresolved list

> Note: the Zephyr fuzzy matcher (`fuzzyMatchName` in `src/pipeline-zephyr.ts`) addresses a related class of issues on the Zephyr path; the fixes above apply to the Excel heuristic matcher (`src/heuristics/`).

---

### D. Mapping Memory (RAG / Vector Store)
**Priority:** Low (future scalability)

Store confirmed mappings as embeddings for retrieval on future imports.
- After user approval, persist the mapping record
- On next import, retrieve similar past mappings as Tier 2 hints
- Improves over time without code changes

---

### E. Token Optimisation
**Priority:** Low

- Slim prompt mode for stronger models (tested: 78% reduction works for Claude, fails for Nova Lite)
- Per-model token budgets
- Batch import cost tracking and reporting
- Consider model routing: Nova Lite for simple decisions, Claude for complex ones

---

### F. Robot Framework Parser
**Priority:** TBD (future development)

Parse Robot Framework test suites and create matching test cases in Spira, extracting detail from the actual test case definitions (not a spreadsheet abstraction).

- New parser for Robot Framework source files (`.robot`, and possibly `.resource`)
- Extract per-test-case detail: test name, documentation, tags, keywords/steps, setup/teardown
- Map Robot test cases → Spira test cases; keywords/steps → Spira test steps
- Consider Robot's structure: Settings, Variables, Test Cases, Keywords sections
- Tags → Spira tags or custom properties
- `[Documentation]` → test case description; `[Tags]` → tags; keyword calls → test steps
- Suite hierarchy (directories / suite files) → Spira folder structure
- Joins the existing pipeline at the `TransformedTestCase[]` stage, like the Zephyr parser (structural mapping, no LLM needed)
- Auto-detect: directory or file containing `.robot` suites
