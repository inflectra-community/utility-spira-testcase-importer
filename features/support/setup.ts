/**
 * Cucumber support setup - imports all step definitions and worlds.
 * Workaround for glob patterns not resolving on Windows with Cucumber.js v13.
 */

// Worlds
import './worlds/logic.world.js';

// Step definitions
import '../step-definitions/common.steps.js';
import '../step-definitions/import.steps.js';
import '../step-definitions/transformation.steps.js';
import '../step-definitions/validation.steps.js';
import '../step-definitions/folder-hierarchy.steps.js';
import '../step-definitions/approval-workflow.steps.js';
import '../step-definitions/spreadsheet-parsing.steps.js';
import '../step-definitions/progress-logging.steps.js';
import '../step-definitions/connection.steps.js';
import '../step-definitions/template-metadata.steps.js';
import '../step-definitions/llm-mapping.steps.js';
import '../step-definitions/validation-approval.steps.js';
