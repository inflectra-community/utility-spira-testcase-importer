---
name: code-review
description: Reviews SpiraApp code for security vulnerabilities, test coverage gaps, and code smells (DRY violations, dead code, overly complex functions). Use this skill when a user wants a code audit, quality review, or asks about security, testing, or code smell issues. Activate when you see mentions of code review, audit, security review, test coverage, DRY, code smell, refactor, or code quality in a SpiraApp context.
---

# Code Review Skill

This skill performs a comprehensive code review of SpiraApp source files, producing three distinct reports:

1. **Security Report** — identifies vulnerabilities and unsafe patterns
2. **Testing Report** — identifies gaps in test coverage and testing quality
3. **Code Smell Report** — identifies DRY violations, complexity issues, and maintainability concerns

## How to Use

When triggered (via the `code-review` hook or manually), follow this process:

### Step 1: Identify the Target

Read `.kiro/steering/active-spiraapp-session.md` to find the current SpiraApp folder. If no session file exists, ask the user which SpiraApp folder to review.

### Step 2: Gather All Source Files

Read all `.js` files in the target SpiraApp folder. Also read the `manifest.yaml` for context about what the app does. Reference `.kiro/data/manifest-schema.json` to validate the manifest structure (valid pageIds, settingTypeIds, required fields, naming patterns).

### Step 3: Run the Three Analyses

---

## Security Analysis

Check for these issues, ordered by severity:

### Critical
- **Hardcoded secrets** — API keys, tokens, passwords in source code
- **eval() usage** — code injection risk
- **innerHTML with unsanitized input** — XSS vulnerability
- **document.write** — page destruction risk

### High
- **Unsanitized user input** — data from `spiraAppManager.getDataItemField()` used directly in HTML without escaping
- **Missing error handling** — API calls without failure callbacks (data leaks in error states)
- **Hardcoded GUIDs** — portability and security issue
- **Direct fetch/XMLHttpRequest** — bypasses auth, CORS issues

### Medium
- **Overly permissive patterns** — no permission checks before create/modify operations
- **Sensitive data in localStorage** — even via `setLocalData`, check what's being stored
- **Missing input validation** — settings values used without type checking

### Low
- **Console.log statements** — information disclosure in production
- **Commented-out code with sensitive info** — credentials in comments

---

## Testing Analysis

Check for these issues:

### Coverage Gaps
- **Untested public functions** — functions registered as event handlers or menu clicks that have no corresponding test
- **Missing error path tests** — only happy-path tested, no failure callback tests
- **Missing edge cases** — empty arrays, null values, undefined fields not tested
- **No integration tests** — API call chains not tested end-to-end

### Test Quality
- **Tests without assertions** — test functions that call code but don't verify results
- **Overly broad mocks** — mocking so much that tests don't verify real behavior
- **Missing setup/teardown** — shared state between tests causing flaky results
- **Hardcoded test data** — magic numbers/strings without explanation

### Test Structure
- **No test file exists** — the SpiraApp has no `tests/` directory at all
- **Test file doesn't match source** — source files changed but tests not updated
- **Missing test for each manifest page** — each page entry should have corresponding test coverage

---

## Code Smell Analysis (DRY Focus)

Check for these issues:

### DRY Violations
- **Duplicated logic blocks** — same 3+ lines appearing in multiple functions
- **Copy-paste callbacks** — success/failure handlers that are nearly identical across functions
- **Repeated API URL construction** — same URL pattern built in multiple places instead of using a constant or helper
- **Duplicated validation logic** — same checks performed in multiple functions

### Complexity
- **Functions over 40 lines** — likely doing too much, should be split
- **Deeply nested callbacks** — more than 3 levels of nesting (use async/await pattern instead)
- **Functions with 5+ parameters** — consider an options object
- **Cyclomatic complexity** — functions with many if/else branches

### Maintainability
- **Dead code** — functions defined but never called or registered
- **Magic numbers/strings** — unexplained literal values (should be constants)
- **Inconsistent naming** — mixing camelCase and snake_case, or not following `appName_action` convention
- **Missing constants.js** — repeated string literals that should be centralized
- **God functions** — one function handling multiple unrelated responsibilities

---

## Step 4: Present the Report

Format the output as three clear sections with severity indicators:

```
## 🔒 Security Report
[findings with severity: 🔴 Critical | 🟠 High | 🟡 Medium | 🔵 Low]

## 🧪 Testing Report  
[findings with priority: 🔴 Missing coverage | 🟠 Quality issue | 🟡 Structure issue]

## 🧹 Code Smell Report
[findings with type: 🔴 DRY violation | 🟠 Complexity | 🟡 Maintainability]
```

For each finding, include:
- **File and line reference** — where the issue is
- **What's wrong** — clear description
- **Why it matters** — impact if not fixed
- **Suggested fix** — brief description of the solution

---

## Step 5: Offer Resolution Options

After presenting the report, tell the user:

> I found [N] issues across the three categories. You can:
> 1. **Ask me to fix all** — I'll address every finding automatically
> 2. **Ask me to fix specific items** — tell me which findings to address (e.g. "fix Security #1 and #3, Code Smell #2")
> 3. **Fix manually** — use the report as a guide and make changes yourself
> 4. **Ignore** — acknowledge the findings and move on
>
> Which would you prefer?

Wait for the user's choice before making any changes.

---

## Important Notes

- Do NOT automatically fix anything. Always present the report first and wait for user direction.
- If a file is very large, focus on the most impactful findings (limit to top 5 per category).
- Cross-reference with SpiraApp prohibited patterns from the core-spiraapp skill.
- If the SpiraApp has no tests directory at all, that's the #1 finding in the Testing Report.
- Be specific — "line 42 in riskDetails.js" is better than "somewhere in the code."
