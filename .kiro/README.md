# SpiraApp Builder System

This `.kiro/` directory contains everything Kiro needs to build SpiraApps correctly — skills that teach it the rules, hooks that enforce quality automatically, and steering docs that provide context.

## Quick Start

1. Open this workspace in Kiro
2. Run `npm install` in `spiraapp-validator/`
3. Say "Create a SpiraApp that does X" — the system handles the rest

## Directory Structure

```
.kiro/
├── hooks/          → Automated quality checks
├── skills/         → Domain knowledge for SpiraApp development
├── steering/       → Always-on context docs and API tools
└── specs/          → Spec-driven development plans
```

## How It Works

### Skills (`.kiro/skills/`)
Teach Kiro how to build SpiraApps. Loaded automatically based on task keywords.

| Skill | What it teaches |
|-------|----------------|
| `core-spiraapp` | Foundational rules (always loaded) |
| `manifest-structure` | How to write manifest.yaml |
| `menu-interactions` | Toolbar buttons and click handlers |
| `widget-dashboard` | Dashboard widgets with Mustache/React |
| `column-templates` | Custom columns on list pages |
| `api-calls` | Internal Spira API calls |
| `external-api` | External REST API calls |
| `spiraapp-spec-guide` | Planning a new SpiraApp |
| `code-review` | Security, testing, and code smell analysis |
| `skill-creator` | Built-in Kiro skill for creating/editing skills |

### Hooks (`.kiro/hooks/`)
Automate quality enforcement during development.

| Hook | When | What it does |
|------|------|--------------|
| Spec Guide Trigger | On every message | Detects new SpiraApp requests, starts interview |
| Route Skills | Before each task | Loads the right skills |
| Check API URLs | Before writing .js | Verifies API endpoints exist |
| Validate Methods | Before writing .js | Checks spiraAppManager method names are valid |
| Manifest Length Check | Before writing manifest.yaml | Ensures tooltip/caption/placeholder ≤ 255 chars |
| Validate After Task | After each task | Runs the validator |
| Notify Build Ready | Agent stops | Reminds user to build if SpiraApp work was done |
| Full Audit | On demand | Comprehensive validation |
| Code Review | On demand | Security, testing, and DRY analysis with fix options |
| Build SpiraApp | On demand | Validates, packages, and uploads |
| Regenerate API Index | On spec file edit | Rebuilds the API index |

### Specs (`.kiro/specs/`)
Spec-driven development plans for larger features. Each spec folder contains requirements, design docs, and task lists that Kiro works through sequentially.

Current specs:
- `aiconnect-v1/` — SpiraAIConnect unified AI integration
- `spiraapp-builder-system/` — The builder system itself (this `.kiro/` setup)
- `spiraapp-spec-builder/` — The spec-guide interview workflow

### Steering (`.kiro/steering/`)
Always-on documentation and tools.

- **Official SpiraApp docs** — The single source of truth
- **API spec + index** — For endpoint verification
- **Session file** — Tracks current development state

## Validator

The `spiraapp-validator/` tool (at workspace root) validates SpiraApps:

```bash
# Quick check (per-file only)
node spiraapp-validator/spiraapp-validator.js MyApp --mode=task

# Full check (includes cross-file consistency)
node spiraapp-validator/spiraapp-validator.js MyApp

# Run tests
cd spiraapp-validator && npm test
```

### What it checks:
- Manifest structure and ID ranges
- Prohibited patterns (jQuery, localStorage, fetch, eval, etc.)
- API URL validity against the Spira spec
- Request body field validation
- Callback naming conventions
- Permission checks before modifying calls
- Menu-to-JS registration consistency
- Hardcoded GUID detection

## For New Team Members

1. Clone this repo
2. Run `npm install` in `spiraapp-validator/`
3. Open in Kiro — hooks and skills activate automatically
4. Say "Create a SpiraApp that..." or work on an existing app
5. The system validates your code as you go

## Architecture

```
User says "build a SpiraApp"
    ↓
spec-guide-trigger detects intent → activates interview skill
    ↓
spiraapp-spec-guide skill interviews user → produces spec
    ↓
route-skills-hook loads relevant skills per task
    ↓
Kiro writes code (guided by skills)
    ↓
check-api-urls hook verifies endpoints on .js writes
validate-spira-methods hook checks method names on .js writes
manifest-length-check hook enforces field lengths on manifest.yaml writes
    ↓
validate-after-task hook runs validator
    ↓
notify-build-ready reminds user to package
    ↓
User triggers "Build SpiraApp" → validates, packages, uploads
```
