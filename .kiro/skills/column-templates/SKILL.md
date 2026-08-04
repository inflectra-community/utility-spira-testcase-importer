---
name: column-templates
description: How to add custom columns to SpiraApp list pages using HTML templates. Use this skill whenever creating columns, grid customizations, list page enhancements, or working with pageColumns. Activate when you see mentions of column, grid, list page, pageColumns, template, {project_id}, {artifact_id}, or adding data to artifact list views in a SpiraApp context.
---

# SpiraApp Page Columns

Before writing column templates, read `.kiro/steering/spiraapp-developer-docs/SpiraApps-Manifest.md` (the Page Columns section) for the complete specification.

Columns add a custom data column to artifact list page grids. They use HTML templates — not JavaScript. The template is rendered once per row with token replacement.

## How Columns Work

1. You declare a column in the manifest pointing to an HTML file
2. Spira renders that HTML for every row in the grid
3. Tokens in the HTML are replaced with row-specific values
4. The column appears automatically when the SpiraApp is enabled

No JavaScript is involved in column rendering. The HTML is static per row.

## Manifest Structure

```yaml
pageColumns:
  - pageId: 8              # MUST be a list page
    name: myColumn         # codeFriendly identifier
    caption: Column Header # what users see as the column title
    template: file://myColumn.html
```

## Available Tokens

Only two tokens are available in column HTML:

| Token | Replaced with |
|-------|--------------|
| `{project_id}` | The current product ID |
| `{artifact_id}` | The artifact ID for that specific row |

These are the ONLY dynamic values available. You cannot access field values, custom properties, or any other artifact data in a column template.

## Valid List Pages (columns only work here)

| pageId | Page |
|--------|------|
| 1 | TestCaseList |
| 3 | TestRunList |
| 6 | RiskList |
| 8 | RequirementList |
| 10 | ReleaseList |
| 11 | TestSetList |
| 13 | TaskList |
| 15 | DocumentList |
| 17 | AutomationHostList |
| 19 | IncidentList |

Details pages (2, 4, 5, 7, 9, 12, 14, 16, 18, 20, 21) do NOT support columns. If someone asks for a column on a details page, explain this limitation and suggest an alternative (menu button, widget, or pageContents code).

## Simple Example

```html
<!-- requirement.html -->
<p>{project_id}_{artifact_id}</p>
```

This renders "1_42" for requirement 42 in project 1.

## Link Example

```html
<!-- column.html -->
<a href="/projects/{project_id}/requirements/{artifact_id}.aspx">
    View Details
</a>
```

## Button/Action Example

Since columns can't run JavaScript directly, use URL-based actions:

```html
<!-- column.html -->
<a href="https://external-tool.com/analyze?project={project_id}&item={artifact_id}" 
   target="_blank" 
   title="Analyze this item">
    <i class="fa-solid fa-magnifying-glass"></i>
</a>
```

## Styling Columns

Column HTML inherits Spira's base styles. For custom styling, add a CSS file via pageContents on the same page:

```yaml
pageContents:
  - pageId: 8
    name: myApp_listStyles
    css: file://listStyles.css

pageColumns:
  - pageId: 8
    name: myColumn
    caption: My Column
    template: file://column.html
```

The CSS is scoped to your SpiraApp automatically (nested under your app's GUID class).

## Constraints

- One column per unique list pageId per SpiraApp
- HTML only — no JavaScript execution in templates
- Only `{project_id}` and `{artifact_id}` tokens available
- Cannot display computed data, field values, or custom properties
- The column appears automatically — users can't hide it (unless they disable the SpiraApp)

## What Columns CAN'T Do

If someone asks for a column that shows:
- A field value (e.g. "show the owner name") → **Not possible** with columns. Suggest using the existing grid columns or a widget instead.
- Computed data (e.g. "show test coverage count") → **Not possible**. Suggest a widget.
- Interactive elements (e.g. "a button that runs code") → **Not possible** with JS. A URL link is the closest option.

The only dynamic content is the two tokens. Everything else in the template is static and identical for every row (except the token values).

## Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Using a details page pageId | Column doesn't appear | Use a list page pageId |
| Expecting field data in template | Shows literal `{FieldName}` text | Only `{project_id}` and `{artifact_id}` work |
| Adding `<script>` tags | Script doesn't execute | Columns are HTML-only, no JS |
| Multiple columns on same page | Only first one shows | One column per pageId per app |
