/**
 * Registers ts-node/esm loader for Cucumber.js ESM support.
 * This file is imported before step definitions via the cucumber config.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('ts-node/esm', pathToFileURL('./'));
