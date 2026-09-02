# Feature Backlog

## Planned Features (Next Iterations)

### 1. SpiraProvisioner Integration
**Priority:** High (workflow enabler)

Generate a SpiraProvisioner-compatible JSON file for unmatched columns, allowing admins to update their template before re-running the import.

- Analyse unmatched columns for data type (list vs text) based on value cardinality
- Output `customFields.testCases` array conforming to SpiraProvisioner schema
- Wire into review UI as "Export unmatched fields for provisioning" option
- Schema reference: `spira-structure.schema.json` from utility-spira-provisioner repo

---

### 2. Jira + Zephyr Scale JSON Import
**Priority:** High (Oetker requirement)

Add a parser module for Zephyr Scale JSON exports (test cases + adjacent attachment files).

- New parser: `src/parser/zephyr-json.ts` alongside the Excel parser
- Input: JSON file + adjacent attachment directory
- Same pipeline from parse onwards (heuristics, mapping, transform, validate, import)
- Attachment handling: files are local (no hyperlink resolution needed), upload directly
- May need a Zephyr-specific field definition set (different field names than Excel)
- The `--source-file` CLI option accepts `.json` as well as `.xlsx`
- Auto-detect format by extension or file content

---

### 3. Bulk Test Set Creation / Cross-Product Copy
**Priority:** High (Oetker requirement)

Support bulk creation of Test Sets, and copying test structures between Spira products.

**Needs further ideation:**

Option A: Read from Spira Product #1 via API, write to Product #2
- GET test cases, test sets, folder structure from source product
- POST to target product (remapping IDs)
- Handles cross-template differences (custom properties may differ)

Option B: Use Spira's Product Export schema as input
- Parse the export format
- Apply same transform/validate/import pipeline

Option C: New input format (JSON/YAML) defining test sets with test case references
- User defines which test cases go in which test sets
- Tool creates the test sets and maps test cases by name

**API considerations:**
- Test Sets: `POST /projects/{id}/test-sets`
- Test Set entries: `POST /projects/{id}/test-sets/{id}/test-case-mapping`
- Need to understand test set parameters (release mapping, configurations)

---

### 4. Web UI
**Priority:** Medium (UX improvement, needed for non-technical users)

Replace CLI with a browser-based interface. Functional first, pretty later.

**Core views:**
- Configuration (Spira URL, credentials, LLM provider)
- File upload (drag-and-drop Excel/JSON)
- Heuristic analysis dashboard (confidence bars, colour-coded)
- Mapping review (editable table, value dropdowns)
- Validation report (errors/warnings with row references)
- Import progress (live status, per-record)
- Summary (success/failure counts, log download)

**Technical approach:**
- Keep the pipeline logic as-is (it's UI-agnostic)
- Add a thin Express/Fastify API layer
- Replace Inquirer.js prompts with request/response cycles
- File upload replaces `--source-file` path
- Session-scoped credential storage (no persistent storage)
- Consider: single-page app (React/Vue) or server-rendered (htmx?)

**Brand alignment:**
- Use Inflectra colour palette from `docs/styleguide.json`
- Josefin Sans / Nunito typography
- Spira teal (#073640) backgrounds, yolk (#FDCB26) accents

---

### 5. Heuristic Improvements (from second customer test)
**Priority:** Medium

Issues surfaced by the HASTRAA dataset:
- "Sub Functionality" falsely matched to "Functionality" via substring (85% confidence)
  - Fix: exact custom property match should block substring matches on a different CP name
- "Module" → ComponentIds alias is too aggressive when the column likely represents a custom property
  - Fix: if a custom property named "Module" exists, prefer it over the ComponentIds alias
- Inline step detection was correct but step columns still ended up in LLM's unresolved list
  - Fix: structure-claimed columns should not appear in unresolved list

---

### 6. Mapping Memory (RAG / Vector Store)
**Priority:** Low (future scalability)

Store confirmed mappings as embeddings for retrieval on future imports.
- After user approval, persist the mapping record
- On next import, retrieve similar past mappings as Tier 2 hints
- Improves over time without code changes

---

### 7. Token Optimisation
**Priority:** Low

- Slim prompt mode for stronger models (tested: 78% reduction works for Claude, fails for Nova Lite)
- Per-model token budgets
- Batch import cost tracking and reporting
- Consider model routing: Nova Lite for simple decisions, Claude for complex ones

---

### 8. Fix: "Sub Functionality" substring false positive
**Priority:** High (blocks accurate matching for new datasets)

When a custom property "Functionality" exists AND "Sub Functionality" also exists, the substring matcher should not map "Sub Functionality" → "Functionality". Exact name match on an existing CP should take priority and block partial matches against other CPs with overlapping names.

---

### 9. Robot Framework Parser
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
