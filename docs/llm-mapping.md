# LLM Mapping Strategy

The LLM is invoked only when heuristic pre-analysis cannot resolve all column mappings. Its scope is reduced to genuinely ambiguous columns.

## When the LLM Is Called

The LLM is invoked when `preAnalysis.fullyResolved === false` — meaning one or more columns couldn't be matched deterministically.

The LLM is **skipped** when all columns are resolved with confidence >= 0.7.

## What the LLM Receives

The LLM prompt includes:

1. **Pre-analysis context** — what's already been resolved (so it doesn't override correct heuristic decisions)
2. **Spira field definitions** — standard fields with types and descriptions
3. **Custom properties** — names, types, and list values from the template
4. **Source column headers** — all column names from the spreadsheet
5. **Sample data rows** — first 5 rows of actual data
6. **Output format instructions** — the MappingResult schema it must conform to

## What the LLM Decides

For unresolved columns, the LLM determines:
- Which Spira field it maps to (standard field or custom property by name)
- Transform type: `direct`, `lookup`, `template`, or `ignore`
- For lookups: the value-to-ID mapping
- For templates: the pattern combining multiple columns

## Structured Output

The tool uses the Vercel AI SDK's `generateObject()` with a Zod schema. This constrains the LLM to return valid JSON matching our `MappingResult` type — no manual JSON parsing or retry-on-malformed needed.

## Supported Providers

| Provider | Config | Notes |
|----------|--------|-------|
| AWS Bedrock | `provider: 'bedrock'`, `region`, AWS credentials | Uses `fromNodeProviderChain()` for credentials |
| OpenAI | `provider: 'openai'`, `apiKey` | Any model supporting structured output |
| Anthropic | `provider: 'anthropic'`, `apiKey` | Claude models |

## Retry Strategy

Transient failures (rate limits, timeouts, 5xx) are retried with exponential backoff:
- Attempt 1: immediate
- Attempt 2: after 1s
- Attempt 3: after 2s
- Attempt 4: after 4s
- After 4 failures: error reported, user offered retry/abort

Non-transient failures (auth, 4xx, invalid response) fail immediately.

## User Review Loop

After the LLM (or heuristics) produce a mapping:
1. The mapping is displayed with confidence indicators
2. The user can **accept**, **provide feedback** (re-prompts the LLM), or **abort**
3. Feedback is incorporated into a revision prompt sent to the same model
4. The cycle repeats until the user accepts

## Heuristic Value Override

Even when the LLM produces lookup maps, heuristic-resolved values are merged in and take precedence. This means correctly-resolved values (e.g., "Medium" -> ID 3) won't be overridden by LLM hallucinations.

## Value Suggestions (HITL)

When heuristic value resolution fails for some values, the LLM is asked to suggest mappings. These appear in the review UI:

```
│  Value Mappings
│  TestCaseStatusId: "New" -> Draft
│  TestCaseTypeId: "Manual" -> SKIP (no match)
```

The user can:
- **Accept** — use the LLM's suggestions as-is
- **Edit value mappings** — override each suggestion with a dropdown of available targets
- **Provide feedback** — ask the LLM to revise
- **Abort**

This handles the semantic gap between source data terminology and Spira's configured values without requiring the user to know the ID mappings upfront.

## Future: Reducing LLM Dependence

As the alias tables and heuristic matchers grow, fewer columns will need LLM assistance. The goal is that well-structured spreadsheets with standard column names resolve entirely without any LLM call — the LLM becomes a fallback for exotic formats only.
