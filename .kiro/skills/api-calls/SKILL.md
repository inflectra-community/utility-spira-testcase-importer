---
name: api-calls
description: How to make internal Spira REST API calls from SpiraApps using executeApi and executeApiAsync. Use this skill whenever writing code that retrieves, creates, updates, or deletes Spira data. Activate when you see mentions of executeApi, executeApiAsync, API call, REST, GET, POST, PUT, DELETE, projects/, artifacts, or spiraAppManager API methods in a SpiraApp context.
---

# SpiraApp Internal API Calls & spiraAppManager Functions

Before writing any code that uses spiraAppManager, read `.kiro/steering/spiraapp-developer-docs/SpiraApps-Manager.md` for the complete function reference. This skill is a quick reference — the docs are the source of truth. If something here conflicts with the docs, trust the docs.

## Function Categories

spiraAppManager provides functions in these categories:

| Category | Functions | Async? |
|----------|-----------|--------|
| Internal API calls | executeApi, executeApiAsync | Callback / Promise |
| External API calls | executeRest, executeAwsBedrockRuntime | Callback |
| Storage (server) | storageInsert/Get/Update/Delete (System/User/Product/ProductUser) | Callback |
| Storage (local) | getLocalData, setLocalData, removeLocalData | Synchronous |
| Page data | getDataItemField, getLiveFormFieldValue, updateFormField | Synchronous |
| Dropdowns | getDropdownItems, setDropdownItemsIsActive | Synchronous |
| Grid | getGridSelectedItems, reloadGrid | Synchronous |
| Form | reloadForm, saveForm | Synchronous |
| Notifications | displayErrorMessage, displaySuccessMessage, displayWarningMessage, displayConfirmation, hideMessage | Synchronous |
| Events | registerEvent_* (loaded, dataSaved, windowLoad, etc.) | Registration only |
| UX | createComboDialog, setWindowLocation | Synchronous |
| Context | userId, projectId, artifactId, projectTemplateId, etc. | Properties |
| Formatting | formatDate, formatDateTime, formatCustomFieldName, convertHtmlToPlainText, sanitizeHtml | Synchronous |
| Permissions | canViewArtifactType, canCreateArtifactType, canModifyArtifactType | Synchronous |

## Promise Wrappers (Default for New Code)

When using callback-based spiraAppManager functions, default to wrapping them in promises for async/await usage. Callbacks are valid and not rejected — but before writing callback-style code, ask the user: "This function uses callbacks. Should I wrap it in a promise for async/await, or keep it as a callback pattern?"

If the user prefers promises (the default), place wrappers in `common.js`:

```javascript
// Internal API call wrapper
function executeApiAsync(method, url, body) {
    return new Promise((resolve, reject) => {
        spiraAppManager.executeApi(APP_NAME, "7.0", method, url, body, resolve, reject);
    });
}

// External API call wrapper
function executeRestAsync(method, url, body, credentials, headers) {
    return new Promise((resolve, reject) => {
        spiraAppManager.executeRest(APP_GUID, APP_NAME, method, url, body, credentials, headers, resolve, reject);
    });
}

// Storage wrappers (system level — repeat pattern for User/Product/ProductUser)
function storageGetSystemAsync(key) {
    return new Promise((resolve, reject) => {
        spiraAppManager.storageGetSystem(APP_GUID, APP_NAME, key, resolve, reject);
    });
}

function storageInsertSystemAsync(key, value, isSecure) {
    return new Promise((resolve, reject) => {
        spiraAppManager.storageInsertSystem(APP_GUID, APP_NAME, key, value, isSecure || false, resolve, reject);
    });
}

function storageUpdateSystemAsync(key, value) {
    return new Promise((resolve, reject) => {
        spiraAppManager.storageUpdateSystem(APP_GUID, APP_NAME, key, value, resolve, reject);
    });
}

function storageDeleteSystemAsync(key) {
    return new Promise((resolve, reject) => {
        spiraAppManager.storageDeleteSystem(APP_GUID, APP_NAME, key, resolve, reject);
    });
}
```

Note: `spiraAppManager.executeApiAsync` also exists natively. Use whichever is clearer.

## executeApi — The Core Function

```javascript
spiraAppManager.executeApi(pluginName, apiVersion, method, url, body, successFn, errorFn);
```

| Parameter | Type | Value |
|-----------|------|-------|
| pluginName | string | APP_NAME |
| apiVersion | string | `"7.0"` |
| method | string | `"GET"`, `"POST"`, `"PUT"`, `"DELETE"` |
| url | string | Relative path (e.g. `projects/${projectId}/requirements/${id}`) |
| body | string/object/null | See body rules below |
| successFn | function | Receives response data |
| errorFn | function | Receives error info |

## The Critical Body Rule

| Method | Body | Example |
|--------|------|---------|
| GET | `null` | `executeApiAsync("GET", url, null)` |
| DELETE | `null` | `executeApiAsync("DELETE", url, null)` |
| POST | `JSON.stringify(obj)` | `executeApiAsync("POST", url, JSON.stringify(newItem))` |
| PUT | `obj` (raw) | `executeApiAsync("PUT", url, existingItem)` |

POST must be stringified. PUT must NOT be stringified. Getting this wrong causes silent failures.

## URL Verification

Before writing any executeApi URL:
1. Check `.kiro/data/spira-api-index.json`
2. If not found, check `.kiro/data/spira-api-spec.json`
3. If still not found — **ask the user**

## Common URL Patterns

```
GET/POST/PUT/DELETE artifacts:
  projects/${projectId}/requirements/${requirementId}
  projects/${projectId}/incidents/${incidentId}
  projects/${projectId}/tasks/${taskId}
  projects/${projectId}/risks/${riskId}
  projects/${projectId}/test-cases/${testCaseId}
  projects/${projectId}/releases/${releaseId}

Sub-resources:
  projects/${projectId}/requirements/${id}/steps
  projects/${projectId}/risks/${id}/mitigations
  projects/${projectId}/incidents/${id}/comments
  projects/${projectId}/test-cases/${id}/test-steps

Template lookups:
  project-templates/${templateId}/risks/probabilities
  project-templates/${templateId}/requirements/types
```

## PUT Requires ConcurrencyDate

Always GET first, modify, then PUT the full object:

```javascript
const item = await executeApiAsync("GET", `projects/${projectId}/tasks/${taskId}`, null);
item.Name = "Updated";
await executeApiAsync("PUT", `projects/${projectId}/tasks`, item);
// ConcurrencyDate is already in the object from the GET
```

## Field Names Are PascalCase

```javascript
// Correct: PascalCase
{ Name: "My task", TaskStatusId: 1, OwnerId: 5 }

// Wrong: camelCase — fields silently ignored
{ name: "My task", taskStatusId: 1, ownerId: 5 }
```

## Page Data Functions (Synchronous)

These work on details pages to read/write the current artifact's form:

```javascript
// Read a field value
var name = spiraAppManager.getDataItemField("Name", "textValue");
var statusId = spiraAppManager.getDataItemField("IncidentStatusId", "intValue");
var description = spiraAppManager.getDataItemField("Description", "textValue");

// Get live (unsaved) value
var liveValue = spiraAppManager.getLiveFormFieldValue("PriorityId");
// Returns: { intValue: 2 }

// Update a field (doesn't save — user must save or call saveForm)
spiraAppManager.updateFormField("Name", "textValue", "New name");
spiraAppManager.updateFormField("OwnerId", null, 5);

// Save the form programmatically
spiraAppManager.saveForm();
```

Data properties: `textValue`, `intValue`, `dateValue`, `caption`, `lookups`, `tooltip`, `fieldType`, `editable`, `required`, `hidden`

## Dropdown Functions (Synchronous)

```javascript
// Get all items in a dropdown
var items = spiraAppManager.getDropdownItems("PriorityId");
// Returns: [{ id: 1, isActive: true, text: "1 - Critical" }, ...]

// Hide/show items
items[2].isActive = false; // hide the 3rd option
spiraAppManager.setDropdownItemsIsActive("PriorityId", items);
```

## Grid Functions (Synchronous)

```javascript
// Get selected rows on a list page
var selectedIds = spiraAppManager.getGridSelectedItems();
// Returns: [5, 12, 23] (artifact IDs)

// Get selected items in a sub-grid (details page)
var selectedSteps = spiraAppManager.getGridSelectedItems(spiraAppManager.gridIds.requirementSteps);

// Reload a grid after modifications
spiraAppManager.reloadGrid(spiraAppManager.gridIds.artifactGrid);
spiraAppManager.reloadGrid(spiraAppManager.gridIds.requirementSteps);
```

Available gridIds: `requirementSteps`, `riskMitigations`, `testCaseTestSteps`, `testSetTestCases`, `artifactGrid`

## Storage Functions (Callback-based — wrap in promises)

Four scopes: System, User, Product, ProductUser. Each has Insert, Get, Update, Delete, and GetAll.

```javascript
// Using the async wrapper:
await storageInsertSystemAsync("myKey", "myValue", false);
var value = await storageGetSystemAsync("myKey");
await storageUpdateSystemAsync("myKey", "newValue");
await storageDeleteSystemAsync("myKey");
```

Key rules:
- Keys max 128 characters
- Values can be any length (stored as strings)
- Secure storage (isSecure: true) is encrypted but cannot be read client-side

## Local Storage (Synchronous)

```javascript
// Always use APP_GUID as key prefix
spiraAppManager.setLocalData(APP_GUID, JSON.stringify(myData));
var data = JSON.parse(spiraAppManager.getLocalData(APP_GUID));
spiraAppManager.removeLocalData(APP_GUID);
```

Never use `localStorage` directly — always use these spiraAppManager methods.

## Formatting Helpers (Synchronous)

```javascript
spiraAppManager.formatDate("2024-01-15T14:30:00Z");        // "1/15/2024" (localized)
spiraAppManager.formatDateTime("2024-01-15T14:30:00Z");    // "1/15/2024 9:30:00 AM"
spiraAppManager.formatCustomFieldName(5);                   // "Custom_05"
spiraAppManager.convertHtmlToPlainText("<p>Hello</p>");    // "Hello"
spiraAppManager.sanitizeHtml(userInput);                    // XSS-safe string
```

Always use `sanitizeHtml` before rendering user-provided HTML content.

## Context Properties (Synchronous)

```javascript
spiraAppManager.projectId           // current product ID
spiraAppManager.artifactId          // current artifact ID (details pages only)
spiraAppManager.userId              // current user ID
spiraAppManager.projectTemplateId   // template ID for lookups
spiraAppManager.baseUrl             // for building URLs
spiraAppManager.baseThemeUrl        // for loading SVG icons
spiraAppManager.currentCulture      // e.g. "en-US"
spiraAppManager.currentTheme        // "light" or "dark"
spiraAppManager.displayReleaseId    // selected release on dashboards
spiraAppManager.productType         // "SpiraTest", "SpiraTeam", or "SpiraPlan"
spiraAppManager.artifactTypeId      // type ID of current page's artifact
```

## After Modifying Data

```javascript
spiraAppManager.reloadForm();    // refresh details page
spiraAppManager.reloadGrid(spiraAppManager.gridIds.artifactGrid);  // refresh list
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Stringifying PUT body | Pass raw object |
| Not stringifying POST body | Use JSON.stringify |
| Missing ConcurrencyDate on PUT | GET first, then PUT full object |
| camelCase field names | Use PascalCase |
| Inventing a URL | Verify in API index |
| No error callback | Always provide both |
| Forgetting reloadForm after PUT | Call it on success |
| Using localStorage directly | Use spiraAppManager.getLocalData/setLocalData |
| Not sanitizing HTML before display | Use spiraAppManager.sanitizeHtml |
