'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BACKEND_DIR = path.resolve(__dirname, '../..');
const SCHEMA_PATH = path.join(BACKEND_DIR, 'prisma', 'schema.prisma');
const STATE_PREFIX = 'ipam-jest-integration-';
let cleanupStarted = false;

class HarnessSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HarnessSafetyError';
    this.exitCode = 2;
  }
}

function safetyError(message) {
  return new HarnessSafetyError(message);
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw safetyError('TEST_DATABASE_URL contains invalid URL encoding');
  }
}

function parseTestDatabaseUrl() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw safetyError('TEST_DATABASE_URL is required');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw safetyError('TEST_DATABASE_URL must be a valid mysql:// URL');
  }

  if (url.protocol !== 'mysql:') {
    throw safetyError('TEST_DATABASE_URL must use the mysql:// scheme');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = url.port || '3306';
  const user = decode(url.username);
  const password = decode(url.password);
  const database = decode(url.pathname.replace(/^\//, ''));

  if (!user || !host) throw safetyError('TEST_DATABASE_URL requires a username and host');
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw safetyError('TEST_DATABASE_URL port is invalid');
  }
  if (!/^ipam_[a-z0-9_]+_test$/.test(database)) {
    throw safetyError('TEST_DATABASE_URL database must match ipam_<name>_test');
  }

  const loopback = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!loopback.has(host)) {
    const ciHost = (process.env.CI_MYSQL_HOST || '').replace(/^\[|\]$/g, '');
    const inCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    if (!inCi || !ciHost || host !== ciHost) {
      throw safetyError('Remote TEST_DATABASE_URL hosts require the designated CI MySQL service');
    }
    if (user === 'root') throw safetyError('Remote integration tests require a dedicated database user');
  }

  return { raw, url, host, port, user, password, database };
}

function deriveNamespace() {
  const run = process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT
    ? `${process.env.GITHUB_RUN_ID}_${process.env.GITHUB_RUN_ATTEMPT}`
    : '';
  const entropy = `${process.pid}_${crypto.randomBytes(6).toString('hex')}`;
  const raw = `${run}_${entropy}`.replace(/^_+/, '');
  const namespace = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+$/g, '').slice(0, 32);
  if (!/^[a-z0-9][a-z0-9_]{3,31}$/.test(namespace)) {
    throw new Error('Could not derive a safe integration fixture namespace');
  }
  return namespace;
}

function fixtureDatabaseName(namespace) {
  const database = `ipam_${namespace}_integration_test`;
  if (database.length > 64 || !/^ipam_[a-z0-9_]+_test$/.test(database)) {
    throw new Error('Generated integration database name is unsafe');
  }
  return database;
}

function isOwnedDatabase(database, namespace) {
  return database === fixtureDatabaseName(namespace);
}

function databaseUrlFor(config, database) {
  const url = new URL(config.raw);
  url.pathname = `/${database}`;
  url.hash = '';
  return url.toString();
}

function statePath() {
  const configured = process.env.IPAM_INTEGRATION_STATE_FILE;
  const candidate = configured || path.join(os.tmpdir(), `${STATE_PREFIX}${process.pid}.json`);
  const resolved = path.resolve(candidate);
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith(STATE_PREFIX)) {
    throw new Error('Integration state path is unsafe');
  }
  return resolved;
}

function writeState(state) {
  const file = statePath();
  fs.writeFileSync(file, JSON.stringify(state), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  process.env.IPAM_INTEGRATION_STATE_FILE = file;
}

function readState() {
  const file = statePath();
  if (!fs.existsSync(file)) return null;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('Integration state file is unreadable');
  }
  if (!state || typeof state.database !== 'string' || typeof state.namespace !== 'string') {
    throw new Error('Integration state file is invalid');
  }
  if (!isOwnedDatabase(state.database, state.namespace)) {
    throw new Error('Integration state does not name an owned test database');
  }
  return state;
}

function removeState() {
  fs.rmSync(statePath(), { force: true });
}

function redact(output, config) {
  let safe = String(output || '');
  const secrets = [config.raw, config.password, encodeURIComponent(config.password)].filter(Boolean);
  for (const secret of secrets.sort((left, right) => right.length - left.length)) {
    safe = safe.split(secret).join('[REDACTED]');
  }
  return safe;
}

function runCommand(command, args, config, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  const output = redact(`${result.stdout || ''}${result.stderr || ''}`, config);
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = output.trim() || `exit ${result.status ?? 'unknown'}`;
    throw new Error(`${command} failed: ${detail}`);
  }
  return output;
}

function mysql(config, sql) {
  return runCommand('mysql', [
    '--protocol=TCP',
    '--host', config.host,
    '--port', config.port,
    '--user', config.user,
    '--batch',
    '--skip-column-names',
    '--execute',
    sql,
  ], config, { MYSQL_PWD: config.password });
}

function prismaDeploy(config, databaseUrl) {
  const prismaBin = path.join(BACKEND_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
  return runCommand(prismaBin, ['migrate', 'deploy', '--schema', SCHEMA_PATH], config, { DATABASE_URL: databaseUrl });
}

function dropFixture(fixture, config) {
  if (!isOwnedDatabase(fixture.database, fixture.namespace)) {
    throw new Error('Refusing to drop an unowned integration database');
  }
  mysql(config, `DROP DATABASE IF EXISTS \`${fixture.database}\``);
  console.log(`INTEGRATION_DATABASE_DROPPED ${fixture.database}`);
}

function installCleanupHandlers(fixture, config) {
  const exitWithCleanup = (status) => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    try {
      dropFixture(fixture, config);
      removeState();
    } catch {
      console.error(`INTEGRATION_CLEANUP_FAILED ${fixture.database}`);
    }
    process.exit(status);
  };
  process.once('SIGINT', () => exitWithCleanup(130));
  process.once('SIGTERM', () => exitWithCleanup(143));
}

function setupDatabase() {
  const config = parseTestDatabaseUrl();
  const namespace = deriveNamespace();
  const fixture = {
    database: fixtureDatabaseName(namespace),
    namespace,
  };
  const databaseUrl = databaseUrlFor(config, fixture.database);
  const file = statePath();
  if (fs.existsSync(file)) throw new Error('An integration fixture state already exists for this process');
  let created = false;

  try {
    mysql(config, `CREATE DATABASE \`${fixture.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    writeState(fixture);
    installCleanupHandlers(fixture, config);
    console.log(`INTEGRATION_DATABASE_CREATED ${fixture.database}`);
    prismaDeploy(config, databaseUrl);
    console.log(`INTEGRATION_MIGRATIONS_APPLIED ${fixture.database}`);
  } catch (error) {
    if (created) {
      try {
        dropFixture(fixture, config);
        removeState();
      } catch {
        console.error(`INTEGRATION_CLEANUP_FAILED ${fixture.database}`);
      }
    }
    throw error;
  }
}

function loadDatabaseEnvironment() {
  const config = parseTestDatabaseUrl();
  const state = readState();
  if (!state) throw new Error('Integration fixture state is missing');
  process.env.DATABASE_URL = databaseUrlFor(config, state.database);
}

function cleanupDatabase() {
  const state = readState();
  if (!state) return;
  const config = parseTestDatabaseUrl();
  dropFixture(state, config);
  removeState();
}

module.exports = {
  HarnessSafetyError,
  cleanupDatabase,
  loadDatabaseEnvironment,
  parseTestDatabaseUrl,
  setupDatabase,
};
