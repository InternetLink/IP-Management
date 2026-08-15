'use strict';

const { parseTestDatabaseUrl } = require('./database-harness.cjs');

try {
  parseTestDatabaseUrl();
  console.log('TEST_DATABASE_URL safety check passed');
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error && error.exitCode === 2 ? 2 : 1;
}
