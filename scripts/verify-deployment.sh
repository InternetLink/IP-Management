#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly ROOT_DIR
readonly ORIGINAL_PATH="${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
NODE_BIN="$(command -v node || true)"
readonly NODE_BIN

TEMP_ROOT=""
STUB_DIR=""
EVENT_LOG=""
NODE_PID_FILE=""
BACKEND_MARKER=""
STARTUP_LOG=""
STARTUP_COMMAND=""
READY_RESULT="${VERIFY_READY_RESULT:-success}"

fail() {
  printf 'CONFIG_ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf 'Usage: %s {config|all}\n' "${BASH_SOURCE[0]}" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is unavailable: $1"
}

cleanup() {
  local status=$?
  local backend_pid=""

  trap - EXIT INT TERM
  set +e
  if [[ -s "${NODE_PID_FILE:-}" ]]; then
    read -r backend_pid < "$NODE_PID_FILE"
    if [[ "$backend_pid" =~ ^[0-9]+$ ]]; then
      kill "$backend_pid" 2>/dev/null || true
    fi
  fi
  if [[ -n "${TEMP_ROOT:-}" && -d "$TEMP_ROOT" ]]; then
    rm -rf -- "$TEMP_ROOT"
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM

# Keep diagnostics useful while preventing connection strings and tokens from leaking.
redact_stream() {
  REDACT_DATABASE_URL="${DATABASE_URL:-}" \
    REDACT_MYSQL_PASSWORD="${MYSQL_PASSWORD:-}" \
    REDACT_AUTH_SECRET="${AUTH_SECRET:-}" \
    REDACT_HEROUI_AUTH_TOKEN="${HEROUI_AUTH_TOKEN:-}" \
    "$NODE_BIN" -e '
const fs = require("fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const secrets = [
    process.env.REDACT_DATABASE_URL,
    process.env.REDACT_MYSQL_PASSWORD,
    process.env.REDACT_AUTH_SECRET,
    process.env.REDACT_HEROUI_AUTH_TOKEN,
  ].filter(Boolean);
  let output = input;
  for (const secret of secrets) output = output.split(secret).join("***REDACTED***");
  process.stdout.write(output);
});
'
}

capture_redacted() {
  local output_file="$1"
  local raw_file="${output_file}.raw"
  local status
  shift

  set +e
  "$@" > "$raw_file" 2>&1
  status=$?
  redact_stream < "$raw_file" > "$output_file"
  rm -f -- "$raw_file"
  set -e
  return "$status"
}

parse_dockerfile() {
  "$NODE_BIN" - \
    "$ROOT_DIR/Dockerfile" \
    "$ROOT_DIR/Dockerfile.backend" \
    "$ROOT_DIR/Dockerfile.frontend" \
    "$ROOT_DIR/scripts/start-combined.sh" <<'NODE'
const fs = require("fs");

const [rootPath, backendPath, frontendPath, startCombinedPath] = process.argv.slice(2);

function fail(message) {
  console.error(`CONFIG_ERROR: ${message}`);
  process.exit(1);
}

function read(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch (error) {
    fail(`Unable to read ${path}: ${error.message}`);
  }
}

function instructions(text) {
  const result = [];
  let current = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    current += `${current ? " " : ""}${line.replace(/\\$/, "").trim()}`;
    if (!line.endsWith("\\")) {
      result.push(current);
      current = "";
    }
  }
  if (current) result.push(current);
  return result;
}

function envValue(text, name) {
  for (const instruction of instructions(text)) {
    if (!instruction.startsWith("ENV ")) continue;
    const match = instruction.slice(4).match(new RegExp(`(?:^|\\s)${name}=([^\\s]+)`));
    if (match) return match[1];
  }
  return undefined;
}

function assertPortContract(path, text) {
  if (envValue(text, "PORT") !== "8080") fail(`${path} must keep ENV PORT=8080`);
  if (!instructions(text).includes("EXPOSE 8080")) fail(`${path} must keep EXPOSE 8080`);
}

const root = read(rootPath);
const backend = read(backendPath);
const frontend = read(frontendPath);
const startCombined = read(startCombinedPath);
const rootInstructions = instructions(root);

if (envValue(root, "PORT") !== "3003") fail("root Dockerfile must default PORT to 3003");
if (envValue(root, "BACKEND_PORT") !== "3001") fail("root Dockerfile must default BACKEND_PORT to 3001");
if (!rootInstructions.includes("EXPOSE 3003")) fail("root Dockerfile must expose the public port 3003");
const installInstruction = rootInstructions.find(line => line.startsWith("RUN ") && line.includes("apt-get install") && line.includes("curl"));
if (!installInstruction) fail("root Dockerfile must install curl");

const entrypointLine = rootInstructions.find(line => line.startsWith("ENTRYPOINT "));
if (!entrypointLine) fail("root Dockerfile ENTRYPOINT is missing");

let command;
try {
  command = JSON.parse(entrypointLine.slice("ENTRYPOINT ".length));
} catch (error) {
  fail(`root Dockerfile ENTRYPOINT is not valid JSON: ${error.message}`);
}
if (JSON.stringify(command) !== JSON.stringify(["sh", "/app/scripts/start-combined.sh"])) {
  fail("root Dockerfile must enter through scripts/start-combined.sh");
}

if (startCombined.includes("net.connect") || startCombined.includes("require('net')") || startCombined.includes('require("net")') || startCombined.includes("node -e")) {
  fail("combined startup still contains the raw TCP or Node probe");
}
if (!startCombined.includes("/api/health/ready")) fail("combined startup must probe /api/health/ready");
if (!startCombined.includes('PORT="$backend_port" sh scripts/start-prod.sh')) {
  fail("backend startup must receive PORT from BACKEND_PORT");
}
if (!startCombined.includes('PORT="$frontend_port" node server.js')) {
  fail("frontend startup must receive the public PORT");
}
if (startCombined.indexOf("/api/health/ready") > startCombined.indexOf("node server.js")) {
  fail("frontend startup appears before the backend ready probe");
}

assertPortContract(backendPath, backend);
assertPortContract(frontendPath, frontend);
process.stdout.write(Buffer.from(startCombined, "utf8").toString("base64"));
NODE
}

verify_release_config_contract() {
  local legacy_config

  for legacy_config in railway.json zeabur.yaml zbpack.backend.json backend/zbpack.json; do
    [[ ! -e "$ROOT_DIR/$legacy_config" ]] \
      || fail "Legacy source-build config must stay absent: $legacy_config"
  done

  [[ -f "$ROOT_DIR/scripts/render-platform-configs.mjs" ]] \
    || fail "Platform config renderer is missing"
  "$NODE_BIN" --check "$ROOT_DIR/scripts/render-platform-configs.mjs" >/dev/null \
    || fail "Platform config renderer has invalid syntax"

  local migrate="$ROOT_DIR/backend/migrate.sh"
  local start_prod="$ROOT_DIR/backend/scripts/start-prod.sh"
  grep -Eqi -- 'retired' "$migrate" \
    || fail "backend/migrate.sh must remain a retired entrypoint"
  if grep -Eqi -- '(db:push|prisma[[:space:]]+db[[:space:]]+push|--accept-data-loss)' "$migrate"; then
    fail "backend/migrate.sh contains a destructive schema command"
  fi
  grep -Fq -- 'npm run db:deploy' "$start_prod" \
    || fail "scripts/start-prod.sh must deploy versioned migrations"
  if grep -Eqi -- '(db:push|prisma[[:space:]]+db[[:space:]]+push)' "$start_prod"; then
    fail "scripts/start-prod.sh contains a schema-push command"
  fi

  printf 'RELEASE_CONFIG_CONTRACT_OK\n'
}

initialize_probe() {
  TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ipam-deployment-verify.XXXXXX")"
  STUB_DIR="$TEMP_ROOT/bin"
  EVENT_LOG="$TEMP_ROOT/events.log"
  NODE_PID_FILE="$TEMP_ROOT/backend.pid"
  BACKEND_MARKER="$TEMP_ROOT/backend.started"
  STARTUP_LOG="$TEMP_ROOT/startup.log"

  mkdir -p "$STUB_DIR" "$TEMP_ROOT/backend/scripts" "$TEMP_ROOT/backend/dist/src" "$TEMP_ROOT/frontend"
  cp -- "$ROOT_DIR/backend/scripts/start-prod.sh" "$TEMP_ROOT/backend/scripts/start-prod.sh"
  printf '%s\n' '// verifier placeholder' > "$TEMP_ROOT/backend/dist/src/main.js"
  : > "$TEMP_ROOT/frontend/server.js"
  : > "$EVENT_LOG"

  cat > "$STUB_DIR/npm" <<'EOF'
#!/bin/sh
set -eu

event_log="${VERIFY_EVENT_LOG:?}"
case "${1:-}:${2:-}" in
  run:db:deploy)
    printf 'EVENT migration PORT=%s BACKEND_PORT=%s ARGS=%s\n' "${PORT:-}" "${BACKEND_PORT:-}" "$*" >> "$event_log"
    ;;
  run:start)
    printf 'EVENT frontend PORT=%s BACKEND_PORT=%s ARGS=%s\n' "${PORT:-}" "${BACKEND_PORT:-}" "$*" >> "$event_log"
    ;;
  *)
    printf 'EVENT unexpected-npm ARGS=%s\n' "$*" >> "$event_log"
    exit 90
    ;;
esac
EOF

  cat > "$STUB_DIR/node" <<'EOF'
#!/bin/sh
set -eu

event_log="${VERIFY_EVENT_LOG:?}"
case "$*" in
  *server.js*)
    printf 'EVENT frontend PORT=%s BACKEND_PORT=%s ARGS=%s\n' "${PORT:-}" "${BACKEND_PORT:-}" "$*" >> "$event_log"
    ;;
  *)
    printf 'EVENT backend PORT=%s BACKEND_PORT=%s ARGS=%s\n' "${PORT:-}" "${BACKEND_PORT:-}" "$*" >> "$event_log"
    printf '%s\n' "$$" > "${VERIFY_NODE_PID_FILE:?}"
    : > "${VERIFY_BACKEND_MARKER:?}"
    exec >/dev/null 2>&1
    exec /bin/sleep 300
    ;;
esac
EOF

  cat > "$STUB_DIR/curl" <<'EOF'
#!/bin/sh
set -eu

event_log="${VERIFY_EVENT_LOG:?}"
last_arg=""
for arg in "$@"; do last_arg="$arg"; done
for attempt in $(seq 1 100); do
  [ -f "${VERIFY_BACKEND_MARKER:?}" ] && break
  /bin/sleep 0.01
done
printf 'EVENT ready URL=%s PORT=%s BACKEND_PORT=%s RESULT=%s\n' "$last_arg" "${PORT:-}" "${BACKEND_PORT:-}" "${VERIFY_READY_RESULT:-success}" >> "$event_log"
if [ "${VERIFY_READY_RESULT:-success}" = fail ]; then
  exit 22
fi
EOF

  cat > "$STUB_DIR/sleep" <<'EOF'
#!/bin/sh
exit 0
EOF

  chmod +x "$STUB_DIR"/*
}

prepare_probe_command() {
  local command_base64

  command_base64="$(parse_dockerfile)"
  STARTUP_COMMAND="$(printf '%s' "$command_base64" | base64 --decode)"
  STARTUP_COMMAND="${STARTUP_COMMAND//\/app\/backend/$TEMP_ROOT\/backend}"
  STARTUP_COMMAND="${STARTUP_COMMAND//\/app\/frontend/$TEMP_ROOT\/frontend}"
}

run_probe() {
  local status

  if capture_redacted "$STARTUP_LOG" env \
    "PATH=$STUB_DIR:$ORIGINAL_PATH" \
    "PORT=3003" \
    "BACKEND_PORT=3001" \
    "BACKEND_READY_ATTEMPTS=3" \
    "BACKEND_READY_INTERVAL_SECONDS=0" \
    "NODE_ENV=production" \
    "DATABASE_URL=mysql://verify:verify@127.0.0.1:3306/ipam_verify" \
    "AUTH_SECRET=deployment-verifier-secret-000000000000" \
    "VERIFY_READY_RESULT=$READY_RESULT" \
    "VERIFY_EVENT_LOG=$EVENT_LOG" \
    "VERIFY_NODE_PID_FILE=$NODE_PID_FILE" \
    "VERIFY_BACKEND_MARKER=$BACKEND_MARKER" \
    sh -c "$STARTUP_COMMAND"; then
    status=0
  else
    status=$?
  fi

  "$NODE_BIN" - "$EVENT_LOG" "$status" "$READY_RESULT" <<'NODE'
const fs = require("fs");

const [eventPath, statusText, expectedResult] = process.argv.slice(2);
const status = Number(statusText);
const events = fs.readFileSync(eventPath, "utf8").trim().split(/\r?\n/).filter(Boolean);

function fail(message) {
  console.error(`CONFIG_ERROR: ${message}`);
  process.exit(1);
}

function indexes(fragment) {
  return events.map((event, index) => event.includes(fragment) ? index : -1).filter(index => index >= 0);
}

function field(event, name) {
  const match = event.match(new RegExp(`${name}=([^ ]*)`));
  return match ? match[1] : undefined;
}

const migrationIndex = indexes("EVENT migration")[0];
const backendIndexes = indexes("EVENT backend");
const readyIndexes = indexes("EVENT ready");
const frontendIndexes = indexes("EVENT frontend");
const backend = events[backendIndexes[0]];
const ready = events[readyIndexes[0]];
const frontend = events[frontendIndexes[0]];

if (expectedResult === "success") {
  if (status !== 0) fail(`startup command exited ${status}; inspect the redacted startup trace`);
  if (migrationIndex === undefined || backendIndexes.length !== 1 || readyIndexes.length !== 1 || frontendIndexes.length !== 1) {
    fail("startup trace does not contain exactly one migration, backend, ready, and frontend event");
  }
  if (!(migrationIndex < backendIndexes[0] && backendIndexes[0] < readyIndexes[0] && readyIndexes[0] < frontendIndexes[0])) {
    fail("startup ordering is not migration -> backend -> ready -> frontend");
  }
  if (field(backend, "PORT") !== "3001" || field(backend, "BACKEND_PORT") !== "3001") {
    fail("backend child did not receive PORT=3001 and BACKEND_PORT=3001");
  }
  if (field(frontend, "PORT") !== "3003" || field(frontend, "BACKEND_PORT") !== "3001") {
    fail("frontend child did not receive the public PORT=3003");
  }
  if (field(ready, "URL") !== "http://127.0.0.1:3001/api/health/ready") {
    fail("ready probe used an unexpected URL");
  }
  console.log("TRACE_OK");
  console.log("BACKEND_PORT=3001");
  console.log("FRONTEND_PORT=3003");
} else {
  if (status === 0) fail("forced ready failure unexpectedly allowed startup to succeed");
  if (frontendIndexes.length !== 0) fail("frontend started after a failed ready probe");
  if (backendIndexes.length !== 1 || readyIndexes.length < 1 || readyIndexes.length > 3) {
    fail("forced ready failure did not produce a bounded backend probe trace");
  }
  if (backendIndexes[0] >= readyIndexes[0]) fail("ready probe ran before the backend child was started");
  console.log("READY_FAILURE_OK");
  console.log("BACKEND_PORT=3001");
  console.log("FRONTEND_PORT=3003");
}
NODE
}

main() {
  if [[ "$#" -ne 1 ]]; then
    usage
    exit 2
  fi
  if [[ "$1" == "all" ]]; then
    trap - EXIT INT TERM
    exec "$BASH" "$SCRIPT_DIR/verify-deployment-all.sh"
  fi
  if [[ "$1" != "config" ]]; then
    usage
    exit 2
  fi
  if [[ "$READY_RESULT" != "success" && "$READY_RESULT" != "fail" ]]; then
    fail "VERIFY_READY_RESULT must be success or fail"
  fi
  [[ -n "$NODE_BIN" ]] || fail "Required command is unavailable: node"
  require_command base64
  require_command chmod
  require_command cp
  require_command mktemp
  require_command rm
  require_command seq

  local command_base64
  command_base64="$(parse_dockerfile)"
  printf 'DOCKERFILE_OK\n'
  verify_release_config_contract

  initialize_probe
  STARTUP_COMMAND="$(printf '%s' "$command_base64" | base64 --decode)"
  STARTUP_COMMAND="${STARTUP_COMMAND//\/app\/backend/$TEMP_ROOT\/backend}"
  STARTUP_COMMAND="${STARTUP_COMMAND//\/app\/frontend/$TEMP_ROOT\/frontend}"
  run_probe
  printf 'CONFIG_OK\n'
}

main "$@"
