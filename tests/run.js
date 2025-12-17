#!/usr/bin/env node

/**
 * Run Test Suite
 * 
 * Usage: node tests/run.js
 */

import { createTestSuite } from './suite.js';

async function main() {
  const suite = createTestSuite();
  const success = await suite.run();

  process.exit(success ? 0 : 1);
}

main().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
