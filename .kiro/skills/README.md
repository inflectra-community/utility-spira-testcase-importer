# SpiraApp Builder Skills

These skills teach Kiro how to build SpiraApps correctly. They're loaded automatically by the route-skill hook during spec-driven development, or manually via `#skill-name` in chat.

## Skills Overview

| Skill | Purpose | Triggers on |
|-------|---------|-------------|
| `spiraapp-spec-guide` | Guides users through creating a SpiraApp spec | "build a SpiraApp", "create a spec", planning a new app |
| `core-spiraapp` | Foundational rules (always loaded during implementation) | Every spec task (always) |
| `manifest-structure` | How to write manifest.yaml files | manifest, settings, yaml, guid, metadata |
| `menu-interactions` | How to add toolbar menus and buttons | menu, button, toolbar, entry, click |
| `widget-dashboard` | How to build dashboard widgets | widget, dashboard, home page, my page |
| `column-templates` | How to add columns to list pages | column, grid, list page, template |
| `api-calls` | How to use spiraAppManager functions and internal API calls | executeApi, API, REST, GET, POST, PUT |
| `external-api` | How to call external services | executeRest, external, third-party, webhook |

## How They Work Together

### During Spec Creation
`spiraapp-spec-guide` loads when a user wants to plan a new SpiraApp. It interviews the user, summarizes understanding, and produces a spec with tasks named to trigger the right domain skills.

### During Implementation
The `route-skill` hook fires before each spec task:
1. Always loads `core-spiraapp`
2. Analyzes task keywords to load relevant domain skills
3. If no keywords match, checks the manifest to infer what's needed
4. If still unclear, loads all domain skills

### Key Principles
- **Ask, don't guess** — if something is unclear, ask the user
- **Verify before writing** — check API URLs against the index before using them
- **Trust the user** — if they say something contradicts the docs, believe them
- **Reference existing apps** — look at workspace SpiraApps as examples
- **Prefer promises** — wrap callback-based functions in async/await for new code
- **Soft warn, don't hard block** — warn about prohibited patterns but respect user's explicit choices

## Sources of Truth

Skills reference these documentation files:
- `.kiro/steering/spiraapp-developer-docs/SpiraApps-Manager.md` — all spiraAppManager functions
- `.kiro/steering/spiraapp-developer-docs/SpiraApps-Manifest.md` — manifest structure
- `.kiro/steering/spiraapp-developer-docs/SpiraApps-Overview.md` — general patterns and widgets
- `.kiro/steering/spiraapp-developer-docs/SpiraApps-Reference.md` — IDs, lookups, field names
- `.kiro/data/manifest-schema.json` — JSON Schema for manifest.yaml (valid enums, required fields, structural contract)
- `.kiro/data/spira-api-index.json` — API endpoint index (for URL verification)
- `.kiro/data/spira-api-spec.json` — full API spec (fallback)

## Existing SpiraApp Examples

Skills point to these workspace apps as reference patterns:
- `GitLab/` — CI/CD integration (single menu, executeRest)
- `AWS Bedrock/`, `ChatGPT/` — AI/GenAI (multiple menus, chained callbacks, constants.js)
- `my-assigned-work/`, `Quick-Tasks/` — Dashboard widgets (Mustache rendering)
- `Conditional-Lists/`, `Versioning/` — Data transformation (grid events, PUT operations)
- `risks-plus/` — Risk operations (permission checks, localState, associations)
