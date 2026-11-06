/**
 * Provisioner — direct apply
 *
 * Applies template gaps straight to Spira via the REST API instead of exporting
 * a SpiraProvisioner structure file. This covers the case the external tool
 * can't: adding missing values to a custom list that already exists.
 *
 * Two kinds of gap are handled:
 *   - Missing list values on an existing custom property → POST new values to
 *     that property's backing custom list.
 *   - A brand-new custom property the data references but the template lacks →
 *     create a custom list (for list/multilist types) then the property.
 *
 * Priority/status/component gaps are NOT handled here (components are a built-in
 * artifact field the admin manages; priority/status are workflow config).
 */

import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';
import type { TemplateMetadata } from '../types/spira.js';
import type { ZephyrGapAnalysis } from '../pipeline-zephyr.js';
import { resolveNewFieldType, type FieldMode } from './index.js';

export interface ProvisionApplyInput {
  gaps: ZephyrGapAnalysis;
  metadata: TemplateMetadata;
  /**
   * Names of fields the user wants as multi-select. When provided, overrides
   * the per-field `multiValued` default from the gap analysis.
   */
  multiSelect?: string[];
  /**
   * Per-field type choice for fields that will be CREATED (name → mode).
   * Absent or `auto` lets inference decide. Has no effect on fields that
   * already exist: their type is fixed at creation and always wins.
   */
  fieldTypes?: Record<string, FieldMode>;
  /** Max distinct values before a NEW field is treated as text rather than a list. */
  listValueThreshold?: number;
}

export interface ProvisionApplyResult {
  /** Existing properties that had values added: name → values added. */
  valuesAdded: Array<{ property: string; values: string[] }>;
  /** New custom properties created: name → type. */
  propertiesCreated: Array<{ name: string; type: string; values?: string[] }>;
  /** Components created in the project's Components field. */
  componentsCreated: string[];
  /**
   * Existing single-select list fields the user wants as multi-select. Spira
   * can't convert a field's type via the API (the type is fixed at creation),
   * so these require a one-time manual toggle in the admin UI. Reported, not
   * applied. Values are still added to the field regardless of its type.
   */
  manualConversions: string[];
  /** Non-fatal problems (e.g. a value Spira rejected). */
  warnings: string[];
  /** Totals for a quick summary. */
  totals: { valuesAdded: number; propertiesCreated: number; componentsCreated: number };
}

const PROP_TYPE = { text: 1, integer: 2, boolean: 4, date: 5, list: 6, multilist: 7 } as const;

/**
 * Applies the gap analysis to the connected Spira product.
 * Idempotency: callers should re-fetch metadata and re-run gap analysis after
 * applying; re-adding an existing value may error, so such errors are captured
 * as warnings rather than failing the whole run.
 */
export async function applyProvisioning(
  client: SpiraApiClient,
  input: ProvisionApplyInput,
  logger: Logger,
): Promise<ProvisionApplyResult> {
  const { gaps, metadata, multiSelect, fieldTypes, listValueThreshold = 20 } = input;
  const result: ProvisionApplyResult = {
    valuesAdded: [],
    propertiesCreated: [],
    componentsCreated: [],
    manualConversions: [],
    warnings: [],
    totals: { valuesAdded: 0, propertiesCreated: 0, componentsCreated: 0 },
  };

  const wantsMulti = (name: string, dataDefault: boolean) =>
    Array.isArray(multiSelect) ? multiSelect.includes(name) : dataDefault;

  // Spira custom property type ids: 6 = single-select List, 7 = MultiList.
  const TYPE_LIST = 6;

  // 1. Existing list properties missing some values → add them to the backing list.
  for (const mv of gaps.missingListValues) {
    const def = metadata.customProperties.find(p => p.name === mv.propertyName);

    // If the user wants this field multi-select but it already exists as a
    // single-select list, flag it: Spira can't change a field's type via the
    // API (fixed at creation). The admin must toggle it in the UI once. We
    // still add the values below so the list is ready either way.
    if (def && def.customPropertyTypeId === TYPE_LIST && wantsMulti(mv.propertyName, mv.multiValued)) {
      result.manualConversions.push(mv.propertyName);
    }

    if (mv.missingValues.length === 0) continue;
    if (!def?.customListId) {
      result.warnings.push(`Skipped "${mv.propertyName}": no backing custom list found to add values to.`);
      continue;
    }
    try {
      await client.addCustomListValues(def.customListId, mv.missingValues);
      result.valuesAdded.push({ property: mv.propertyName, values: mv.missingValues });
      result.totals.valuesAdded += mv.missingValues.length;
      logger.info(`Added ${mv.missingValues.length} value(s) to "${mv.propertyName}".`);
    } catch (err) {
      result.warnings.push(
        `Could not add values to "${mv.propertyName}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. New properties the template lacks → create list (if needed) + property.
  for (const np of gaps.newProperties) {
    // An explicit per-field choice wins; otherwise the legacy multiSelect list /
    // data default decides list-vs-multilist for fields inferred to be lists.
    const mode: FieldMode = fieldTypes?.[np.name] ?? 'auto';
    const resolved = resolveNewFieldType(
      {
        columnName: np.name,
        uniqueValues: np.uniqueValues,
        rowCount: np.rowCount,
        multiValued: wantsMulti(np.name, np.multiValued),
        forceType: mode,
      },
      listValueThreshold,
    );
    const typeName = resolved.type;
    const typeId = PROP_TYPE[typeName as keyof typeof PROP_TYPE] ?? PROP_TYPE.text;

    try {
      let customListId: number | undefined;
      if (typeName === 'list' || typeName === 'multilist') {
        const values = resolved.values ?? np.uniqueValues;
        const createdList = await client.createCustomList(np.name, values);
        customListId = createdList.customListId;
        await client.createCustomProperty({ name: np.name, customPropertyTypeId: typeId, customListId });
        result.propertiesCreated.push({ name: np.name, type: typeName, values });
      } else {
        await client.createCustomProperty({ name: np.name, customPropertyTypeId: typeId });
        result.propertiesCreated.push({ name: np.name, type: typeName });
      }
      result.totals.propertiesCreated += 1;
      logger.info(`Created custom property "${np.name}" (${typeName}).`);
    } catch (err) {
      result.warnings.push(
        `Could not create property "${np.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 3. Components the source uses that aren't in the Spira Components field.
  // Components are a built-in artifact field but are still creatable via the API.
  for (const name of gaps.missingComponents) {
    try {
      await client.createComponent(name);
      result.componentsCreated.push(name);
      result.totals.componentsCreated += 1;
      logger.info(`Created component "${name}".`);
    } catch (err) {
      result.warnings.push(
        `Could not create component "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
