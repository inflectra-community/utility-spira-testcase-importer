# Steering Documentation

Steering files provide context and rules that guide Kiro during SpiraApp development.

## Always-On Files (loaded every interaction)

📄 **`spiraapp-official-docs.md`** — Critical rules and pointers to official docs
📄 **`active-spiraapp-session.md`** — Tracks current SpiraApp folder, loaded skills, decisions

## Reference Documentation (loaded via skills, not directly)

📁 **`spiraapp-developer-docs/`** — Complete Inflectra documentation (single source of truth)
- `SpiraApps-Tutorial.md` — Step-by-step tutorial (embedded in spiraapp-spec-guide skill)
- `SpiraApps-Overview.md` — Concepts and development process (embedded in spiraapp-spec-guide skill)
- `SpiraApps-Reference.md` — IDs, types, field names, lookups (embedded in multiple skills)
- `SpiraApps-Manifest.md` — Manifest specification (embedded in manifest-structure skill)
- `SpiraApps-Manager.md` — spiraAppManager API reference (embedded in api-calls, menu, widget skills)

## Data Files (in `.kiro/data/`)

These are consumed by hooks and scripts programmatically — not loaded as agent context:
- `.kiro/data/spira-api-spec.json` — Full OpenAPI spec (25k lines)
- `.kiro/data/spira-api-index.json` — Lightweight API index (auto-generated)
- `.kiro/data/spira-api-reference.md` — Human-readable API reference
- `.kiro/data/manifest-schema.json` — JSON Schema for manifest.yaml (validates structure, enums, constraints)
- `.kiro/data/generate-api-index.js` — Index generator script
- `.kiro/data/api-tools/` — Package tooling for the generator

**Consumed by:**
- `check-api-urls` hook — verifies executeApi URLs against the index/spec
- `regenerate-api-index` hook — rebuilds the index when the spec changes
- `spiraapp-validator` — validates API URLs in full audit mode
- `manifest-schema.json` — used by skills and external agents to validate manifest structure

## How Steering Works

- Files with no front-matter default to `inclusion: always`
- Files with `inclusion: conditional` + `fileMatchPattern` load when matching files are opened
- Files with `inclusion: manual` load when referenced via `#filename` in chat

## Important Notes

- Always use official documentation as the single source of truth
- API data files live in `data/` — they support hooks/validator, not direct agent context
- Skills embed the relevant docs via `#[[file:...]]` references
