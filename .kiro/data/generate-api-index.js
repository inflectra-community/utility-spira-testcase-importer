#!/usr/bin/env node

const fs = require('fs');

/**
 * Resolves a $ref string to the actual schema object.
 * Tracks visited refs to detect circular references.
 * @param {string} ref - The $ref string (e.g., "#/components/schemas/RemoteRequirement")
 * @param {object} spec - The full OpenAPI spec object
 * @param {Set} visited - Set of already-visited $ref strings (for circular detection)
 * @returns {object|null} The resolved schema, or null if circular/unresolvable
 */
function resolveRef(ref, spec, visited = new Set()) {
  if (!ref || typeof ref !== 'string') return null;

  if (visited.has(ref)) {
    console.warn(`Warning: Circular $ref detected, skipping: ${ref}`);
    return null;
  }

  visited.add(ref);

  // Parse the $ref path (e.g., "#/components/schemas/RemoteRequirement")
  const parts = ref.replace(/^#\//, '').split('/');
  let resolved = spec;
  for (const part of parts) {
    if (resolved && typeof resolved === 'object' && part in resolved) {
      resolved = resolved[part];
    } else {
      console.warn(`Warning: Unable to resolve $ref: ${ref}`);
      return null;
    }
  }

  // If the resolved schema itself has a $ref, resolve it recursively
  if (resolved && resolved.$ref) {
    return resolveRef(resolved.$ref, spec, visited);
  }

  return resolved;
}

/**
 * Determines if a field is required based on its description text.
 * Looks for patterns like "required", "required for POST", "must be provided" (case-insensitive).
 * @param {string} description - The field description text
 * @returns {boolean}
 */
function isFieldRequired(description) {
  if (!description || typeof description !== 'string') return false;
  const lower = description.toLowerCase();
  // Match patterns: "- required", "required for post", "required", "must be provided"
  return /\brequired\b/.test(lower) || /\bmust be provided\b/.test(lower);
}

/**
 * Extracts requestBody field information from a schema.
 * @param {object} schema - The resolved schema object
 * @param {string} method - The HTTP method (GET, POST, PUT, etc.)
 * @param {object} spec - The full OpenAPI spec (for resolving nested $refs)
 * @returns {object|null} The requestBody object with fields array, or null
 */
function extractRequestBodyFields(schema, method, spec) {
  if (!schema || !schema.properties) return null;

  const fields = [];
  // Check schema-level 'required' array for explicitly required fields
  const schemaRequired = Array.isArray(schema.required) ? schema.required : [];

  for (const [fieldName, fieldDef] of Object.entries(schema.properties)) {
    // Resolve nested $ref in field definition if present
    let resolvedFieldDef = fieldDef;
    if (fieldDef && fieldDef.$ref) {
      resolvedFieldDef = resolveRef(fieldDef.$ref, spec, new Set());
      if (!resolvedFieldDef) continue; // Skip unresolvable/circular refs
    }

    const fieldType = resolvedFieldDef.type || 'object';
    const description = resolvedFieldDef.description || '';
    // Field is required if listed in schema's required array OR description indicates required
    const required = schemaRequired.includes(fieldName) || isFieldRequired(description);

    const field = {
      name: fieldName,
      type: fieldType,
      required: required
    };

    // Mark ConcurrencyDate as requiredForPut for PUT endpoints
    if (fieldName === 'ConcurrencyDate' && method === 'PUT') {
      field.requiredForPut = true;
    }

    // Mark required string fields with nonEmpty
    if (required && fieldType === 'string') {
      field.nonEmpty = true;
    }

    fields.push(field);
  }

  return fields.length > 0 ? { fields } : null;
}

/**
 * Gets the requestBody schema for an operation, resolving $ref if needed.
 * @param {object} operation - The OpenAPI operation object
 * @param {object} spec - The full OpenAPI spec
 * @returns {object|null} The resolved schema, or null if no requestBody
 */
function getRequestBodySchema(operation, spec) {
  if (!operation.requestBody) return null;

  const content = operation.requestBody.content;
  if (!content) return null;

  const jsonContent = content['application/json'];
  if (!jsonContent || !jsonContent.schema) return null;

  const schema = jsonContent.schema;

  // If schema is a $ref, resolve it
  if (schema.$ref) {
    return resolveRef(schema.$ref, spec, new Set());
  }

  // If schema is inline (has properties directly), return it
  if (schema.properties) {
    return schema;
  }

  // If schema is just {"type": "object"} with no properties, skip it
  return null;
}

function generateApiIndex(specPath, outputPath) {
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

  // Group tags by domain
  const tagGroups = {
    'Core Artifacts': ['Incident', 'Requirement', 'Test Case', 'Task', 'Risk'],
    'Testing': ['Test Run', 'Test Set', 'Automated Test Run', 'Manual Test Run'],
    'Project Management': ['Project', 'Release', 'Component', 'User'],
    'Automation': ['Automation Engine', 'Automation Host', 'Release Build'],
    'Configuration': ['Custom List', 'Custom Property', 'Project Template'],
    'Reporting': ['Reports: Generated', 'Reports: Saved', 'Graphs'],
    'Data Management': ['Data Sync', 'Data Mapping', 'Document'],
    'Program Management': ['Programs', 'Capabilities', 'Program Milestone']
  };

  // Extract endpoint summary
  const endpoints = [];
  for (const [pathStr, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation.tags && operation.summary) {
        const upperMethod = method.toUpperCase();

        const endpoint = {
          path: pathStr,
          method: upperMethod,
          tags: operation.tags,
          summary: operation.summary,
          operationId: operation.operationId
        };

        // Extract requestBody schema if present
        const bodySchema = getRequestBodySchema(operation, spec);
        if (bodySchema) {
          const requestBody = extractRequestBodyFields(bodySchema, upperMethod, spec);
          if (requestBody) {
            endpoint.requestBody = requestBody;
          }
        }

        endpoints.push(endpoint);
      }
    }
  }

  // Group endpoints by tag groups
  const groupedEndpoints = {};
  for (const [groupName, tagNames] of Object.entries(tagGroups)) {
    groupedEndpoints[groupName] = endpoints.filter(ep =>
      ep.tags.some(tag => tagNames.some(tagName => tag.includes(tagName)))
    );
  }

  // Create LLM-friendly index
  const apiIndex = {
    title: spec.info.title,
    version: spec.info.version,
    baseUrl: spec.servers[0]?.url,
    lastUpdated: new Date().toISOString(),
    tagGroups: Object.entries(groupedEndpoints).map(([group, eps]) => ({
      name: group,
      endpoints: eps.map(ep => {
        const entry = {
          method: ep.method,
          path: ep.path,
          summary: ep.summary,
          tags: ep.tags
        };
        // Only include requestBody when present
        if (ep.requestBody) {
          entry.requestBody = ep.requestBody;
        }
        return entry;
      })
    })),
    allTags: spec.tags.map(tag => ({
      name: tag.name,
      description: tag.description
    }))
  };

  fs.writeFileSync(outputPath, JSON.stringify(apiIndex, null, 2));
  console.log(`Generated API index: ${outputPath}`);
}

// Run if called directly
if (require.main === module) {
  const specPath = process.argv[2] || './spira-api-spec.json';
  const outputPath = process.argv[3] || './spira-api-index.json';
  generateApiIndex(specPath, outputPath);
}

module.exports = { generateApiIndex, resolveRef, extractRequestBodyFields, getRequestBodySchema, isFieldRequired };
