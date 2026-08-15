'use strict';

const { setupDatabase } = require('./database-harness.cjs');

module.exports = async function globalSetup() {
  try {
    setupDatabase();
  } catch (error) {
    if (error && error.exitCode === 2) {
      console.error(`ERROR: ${error.message}`);
      process.exit(2);
    }
    throw error;
  }
};
