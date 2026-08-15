'use strict';

const { cleanupDatabase } = require('./database-harness.cjs');

module.exports = async function globalTeardown() {
  cleanupDatabase();
};
