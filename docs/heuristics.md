# Heuristic Pre-Analysis

The heuristic module (`src/heuristics/`) runs deterministically before any LLM call. It analyses your spreadsheet columns and values against the Spira template metadata, resolving as much as possible without network calls or token costs.

## How It Works

```
Spreadsheet + Spira Metadata
        |
        v
  Structure Detector  -->  Detects test step mode + folder columns
        |
        v
  Column Matcher      -->  Maps column headers to Spira fields
        |
        v
  Value Resolver      -->  Translates source values to Spira IDs
        |
        v
  PreAnalysisResult   -->  What's resolved vs what needs LLM
```

## Confidence Tiers

| Tier | Confidence | Meaning | Action |
|------|-----------|---------|--------|
| 1 | >= 0.95 | Deterministic (exact match, known alias) | Resolved, no LLM needed |
| 2 | 0.7 - 0.94 | Heuristic (fuzzy match, substring, pattern) | Resolved with lower confidence |
| 3 | < 0.7 | Ambiguous | Deferred to LLM |

If ALL columns resolve at Tier 1/2, the LLM call is skipped entirely.

## Column Matcher (`src/heuristics/column-matcher.ts`)

Matches source column headers to Spira field names using these strategies (in priority order):

| Priority | Strategy | Confidence | Example |
|----------|----------|-----------|---------|
| 1 | Exact match (case-insensitive) | 1.0 | "Name" = "Name" |
| 2 | Known alias table | 0.98 | "Priority" is alias for TestCasePriorityId |
| 3 | Prefix/suffix strip | 0.95 | "Test Case Name" strips to "Name" |
| 4a | Custom property exact match | 1.0 | "Precondition" = CP "Precondition" |
| 4b | Custom property substring | 0.9 | "Transaction" found in "Transaction Code" |
| 4c | Custom property fuzzy | similarity | Levenshtein > 0.8 |
| 5 | Levenshtein (against field aliases) | similarity | "Descrption" ~ "Description" |
| 6 | Contains match | 0.75 | "Step Description" contains "description" |

### Adding Aliases

Edit `FIELD_ALIASES` in `src/heuristics/column-matcher.ts`:

```typescript
const FIELD_ALIASES: Record<string, string[]> = {
  'Name': ['name', 'title', 'test name', 'tc name', 'scenario'],
  'Description': ['description', 'desc', 'details', 'summary'],
  'TestCasePriorityId': ['priority', 'prio', 'importance'],
  // Add your aliases here...
};
```

Each key is the Spira target field name. The array contains all known aliases (lowercase) that should match to it.

### When Multiple Fields Match

If a column matches multiple fields with similar confidence (gap < 0.1), it's flagged as **ambiguous** and deferred to the LLM. The LLM gets told what the candidates are.

## Value Resolver (`src/heuristics/value-resolver.ts`)

Once a column is matched to a lookup field (Priority, Status, Type, Owner, Component), the value resolver maps source text values to Spira entity IDs.

| Priority | Strategy | Confidence | Example |
|----------|----------|-----------|---------|
| 1 | Exact match | 1.0 | "Medium" = "Medium" |
| 2 | Strip numeric prefix | 0.95 | "Medium" matches "3 - Medium" |
| 3 | Source is substring of target | 0.85 | "Med" found in "3 - Medium" |
| 4 | Target is substring of source | 0.8 | "Medium Priority" contains "Medium" |
| 5 | Levenshtein (> 0.7 similarity) | similarity | "Meedium" ~ "Medium" |

The prefix-strip pattern (`/^\d+\s*[-:.)]\s*/`) handles Spira's common naming convention where priorities/statuses are prefixed: "1 - Critical", "2 - High", "3 - Medium", etc.

## Structure Detector (`src/heuristics/structure-detector.ts`)

Detects three structural patterns:

### Separate-Rows Test Steps

Detected when:
- A column matches step-number aliases ("Step #", "#") AND contains sequential integers
- Another column has low unique-value ratio (< 0.5) — the grouping column
- Values in the step-number column reset (1, 2, 3, 1, 2, 1, 2, 3...) per group

### Inline Test Steps

Detected when a text column's cells consistently match one of:
- `1. Step text` (numbered-dot)
- `Step 1: Step text` (step-prefix)
- `- Step text` or `* Step text` (bullet)
- `Step A; Step B; Step C` (semicolon-delimited)

Requires >= 60% of sampled cells to match the same pattern.

### Folder Hierarchy

Detected when a column's values contain path separators (`/`, `\`, `>`, `::`) in > 30% of rows. Bonus confidence for column names matching folder-like terms ("Module", "Folder", "Category").

## Performance

The entire pre-analysis runs in < 200ms for spreadsheets up to 1000 rows. No network calls, no LLM tokens.
