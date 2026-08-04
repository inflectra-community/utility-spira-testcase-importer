---
name: external-api
description: How to make external REST API calls from SpiraApps using executeRest and executeAwsBedrockRuntime. Use this skill whenever writing code that connects to third-party services, external APIs, webhooks, or AI services from a SpiraApp. Activate when you see mentions of executeRest, external API, third-party, integration, webhook, credentials, headers, token replacement, or executeAwsBedrockRuntime in a SpiraApp context.
---

# SpiraApp External API Calls

Before writing external API code, read `.kiro/steering/spiraapp-developer-docs/SpiraApps-Manager.md` (the External REST Calls section) for the complete reference.

SpiraApps call external services using `spiraAppManager.executeRest()`. The call is made **server-side** by Spira — this avoids CORS issues and keeps credentials secure. Never use `fetch()` or `XMLHttpRequest` for external calls.

## Why Server-Side?

When your SpiraApp calls an external API:
1. The browser sends the request to Spira's server
2. Spira's server makes the actual HTTP call to the external service
3. Spira's server returns the response to the browser

This means:
- No CORS problems (the browser never contacts the external service directly)
- Credentials stored in secure settings are injected server-side (never exposed to the browser)
- The external service sees Spira's server IP, not the user's browser

## executeRest Signature

```javascript
spiraAppManager.executeRest(appGuid, appName, method, url, body, credentials, headers, successFn, errorFn);
```

| Parameter | Type | Value |
|-----------|------|-------|
| appGuid | string | `APP_GUID` (always use the constant) |
| appName | string | APP_NAME (for logging) |
| method | string | `"POST"`, `"GET"`, `"PUT"`, `"DELETE"`, `"PATCH"`, `"OPTIONS"`, `"MERGE"` |
| url | string | Full URL of external API (can include tokens) |
| body | string/null | Request body as string (can include tokens) |
| credentials | object/null | `{userName: VALUE, password: VALUE}` or null |
| headers | object/null | `{key1: value1, key2: value2}` or null |
| successFn | function | Receives response object |
| errorFn | function | Receives error object |

## Promise Wrapper (Default for New Code)

Before writing callback-style executeRest code, ask the user: "Should I wrap this in a promise for async/await, or keep it as a callback pattern?"

If promises (the default):

```javascript
function executeRestAsync(method, url, body, credentials, headers) {
    return new Promise((resolve, reject) => {
        spiraAppManager.executeRest(
            APP_GUID, APP_NAME, method, url, body, 
            credentials, headers, resolve, reject
        );
    });
}
```

Usage:
```javascript
async function callExternalService() {
    try {
        var response = await executeRestAsync("POST", url, body, credentials, headers);
        if (response.statusCode === 200 || response.statusCode === 201) {
            // success
        } else {
            spiraAppManager.displayErrorMessage(APP_NAME + ": " + response.statusDescription);
        }
    } catch (error) {
        spiraAppManager.displayErrorMessage(APP_NAME + ": " + error.message);
    }
}
```

## Token Replacement

The most powerful feature of executeRest: setting values are injected into the URL and body automatically. Use `{settingName}` syntax:

```javascript
// These tokens get replaced with actual setting values server-side
var url = "{baseUrl}/api/v1/projects/{projectName}/builds";
var body = JSON.stringify({ token: "{apiToken}", data: someData });
```

If a setting named `baseUrl` exists (system or product level), `{baseUrl}` is replaced with its value. This works for both secure and non-secure settings — secure values are injected server-side without ever reaching the browser.

**Important:** If a token name exists in both system settings and product settings, the system setting takes precedence.

## Credentials Object

For APIs that use basic authentication:

```javascript
var credentials = {
    userName: "{username}",      // token replaced with setting value
    password: "{apiToken}"       // token replaced with secure setting value
};

spiraAppManager.executeRest(APP_GUID, APP_NAME, "POST", url, null, credentials, headers, success, failure);
```

Pass `null` if the API doesn't use basic auth (e.g., uses bearer tokens in headers instead).

## Headers Object

```javascript
var headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": "Bearer {apiToken}"  // tokens work in headers too
};
```

Pass `null` if no custom headers are needed.

## Response Object

The success callback receives:

```javascript
function success(response) {
    response.statusCode;        // HTTP status (200, 201, 404, etc.)
    response.statusDescription; // Status text
    response.content;           // Response body as string (parse with JSON.parse if needed)
}
```

Always check `statusCode` — a "successful" callback doesn't mean the API returned 200. It means the HTTP call completed (could be 400, 404, 500).

```javascript
function externalCall_Success(response) {
    if (response.statusCode === 200 || response.statusCode === 201) {
        var data = JSON.parse(response.content);
        // handle success
    } else {
        var errorDetail = response.statusDescription;
        try {
            var errorBody = JSON.parse(response.content);
            if (errorBody.message) errorDetail = errorBody.message;
        } catch (e) { /* not JSON */ }
        spiraAppManager.displayErrorMessage(APP_NAME + ": " + response.statusCode + " - " + errorDetail);
    }
}
```

## System vs Product-Level Auth

Some apps support both system-wide defaults and per-product overrides (see GitLab pattern):

```javascript
// Check product-level override first, fall back to system
var username;
if (SpiraAppSettings[APP_GUID] && SpiraAppSettings[APP_GUID].project_username) {
    username = SpiraAppSettings[APP_GUID].project_username;
    // Use product-level token in URL
    url = "{project_base_url}/api/endpoint?token={project_api_token}";
} else {
    // Use system-level token in URL
    url = "{base_url}/api/endpoint?token={api_token}";
}
```

## Manifest Settings for External APIs

System settings (credentials — secure):
```yaml
settings:
  - settingTypeId: 1
    name: baseUrl
    caption: Base URL
    position: 1
    tooltip: The base URL of the external service
    placeholder: https://api.example.com
  - settingTypeId: 1
    name: apiToken
    caption: API Token
    isSecure: true
    position: 2
    tooltip: Authentication token (stored securely)
```

Product settings (per-product config):
```yaml
productSettings:
  - settingTypeId: 1
    name: projectName
    caption: Project Name
    position: 1
    tooltip: The project identifier in the external service
```

## executeAwsBedrockRuntime (AWS Bedrock Specific)

For AWS Bedrock AI models, use the dedicated helper that handles AWS SignatureV4 auth:

```javascript
spiraAppManager.executeAwsBedrockRuntime(
    APP_GUID,
    APP_NAME,
    accessKeyId,              // AWS access key value (from settings)
    'secretAccessKeySetting', // NAME of the secure setting (not the value)
    'us-east-1',             // AWS region
    'anthropic.claude-3-haiku-20240307-v1:0',  // model ID
    JSON.stringify(body),     // request body
    successFn,
    errorFn
);
```

Note: the `secretAccessKeySetting` parameter is the **name** of the setting, not the value. Spira looks up the secure value server-side.

## Complete Example (GitLab Pattern)

```javascript
const APP_NAME = "myIntegration";
var localState = {};

spiraAppManager.registerEvent_menuEntryClick(APP_GUID, "triggerAction", myIntegration_trigger);

async function myIntegration_trigger() {
    if (localState.running) {
        spiraAppManager.displayWarningMessage(APP_NAME + ": Already in progress");
        return;
    }

    if (!SpiraAppSettings[APP_GUID] || !SpiraAppSettings[APP_GUID].projectName) {
        spiraAppManager.displayErrorMessage(APP_NAME + ": Please configure the project name in product settings");
        return;
    }

    localState.running = true;

    try {
        var url = "{baseUrl}/api/projects/{projectName}/trigger";
        var headers = { "Content-Type": "application/json" };
        var credentials = { userName: "{username}", password: "{apiToken}" };

        var response = await executeRestAsync("POST", url, null, credentials, headers);

        if (response.statusCode === 200 || response.statusCode === 201) {
            spiraAppManager.displaySuccessMessage(APP_NAME + ": Action triggered successfully");
        } else {
            spiraAppManager.displayErrorMessage(APP_NAME + ": " + response.statusCode + " - " + response.statusDescription);
        }
    } catch (error) {
        spiraAppManager.displayErrorMessage(APP_NAME + ": " + error.message);
    } finally {
        localState.running = false;
    }
}

function executeRestAsync(method, url, body, credentials, headers) {
    return new Promise((resolve, reject) => {
        spiraAppManager.executeRest(APP_GUID, APP_NAME, method, url, body, credentials, headers, resolve, reject);
    });
}
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using fetch() instead of executeRest | executeRest avoids CORS and secures credentials |
| Hardcoding credentials in JS | Use secure settings with token replacement |
| Not checking statusCode in success callback | Success callback fires for any completed HTTP call |
| Using APP_NAME as first arg instead of APP_GUID | First arg must be APP_GUID |
| Forgetting to JSON.parse response.content | Content is always a string |
| Token name mismatch with setting name | Token `{x}` must match a setting with `name: x` exactly |
