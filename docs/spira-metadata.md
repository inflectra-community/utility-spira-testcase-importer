# Spira Metadata Retrieval

The tool fetches template and project metadata from the Spira REST API to understand what fields, values, and structures are available for mapping.

## What's Retrieved

| Category | Endpoint | Used For |
|----------|----------|----------|
| Priorities | `GET /project-templates/{id}/test-cases/priorities` | Value resolution (Priority column -> ID) |
| Statuses | `GET /project-templates/{id}/test-cases/statuses` | Value resolution (Status column -> ID) |
| Types | `GET /project-templates/{id}/test-cases/types` | Value resolution (Type column -> ID) |
| Custom Properties | `GET /project-templates/{id}/custom-properties/TestCase` | Column matching + value resolution |
| Custom List Values | `GET /project-templates/{id}/custom-lists/{listId}` | Resolving list property values to IDs |
| Users | `GET /projects/{id}/users` | Owner resolution |
| Components | `GET /projects/{id}/components?active_only=true&include_deleted=false` | Component resolution |
| Test Folders | `GET /projects/{id}/test-folders` | Folder reuse (don't recreate existing folders) |

## Authentication

Uses HTTP Basic Auth: `Authorization: Basic base64(username:apiKey)`.

The connection is validated by calling `GET /projects/{projectId}` — if it returns the project details, credentials are valid.

## PascalCase Normalisation

The Spira REST API returns PascalCase JSON (e.g., `Name`, `PriorityId`, `CustomPropertyTypeId`). Our internal types use camelCase. The normalisation happens in `src/spira/metadata.ts` — a single boundary layer that maps API responses to our domain types:

```typescript
// API returns:     { "PriorityId": 3, "Name": "3 - Medium", "Active": true }
// Internal type:   { priorityId: 3, name: "3 - Medium", active: true }
```

This means:
- Request bodies stay PascalCase (what Spira expects)
- Internal logic uses camelCase (TypeScript convention)
- The mapping happens once, in one place

## Custom Properties

Custom properties are defined at the template level. Each has:
- `propertyNumber` (1-30): the slot position
- `name`: the display name (what users see)
- `customPropertyTypeId`: 1=Text, 2=Integer, 3=Decimal, 4=Boolean, 5=Date, 6=List, 7=MultiList, 8=User
- `customListId`: for List/MultiList types, references a custom list with predefined values

The column matcher uses the custom property `name` to match spreadsheet columns. The value resolver uses the list values to map source text to IDs.

## Custom List Values

For each custom property of type List (6) or MultiList (7), the tool fetches the associated list's values. These are used by:
- The value resolver (heuristic matching of source values to list entry names)
- The LLM prompt (so it knows what valid values exist)
- The validator (checking that mapped values are valid entries)

## Partial Failure Handling

Each metadata category is fetched independently. If one fails (e.g., a 406 on components), the failure is logged and the pipeline continues with whatever metadata was successfully retrieved. The heuristics and LLM work with available data rather than failing entirely.

## Template ID Resolution

The template ID is obtained during authentication — the `GET /projects/{id}` response includes `ProjectTemplateId`. All template-scoped calls use this ID automatically.
