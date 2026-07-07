# Tech Stack & Constraints

## Language & Runtime
- Vanilla JavaScript (ES6+) — no TypeScript, no transpilation
- All SpiraApp JS files are wrapped in IIFEs (immediately invoked function expressions)
- No external npm dependencies in SpiraApp code — only the spiraAppManager API is available
- CSS for styling (no preprocessors)
- YAML for manifests

## Platform Constraints
- No DOM library access (no jQuery, no React) — use native DOM APIs
- No localStorage, sessionStorage, or cookies
- No fetch() or XMLHttpRequest — use spiraAppManager.executeApi / executeRest / executeAwsBedrockRuntime
- No eval(), Function(), or dynamic code execution
- Callback-based API (executeApi) with optional promise wrapper (executeApiAsync)
- Code runs inside Spira's page context — no module system, no imports

## Tooling
- spiraapp-validator (Node.js) — validates manifest structure, prohibited patterns, API URLs
- spiraapp-package-generator (external repo at ../spiraapp-package-generator) — bundles and uploads .spiraapp files
- jsconfig.json with checkJs disabled — for IDE support only

## Preferences
- Prefer async/await with executeApiAsync for new code
- Use constants.js for shared values (APP_GUID is NOT defined here — it's auto-provided)
- Use common.js for shared utility functions within a SpiraApp
- Descriptive callback names: `operationName_Success`, `operationName_Failure`
- No minification — code ships readable
