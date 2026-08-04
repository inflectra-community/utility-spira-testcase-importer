# Spira REST API Reference for SpiraApps

**IMPORTANT: For SpiraApp development, use the official documentation at `.kiro/steering/spiraapp-developer-docs/`**

This document provides guidance on using the Spira REST API within SpiraApps, with reference to the complete API specification.

## Official SpiraApp API Documentation

For complete SpiraApp API guidance, see:
- **SpiraApps-Manager.md** - Complete spiraAppManager API reference (in spiraapp-developer-docs/)
- **SpiraApps-Reference.md** - Complete technical reference (in spiraapp-developer-docs/)

## API Documentation Location

The complete Spira REST API is documented in OpenAPI format at:
`#[[file:spira-api-spec.json]]`

Current documentation: https://api.inflectra.com/Spira/Services/v7_0/RestService.aspx

## API Access Patterns in SpiraApps

### Base URL Structure
All API calls within SpiraApps use relative URLs through SpiraAppManager:
```javascript
// SpiraAppManager automatically handles base URL and authentication
const url = `projects/${projectId}/requirements/${requirementId}`;
spiraAppManager.getFromApi(url, successCallback, errorCallback);
```

### Common API Discovery Patterns

When developing a SpiraApp, follow this process to identify needed API calls:

#### 1. Identify Required Data
- What artifact types does the app work with?
- What operations are needed (read, create, update, delete)?
- What relationships need to be accessed (steps, associations, etc.)?

#### 2. Find Relevant Endpoints
Reference the OpenAPI spec to find endpoints for:
- **Artifact CRUD**: `/projects/{projectId}/{artifactType}`
- **Artifact Details**: `/projects/{projectId}/{artifactType}/{artifactId}`
- **Related Data**: `/projects/{projectId}/{artifactType}/{artifactId}/{relatedType}`
- **Lists and Search**: `/projects/{projectId}/{artifactType}` with query parameters

#### 3. Understand Data Models
Check the OpenAPI spec for:
- Required vs optional fields
- Field data types and constraints
- Enum values for status, priority, type fields
- Custom field patterns

## API Usage Guidelines

### Authentication
SpiraAppManager handles authentication automatically:
```javascript
// No need to manage tokens or headers manually
spiraAppManager.getFromApi(url, successCallback, errorCallback);
```

### Error Handling
Always implement proper error handling:
```javascript
function handleApiError(response, operation) {
    // Check OpenAPI spec for specific error codes and messages
    if (response.message && response.exceptionType) {
        spiraAppManager.displayErrorMessage(`${operation}: ${response.message}`);
    }
}
```

### Data Validation
Validate data against OpenAPI schemas before API calls:
```javascript
function validateArtifactData(data, artifactType) {
    // Reference OpenAPI spec for required fields and constraints
    // Implement validation based on schema definitions
}
```

## Common Endpoint Patterns

### Artifact Operations
```javascript
// GET artifact details
`projects/${projectId}/requirements/${requirementId}`
`projects/${projectId}/test-cases/${testCaseId}`
`projects/${projectId}/risks/${riskId}`

// GET artifact lists
`projects/${projectId}/requirements`
`projects/${projectId}/test-cases`

// POST create artifact
`projects/${projectId}/requirements`
`projects/${projectId}/test-cases`

// PUT update artifact
`projects/${projectId}/requirements/${requirementId}`
`projects/${projectId}/test-cases/${testCaseId}`
```

### Related Data Operations
```javascript
// GET related items
`projects/${projectId}/requirements/${requirementId}/steps`
`projects/${projectId}/test-cases/${testCaseId}/steps`
`projects/${projectId}/risks/${riskId}/mitigations`

// POST create related items
`projects/${projectId}/requirements/${requirementId}/steps`
`projects/${projectId}/test-cases/${testCaseId}/steps`
```

## Development Workflow with API Reference

### 1. Analyze SpiraApp Requirements
- Determine which Spira artifacts the app will work with
- Identify what data needs to be read, created, or modified
- Plan the user interactions and workflows

### 2. Reference OpenAPI Specification
- Look up the specific endpoints needed
- Review request/response schemas
- Check for any special parameters or constraints

### 3. Implement API Calls
- Use SpiraAppManager methods with proper error handling
- Validate data according to API schemas
- Test with different data scenarios

### 4. Handle Edge Cases
- Reference API documentation for error conditions
- Implement proper user feedback
- Handle permission restrictions

## API Discovery Questions

When working on a SpiraApp, ask these questions and reference the OpenAPI spec:

1. **What artifact types are involved?** 
   - Check available endpoints for each type

2. **What operations are needed?**
   - Verify HTTP methods and required parameters

3. **What data fields are required?**
   - Review schemas for mandatory vs optional fields

4. **Are there any special constraints?**
   - Check for field validation rules, enum values, etc.

5. **What related data is needed?**
   - Look for sub-resource endpoints (steps, associations, etc.)

## Best Practices

### Performance
- Use specific field selections when available
- Implement pagination for large data sets
- Cache frequently accessed reference data

### Security
- Always validate user permissions before API calls
- Sanitize user inputs before sending to API
- Handle sensitive data appropriately

### Reliability
- Implement retry logic for transient failures
- Provide meaningful error messages to users
- Log API errors for debugging

This approach ensures that each SpiraApp can efficiently discover and use the exact API calls it needs, while maintaining consistency and best practices across all apps.