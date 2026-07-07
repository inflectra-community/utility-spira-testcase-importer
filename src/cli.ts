#!/usr/bin/env node
/**
 * CLI Entry Point — spira-import
 *
 * Parses command-line arguments via Commander.js, loads configuration
 * with environment variable fallbacks, and launches the import pipeline.
 */

import { Command } from 'commander';
import { loadConfig, ConfigValidationError, type CliArgs } from './config/index.js';
import { createLogger } from './logger/index.js';
import { runPipeline } from './pipeline.js';

const program = new Command();

program
  .name('spira-import')
  .description('LLM-assisted test case importer for Spira')
  .version('0.1.0')
  .requiredOption('--source-file <path>', 'Path to the Excel file containing test case data')
  .requiredOption('--provider <provider>', 'LLM provider: openai, anthropic, or bedrock')
  .requiredOption('--model <model>', 'LLM model name (e.g., gpt-4o, claude-sonnet-4-20250514)')
  .option('--spira-url <url>', 'Spira instance base URL (env: SPIRA_URL)')
  .option('--username <username>', 'Spira username (env: SPIRA_USERNAME)')
  .option('--api-key <key>', 'Spira API key (env: SPIRA_API_KEY)')
  .option('--project-id <id>', 'Spira project ID', parseInt)
  .option('--llm-api-key <key>', 'LLM provider API key (env: LLM_API_KEY)')
  .option('--region <region>', 'AWS region for Bedrock provider (env: AWS_REGION)')
  .option('--dry-run', 'Validate and transform without importing to Spira', false)
  .option('--log-file <path>', 'Custom log file output path')
  .action(async (options) => {
    const logger = createLogger();

    try {
      const cliArgs: CliArgs = {
        spiraUrl: options.spiraUrl,
        username: options.username,
        apiKey: options.apiKey,
        projectId: options.projectId,
        provider: options.provider as 'openai' | 'anthropic' | 'bedrock',
        model: options.model,
        llmApiKey: options.llmApiKey,
        region: options.region,
        sourceFile: options.sourceFile,
        dryRun: options.dryRun,
        logFile: options.logFile,
      };

      const config = loadConfig(cliArgs);

      await runPipeline(config, logger);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        process.stderr.write(`\n❌ Configuration Error:\n${error.message}\n\n`);
        process.exit(1);
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Fatal error: ${message}`);
      await logger.persist(options.logFile);
      process.stderr.write(`\n❌ Fatal Error: ${message}\n`);
      process.exit(1);
    }
  });

program.parse();
