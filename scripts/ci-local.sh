#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly BACKEND_DIR="$ROOT_DIR/backend"
readonly FRONTEND_DIR="$ROOT_DIR/frontend"
readonly IMAGE_MAP_SCRIPT="$ROOT_DIR/scripts/verify-image-map.sh"
readonly DEPLOYMENT_SCRIPT="$ROOT_DIR/scripts/verify-deployment.sh"
readonly PROTECTION_SCRIPT="$ROOT_DIR/scripts/verify-github-protection.sh"
readonly QA_STATE_ROOT="${TMPDIR:-/tmp}/ipam-ci-local-qa-${UID}"

TEMP_DIR=""
QA_STATE_DIR=""
QA_KEEP_STATE=0
QA_DIAGNOSTICS_EMITTED=0
QA_AUTH_SECRET=""
QA_BOOTSTRAP_TOKEN=""
QA_USERNAME=""
QA_PASSWORD=""
QA_HEROUI_AUTH_TOKEN=""
QA_DATABASE_URL=""
QA_BACKEND_RUNTIME_DIR=""
QA_FRONTEND_RUNTIME_DIR=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$status" -ne 0 && -n "${QA_STATE_DIR:-}" && "$QA_DIAGNOSTICS_EMITTED" -eq 0 ]]; then
    qa_print_diagnostics || true
  fi
  if [[ -n "${QA_STATE_DIR:-}" && "$QA_KEEP_STATE" -ne 1 ]]; then
    qa_cleanup_state_dir "$QA_STATE_DIR" || true
  fi
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

info() {
  printf '%s\n' "$*" >&2
}

fail() {
  printf 'CI_LOCAL_FAILED code=%s\n' "$1" >&2
  exit 1
}

environment_blocked() {
  printf 'ENVIRONMENT_BLOCKED component=ci-local reason=%s\n' "$1" >&2
  exit 2
}

usage() {
  printf 'Usage: %s [--serve-qa | --cleanup-qa <token> | --verify-evidence-only <attempt-directory>]\n' "${BASH_SOURCE[0]}" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || environment_blocked "command-unavailable-$1"
}

redact_file() {
  local source_file="$1"
  local destination_file="$2"

  REDACT_HEROUI_AUTH_TOKEN="${HEROUI_AUTH_TOKEN:-}" \
    REDACT_TEST_DATABASE_URL="${TEST_DATABASE_URL:-}" \
    REDACT_DATABASE_URL="${DATABASE_URL:-}" \
    REDACT_MYSQL_PASSWORD="${MYSQL_PASSWORD:-}" \
    node - "$source_file" "$destination_file" <<'NODE'
const fs = require('node:fs');

const [sourcePath, destinationPath] = process.argv.slice(2);
let output = fs.readFileSync(sourcePath, 'utf8');
const secrets = [
  process.env.REDACT_HEROUI_AUTH_TOKEN,
  process.env.REDACT_TEST_DATABASE_URL,
  process.env.REDACT_DATABASE_URL,
  process.env.REDACT_MYSQL_PASSWORD,
].filter(Boolean).sort((left, right) => right.length - left.length);

for (const secret of secrets) output = output.split(secret).join('[REDACTED]');
fs.writeFileSync(destinationPath, output, { encoding: 'utf8', mode: 0o600 });
NODE
}

gate_marker() {
  local name="$1"
  name="${name^^}"
  name="${name//-/_}"
  printf '%s_OK\n' "$name"
}

run_gate() {
  local name="$1"
  shift
  local safe_name="${name//[^a-zA-Z0-9_-]/_}"
  local raw_file="$TEMP_DIR/$safe_name.raw"
  local safe_file="$TEMP_DIR/$safe_name.log"
  local status

  printf 'GATE_START %s\n' "$name"
  set +e
  (trap - EXIT INT TERM; "$@") >"$raw_file" 2>&1
  status=$?
  set -e
  redact_file "$raw_file" "$safe_file"
  cat "$safe_file"
  if [[ "$status" -ne 0 ]]; then
    if [[ "$status" -eq 2 ]]; then
      exit 2
    fi
    fail "$name"
  fi
  gate_marker "$name"
}

backend_npm_ci() {
  (cd "$BACKEND_DIR" && npm ci)
}

backend_db_generate() {
  (cd "$BACKEND_DIR" && npm run db:generate)
}

backend_unit_tests() {
  (cd "$BACKEND_DIR" && npm test)
}

backend_integration_tests() {
  (cd "$BACKEND_DIR" && npm run test:integration)
}

backend_typecheck() {
  (cd "$BACKEND_DIR" && npm run typecheck)
}

backend_build() {
  (cd "$BACKEND_DIR" && npm run build)
}

frontend_npm_ci() {
  [[ -n "${HEROUI_AUTH_TOKEN:-}" ]] || environment_blocked 'heroui-auth-token-unset'
  (cd "$FRONTEND_DIR" && npm ci)
}

frontend_tests() {
  (cd "$FRONTEND_DIR" && npm test)
}

frontend_typecheck() {
  (cd "$FRONTEND_DIR" && npm run typecheck)
}

frontend_lint() {
  (cd "$FRONTEND_DIR" && npm run lint)
}

frontend_build() {
  (cd "$FRONTEND_DIR" && npm run build)
}

qa_validate_cleanup_token() {
  [[ "$1" =~ ^[a-f0-9]{64}$ ]]
}

qa_ensure_state_root() {
  if [[ ! -e "$QA_STATE_ROOT" ]]; then
    mkdir -m 700 -- "$QA_STATE_ROOT" 2>/dev/null || true
  fi
  [[ -d "$QA_STATE_ROOT" && ! -L "$QA_STATE_ROOT" && -O "$QA_STATE_ROOT" ]] || fail 'unsafe-qa-state-root'
  chmod 700 -- "$QA_STATE_ROOT"
}

qa_create_state() {
  local token="$1"

  qa_validate_cleanup_token "$token" || fail 'invalid-generated-qa-cleanup-token'
  qa_ensure_state_root
  QA_STATE_DIR="$(mktemp -d "$QA_STATE_ROOT/qa-$token.XXXXXX")"
  chmod 700 -- "$QA_STATE_DIR"
  printf '%s\n' "$token" >"$QA_STATE_DIR/token"
  chmod 600 -- "$QA_STATE_DIR/token"
}

qa_process_identity() {
  local pid="$1"
  local stat
  local remainder
  local -a fields=()

  [[ "$pid" =~ ^[1-9][0-9]*$ && -r "/proc/$pid/stat" ]] || return 1
  stat="$(<"/proc/$pid/stat")"
  [[ "$stat" == *') '* ]] || return 1
  remainder="${stat##*) }"
  read -r -a fields <<<"$remainder"
  (( ${#fields[@]} >= 20 )) || return 1
  printf '%s %s %s\n' "${fields[19]}" "${fields[2]}" "${fields[3]}"
}

qa_stop_owned_process() {
  local state_dir="$1"
  local name="$2"
  local pid_file="$state_dir/$name.pid"
  local start_file="$state_dir/$name.start"
  local pid
  local expected_start
  local current_start
  local process_group
  local session_id
  local attempt

  [[ -f "$pid_file" && -f "$start_file" ]] || return 0
  pid="$(<"$pid_file")"
  expected_start="$(<"$start_file")"
  [[ "$pid" =~ ^[1-9][0-9]*$ && "$expected_start" =~ ^[0-9]+$ ]] || return 0
  if ! read -r current_start process_group session_id < <(qa_process_identity "$pid"); then
    return 0
  fi
  [[ "$current_start" == "$expected_start" && "$process_group" == "$pid" && "$session_id" == "$pid" ]] || return 0

  kill -TERM -- "-$pid" 2>/dev/null || true
  for attempt in {1..50}; do
    if read -r current_start process_group session_id < <(qa_process_identity "$pid"); then
      [[ "$current_start" == "$expected_start" && "$process_group" == "$pid" && "$session_id" == "$pid" ]] || return 0
    fi
    kill -0 -- "-$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  if read -r current_start process_group session_id < <(qa_process_identity "$pid"); then
    [[ "$current_start" == "$expected_start" && "$process_group" == "$pid" && "$session_id" == "$pid" ]] || return 0
  fi
  kill -KILL -- "-$pid" 2>/dev/null || true
}

qa_cleanup_state_dir() {
  local state_dir="$1"

  [[ "$state_dir" == "$QA_STATE_ROOT"/qa-* ]] || return 0
  [[ -d "$state_dir" && ! -L "$state_dir" && -O "$state_dir" ]] || return 0
  qa_stop_owned_process "$state_dir" frontend
  qa_stop_owned_process "$state_dir" backend
  qa_stop_owned_process "$state_dir" test
  rm -rf -- "$state_dir"
  rmdir -- "$QA_STATE_ROOT" 2>/dev/null || true
}

cleanup_qa() {
  local token="$1"
  local state_dir
  local -a candidates=()

  if ! qa_validate_cleanup_token "$token"; then
    printf 'CI_LOCAL_FAILED code=invalid-qa-cleanup-token\n' >&2
    exit 2
  fi
  [[ -d "$QA_STATE_ROOT" && ! -L "$QA_STATE_ROOT" && -O "$QA_STATE_ROOT" ]] || {
    printf 'QA_CLEANUP_OK\n'
    return 0
  }

  shopt -s nullglob
  candidates=("$QA_STATE_ROOT"/qa-"$token".*)
  shopt -u nullglob
  for state_dir in "${candidates[@]}"; do
    [[ -f "$state_dir/token" && "$(<"$state_dir/token")" == "$token" ]] || continue
    qa_cleanup_state_dir "$state_dir"
  done
  printf 'QA_CLEANUP_OK\n'
}

qa_redact_stream() {
  local redactor_source

  IFS= read -r -d '' redactor_source <<'NODE' || true
const readline = require('node:readline');

const secrets = [
  process.env.REDACT_HEROUI_AUTH_TOKEN,
  process.env.REDACT_DATABASE_URL,
  process.env.REDACT_AUTH_SECRET,
  process.env.REDACT_BOOTSTRAP_TOKEN,
  process.env.REDACT_QA_USERNAME,
  process.env.REDACT_QA_PASSWORD,
].filter(Boolean).sort((left, right) => right.length - left.length);

try {
  const databaseUrl = new URL(process.env.REDACT_DATABASE_URL);
  if (databaseUrl.password) secrets.push(decodeURIComponent(databaseUrl.password));
} catch {}

function redact(line) {
  let output = line;
  for (const secret of secrets) output = output.split(secret).join('[REDACTED]');
  output = output.replace(/mysql:\/\/[^\s]+/giu, 'mysql://[REDACTED]');
  output = output.replace(/(set-cookie|cookie|authorization|x-csrf-token)(\s*[:=]\s*)[^\r\n]+/giu, '$1$2[REDACTED]');
  return output;
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => process.stdout.write(`${redact(line)}\n`));
NODE
  export -n -f qa_redact_stream 2>/dev/null || true
  node -e "$redactor_source"
}

qa_run_logged() {
  local name="$1"
  local work_dir="$2"
  shift 2
  local log_file="$QA_STATE_DIR/$name.log"
  local status

  set +e
  # REDACT_* values are scrubbing patterns for the log redactor only. Strip them
  # from the command side of the pipe so a step never sees a secret it does not
  # itself need, mirroring the guard qa_start_process applies to runtime children.
  (
    unset REDACT_HEROUI_AUTH_TOKEN REDACT_DATABASE_URL REDACT_AUTH_SECRET
    unset REDACT_BOOTSTRAP_TOKEN REDACT_QA_USERNAME REDACT_QA_PASSWORD
    cd "$work_dir" && "$@"
  ) 2>&1 | qa_redact_stream >>"$log_file"
  status=${PIPESTATUS[0]}
  set -e
  chmod 600 -- "$log_file"
  [[ "$status" -eq 0 ]] || fail "qa-$name"
}

qa_sanitize_process_environment() {
  local profile="$1"
  local database_url="${DATABASE_URL:-}"
  local cors_origins="${CORS_ORIGINS:-}"
  local auth_secret="${AUTH_SECRET:-}"
  local bootstrap_disabled="${BOOTSTRAP_DISABLED:-}"
  local host="${HOST:-}"
  local port="${PORT:-}"
  local node_env="${NODE_ENV:-}"
  local app_origin="${APP_ORIGIN:-}"
  local api_proxy_target="${API_PROXY_TARGET:-}"
  local redact_database_url="${REDACT_DATABASE_URL:-}"
  local redact_auth_secret="${REDACT_AUTH_SECRET:-}"
  local environment_name
  local -a environment_names=()

  mapfile -t environment_names < <(compgen -e)
  for environment_name in "${environment_names[@]}"; do
    case "$environment_name" in
      PATH|HOME|USER|LOGNAME|SHELL|PWD|TMPDIR|LANG|LANGUAGE|LC_ALL|LC_CTYPE|TZ|TERM|COLORTERM|NO_COLOR|FORCE_COLOR|CI|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)
        ;;
      *)
        unset "$environment_name" 2>/dev/null || true
        ;;
    esac
  done

  case "$profile" in
    backend)
      export DATABASE_URL="$database_url"
      export CORS_ORIGINS="$cors_origins"
      export AUTH_SECRET="$auth_secret"
      export BOOTSTRAP_DISABLED="$bootstrap_disabled"
      export HOST="$host"
      export PORT="$port"
      export NODE_ENV="$node_env"
      export REDACT_DATABASE_URL="$redact_database_url"
      export REDACT_AUTH_SECRET="$redact_auth_secret"
      ;;
    frontend)
      export APP_ORIGIN="$app_origin"
      export API_PROXY_TARGET="$api_proxy_target"
      ;;
    test)
      ;;
    *)
      fail 'invalid-qa-process-profile'
      ;;
  esac
}

qa_start_process() {
  local name="$1"
  local log_file="$2"
  local work_dir="$3"
  local profile="$4"
  shift 4
  local pid
  local start_time
  local process_group
  local session_id
  local attempt

  : >"$log_file"
  chmod 600 -- "$log_file"
  export -f qa_redact_stream
  (
    cd "$work_dir"
    qa_sanitize_process_environment "$profile"
    # The child shell expands its positional parameters after setsid starts the process group.
    # shellcheck disable=SC2016
    exec setsid bash -c '
      set -o pipefail
      log_file="$1"
      shift
      (
        export -n -f qa_redact_stream 2>/dev/null || true
        unset REDACT_DATABASE_URL REDACT_AUTH_SECRET
        exec "$@"
      ) 2>&1 | (
        unset DATABASE_URL CORS_ORIGINS AUTH_SECRET BOOTSTRAP_DISABLED HOST PORT NODE_ENV
        unset APP_ORIGIN API_PROXY_TARGET
        qa_redact_stream
      ) >"$log_file"
    ' _ "$log_file" "$@"
  ) </dev/null >/dev/null 2>&1 &
  pid=$!
  for attempt in {1..50}; do
    if read -r start_time process_group session_id < <(qa_process_identity "$pid"); then
      if [[ "$process_group" == "$pid" && "$session_id" == "$pid" ]]; then
        printf '%s\n' "$pid" >"$QA_STATE_DIR/$name.pid"
        printf '%s\n' "$start_time" >"$QA_STATE_DIR/$name.start"
        chmod 600 -- "$QA_STATE_DIR/$name.pid" "$QA_STATE_DIR/$name.start"
        return 0
      fi
    fi
    sleep 0.02
  done
  kill "$pid" 2>/dev/null || true
  fail "qa-$name-process-ownership"
}

qa_process_is_owned() {
  local name="$1"
  local pid
  local expected_start
  local current_start
  local process_group
  local session_id

  [[ -f "$QA_STATE_DIR/$name.pid" && -f "$QA_STATE_DIR/$name.start" ]] || return 1
  pid="$(<"$QA_STATE_DIR/$name.pid")"
  expected_start="$(<"$QA_STATE_DIR/$name.start")"
  read -r current_start process_group session_id < <(qa_process_identity "$pid") || return 1
  [[ "$current_start" == "$expected_start" && "$process_group" == "$pid" && "$session_id" == "$pid" ]]
}

qa_print_diagnostics() {
  local log_file

  QA_DIAGNOSTICS_EMITTED=1
  printf 'QA_STARTUP_FAILED\n' >&2
  [[ -n "${QA_STATE_DIR:-}" && -d "$QA_STATE_DIR" ]] || return 0
  shopt -s nullglob
  for log_file in "$QA_STATE_DIR"/*.log; do
    printf 'QA_DIAGNOSTIC_LOG name=%s\n' "$(basename -- "$log_file")" >&2
    tail -n 40 -- "$log_file" | \
      REDACT_DATABASE_URL="${QA_DATABASE_URL:-}" \
        REDACT_AUTH_SECRET="${QA_AUTH_SECRET:-}" \
        REDACT_BOOTSTRAP_TOKEN="${QA_BOOTSTRAP_TOKEN:-}" \
        REDACT_QA_USERNAME="${QA_USERNAME:-}" \
        REDACT_QA_PASSWORD="${QA_PASSWORD:-}" \
        qa_redact_stream >&2
  done
  shopt -u nullglob
}

qa_find_loopback_port() {
  node <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.unref();
server.on('error', () => process.exit(1));
server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  const port = address.port;
  server.close(() => process.stdout.write(`${port}\n`));
});
NODE
}

qa_validate_database() {
  TEST_DATABASE_URL="$QA_DATABASE_URL" node test/integration/validate-test-database-url.cjs
  DATABASE_URL="$QA_DATABASE_URL" node <<'NODE'
const mysql = require('mysql2/promise');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  const database = decodeURIComponent(url.pathname.slice(1));
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [rows] = await connection.query(
      'SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = ?',
      [database],
    );
    if (Number(rows[0].table_count) !== 0) throw new Error('QA database must be fresh and contain no tables');
    process.stdout.write('QA_DATABASE_FRESH_OK\n');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE
}

qa_backend_database_command() {
  DATABASE_URL="$QA_DATABASE_URL" npm "$@"
}

# Dependency install and Prisma client generation are offline operations. `prisma
# generate` reads the datasource block but never resolves env("DATABASE_URL"),
# so handing them the live QA database URL would expose it to every dependency
# lifecycle script for no functional gain.
qa_backend_offline_command() {
  npm "$@"
}

qa_backend_bootstrap_command() {
  DATABASE_URL="$QA_DATABASE_URL" \
    AUTH_SECRET="$QA_AUTH_SECRET" \
    BOOTSTRAP_TOKEN="$QA_BOOTSTRAP_TOKEN" \
    BOOTSTRAP_ADMIN_USERNAME="$QA_USERNAME" \
    BOOTSTRAP_ADMIN_PASSWORD="$QA_PASSWORD" \
    BOOTSTRAP_DISABLED=false \
    npm "$@"
}

qa_frontend_install() {
  HEROUI_AUTH_TOKEN="$QA_HEROUI_AUTH_TOKEN" npm ci
}

qa_backend_build_command() {
  npm "$@"
}

qa_copy_backend_runtime() {
  mkdir -m 700 -- "$QA_BACKEND_RUNTIME_DIR"
  (
    cd "$BACKEND_DIR"
    tar --exclude='./.env' --exclude='./.env.*' --exclude='./dist' --exclude='./node_modules' -cf - .
  ) | (
    cd "$QA_BACKEND_RUNTIME_DIR"
    tar -xf -
  )
}

qa_copy_frontend_runtime() {
  mkdir -m 700 -- "$QA_FRONTEND_RUNTIME_DIR"
  (
    cd "$FRONTEND_DIR"
    tar --exclude='./.env' --exclude='./.env.*' --exclude='./.next' --exclude='./node_modules' -cf - .
  ) | (
    cd "$QA_FRONTEND_RUNTIME_DIR"
    tar -xf -
  )
}

qa_install_and_build() {
  qa_run_logged backend-runtime-copy "$ROOT_DIR" qa_copy_backend_runtime
  qa_run_logged backend-npm-ci "$QA_BACKEND_RUNTIME_DIR" qa_backend_offline_command ci
  qa_run_logged backend-db-generate "$QA_BACKEND_RUNTIME_DIR" qa_backend_offline_command run db:generate
  qa_run_logged backend-build "$QA_BACKEND_RUNTIME_DIR" qa_backend_build_command run build
  qa_run_logged frontend-runtime-copy "$ROOT_DIR" qa_copy_frontend_runtime
  REDACT_HEROUI_AUTH_TOKEN="$QA_HEROUI_AUTH_TOKEN" \
    qa_run_logged frontend-npm-ci "$QA_FRONTEND_RUNTIME_DIR" qa_frontend_install
  unset QA_HEROUI_AUTH_TOKEN
  qa_run_logged frontend-production-cookie-test "$QA_FRONTEND_RUNTIME_DIR" npm test -- test/auth-boundary.test.ts
}

qa_prepare_database() {
  REDACT_DATABASE_URL="$QA_DATABASE_URL" \
    qa_run_logged database-freshness "$QA_BACKEND_RUNTIME_DIR" qa_validate_database
  REDACT_DATABASE_URL="$QA_DATABASE_URL" \
    qa_run_logged database-migrate-deploy "$QA_BACKEND_RUNTIME_DIR" qa_backend_database_command run db:deploy
  REDACT_DATABASE_URL="$QA_DATABASE_URL" \
    REDACT_AUTH_SECRET="$QA_AUTH_SECRET" \
    REDACT_BOOTSTRAP_TOKEN="$QA_BOOTSTRAP_TOKEN" \
    REDACT_QA_USERNAME="$QA_USERNAME" \
    REDACT_QA_PASSWORD="$QA_PASSWORD" \
    qa_run_logged operator-bootstrap "$QA_BACKEND_RUNTIME_DIR" qa_backend_bootstrap_command run auth:bootstrap
  unset QA_BOOTSTRAP_TOKEN
}

qa_assert_ephemeral_secrets_cleared() {
  [[ -z "${QA_HEROUI_AUTH_TOKEN:-}" && -z "${QA_BOOTSTRAP_TOKEN:-}" ]] || fail 'qa-secret-lifetime'
}

# Guards the secret boundary itself: every QA secret must be a plain shell
# variable so no child process inherits it implicitly. Values reach a consumer
# only through an explicit per-command environment assignment.
qa_assert_secrets_unexported() {
  local secret_name

  for secret_name in QA_HEROUI_AUTH_TOKEN QA_DATABASE_URL QA_AUTH_SECRET \
    QA_BOOTSTRAP_TOKEN QA_USERNAME QA_PASSWORD; do
    if compgen -e -X "!$secret_name" >/dev/null 2>&1; then
      fail 'qa-secret-exported'
    fi
  done
}

qa_wait_for_url() {
  local process_name="$1"
  local url="$2"
  local follow_redirects="$3"
  local attempt
  local -a curl_args=(--fail --silent --show-error --max-time 2 --output /dev/null)

  [[ "$follow_redirects" == true ]] && curl_args+=(--location)
  for ((attempt = 0; attempt < 120; attempt++)); do
    qa_process_is_owned "$process_name" || fail "qa-$process_name-exited"
    if curl "${curl_args[@]}" "$url" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  fail "qa-$process_name-readiness-timeout"
}

qa_extract_cookie() {
  local cookie_name="$1"
  local cookie_file="$2"
  COOKIE_NAME="$cookie_name" node - "$cookie_file" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const name = process.env.COOKIE_NAME;
const line = fs.readFileSync(path, 'utf8').split(/\r?\n/u).find((entry) => {
  if (!entry || (entry.startsWith('#') && !entry.startsWith('#HttpOnly_'))) return false;
  const fields = entry.replace(/^#HttpOnly_/u, '').split('\t');
  return fields.length >= 7 && fields[5] === name;
});
if (!line) process.exit(1);
process.stdout.write(line.replace(/^#HttpOnly_/u, '').split('\t')[6]);
NODE
}

qa_verify_bff_login() {
  local cookie_jar="$QA_STATE_DIR/browser.cookies"
  local csrf_token
  local status

  : >"$cookie_jar"
  chmod 600 -- "$cookie_jar"
  status="$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \
    --request GET --cookie "$cookie_jar" --cookie-jar "$cookie_jar" "$QA_FRONTEND_URL/api/auth/login")"
  [[ "$status" == 204 ]] || fail 'qa-bff-csrf-bootstrap'
  csrf_token="$(qa_extract_cookie ipam_csrf "$cookie_jar")" || fail 'qa-bff-csrf-cookie'

  set +e
  status="$(
    QA_USERNAME="$QA_USERNAME" QA_PASSWORD="$QA_PASSWORD" node <<'NODE' |
process.stdout.write(JSON.stringify({
  username: process.env.QA_USERNAME,
  password: process.env.QA_PASSWORD,
}));
NODE
    QA_CSRF_TOKEN="$csrf_token" QA_ORIGIN="$QA_FRONTEND_URL" \
      bash -c 'curl --silent --show-error --max-time 10 --output /dev/null --write-out "%{http_code}" \
        --request POST --cookie "$1" --cookie-jar "$1" \
        --header "Accept: application/json" --header "Content-Type: application/json" \
        --header "Origin: $QA_ORIGIN" --header "X-CSRF-Token: $QA_CSRF_TOKEN" \
        --data-binary @- "$QA_ORIGIN/api/auth/login"' _ "$cookie_jar"
  )"
  local login_status=$?
  set -e
  [[ "$login_status" -eq 0 && "$status" == 200 ]] || fail 'qa-bff-login'
  qa_extract_cookie ipam_session "$cookie_jar" >/dev/null || fail 'qa-bff-session-cookie'
}

qa_write_credentials() {
  QA_CREDENTIALS_FILE="$QA_STATE_DIR/credentials.json"
  QA_CREDENTIALS_FILE="$QA_CREDENTIALS_FILE" \
    QA_USERNAME="$QA_USERNAME" \
    QA_PASSWORD="$QA_PASSWORD" \
    QA_BACKEND_URL="$QA_BACKEND_URL" \
    QA_FRONTEND_URL="$QA_FRONTEND_URL" \
    node <<'NODE'
const fs = require('node:fs');
const credentials = {
  username: process.env.QA_USERNAME,
  password: process.env.QA_PASSWORD,
  backendUrl: process.env.QA_BACKEND_URL,
  frontendUrl: process.env.QA_FRONTEND_URL,
};
fs.writeFileSync(process.env.QA_CREDENTIALS_FILE, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
NODE
  chmod 600 -- "$QA_CREDENTIALS_FILE"
}

# Captures the two caller-supplied inputs, clears every ambient copy, mints the
# ephemeral QA secrets, and guarantees all of them are plain (unexported) shell
# variables. Kept separate from serve_qa so the secret boundary is directly
# testable without running an install or starting a process.
qa_capture_secrets() {
  [[ -n "${HEROUI_AUTH_TOKEN:-}" ]] || environment_blocked 'heroui-auth-token-unset'
  [[ -n "${TEST_DATABASE_URL:-}" ]] || environment_blocked 'test-database-url-unset'

  QA_HEROUI_AUTH_TOKEN="$HEROUI_AUTH_TOKEN"
  QA_DATABASE_URL="$TEST_DATABASE_URL"
  unset HEROUI_AUTH_TOKEN TEST_DATABASE_URL DATABASE_URL AUTH_SECRET
  unset BOOTSTRAP_TOKEN BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_PASSWORD
  unset CORS_ORIGINS APP_ORIGIN API_PROXY_TARGET

  QA_AUTH_SECRET="$(openssl rand -hex 32)"
  QA_BOOTSTRAP_TOKEN="$(openssl rand -hex 16)"
  QA_USERNAME="qa_operator_$(openssl rand -hex 8)"
  QA_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"

  # QA secrets stay unexported. Each value is handed to the single command that
  # needs it via a per-command environment assignment, so unrelated children
  # (npm ci, prisma generate, builds, the frontend cookie test) never inherit
  # them. Assignment alone is not enough: a name already exported in the caller's
  # environment keeps its export attribute, so drop it explicitly.
  export -n QA_HEROUI_AUTH_TOKEN QA_DATABASE_URL QA_AUTH_SECRET \
    QA_BOOTSTRAP_TOKEN QA_USERNAME QA_PASSWORD 2>/dev/null || true
  qa_assert_secrets_unexported
}

serve_qa() {
  local cleanup_token

  qa_capture_secrets

  cleanup_token="$(openssl rand -hex 32)"
  qa_create_state "$cleanup_token"
  QA_BACKEND_RUNTIME_DIR="$QA_STATE_DIR/backend-runtime"
  QA_FRONTEND_RUNTIME_DIR="$QA_STATE_DIR/frontend-runtime"

  qa_install_and_build
  QA_BACKEND_PORT="$(qa_find_loopback_port)"
  QA_FRONTEND_PORT="$(qa_find_loopback_port)"
  while [[ "$QA_FRONTEND_PORT" == "$QA_BACKEND_PORT" ]]; do
    QA_FRONTEND_PORT="$(qa_find_loopback_port)"
  done
  QA_BACKEND_URL="http://127.0.0.1:$QA_BACKEND_PORT"
  QA_FRONTEND_URL="http://127.0.0.1:$QA_FRONTEND_PORT"

  qa_prepare_database
  qa_write_credentials
  qa_assert_ephemeral_secrets_cleared
  DATABASE_URL="$QA_DATABASE_URL" \
    CORS_ORIGINS="$QA_FRONTEND_URL" \
    AUTH_SECRET="$QA_AUTH_SECRET" \
    BOOTSTRAP_DISABLED=true \
    HOST=127.0.0.1 \
    PORT="$QA_BACKEND_PORT" \
    NODE_ENV=production \
    REDACT_DATABASE_URL="$QA_DATABASE_URL" \
    REDACT_AUTH_SECRET="$QA_AUTH_SECRET" \
    qa_start_process backend "$QA_STATE_DIR/backend.log" "$QA_BACKEND_RUNTIME_DIR" backend npm run start:prod
  qa_wait_for_url backend "$QA_BACKEND_URL/api/health/ready" false
  APP_ORIGIN="$QA_FRONTEND_URL" \
    API_PROXY_TARGET="$QA_BACKEND_URL" \
    qa_start_process frontend "$QA_STATE_DIR/frontend.log" "$QA_FRONTEND_RUNTIME_DIR" frontend \
      npm run dev -- --hostname 127.0.0.1 --port "$QA_FRONTEND_PORT"
  qa_wait_for_url frontend "$QA_FRONTEND_URL/" true
  qa_verify_bff_login

  QA_KEEP_STATE=1
  printf 'QA_BACKEND_URL=%s\n' "$QA_BACKEND_URL"
  printf 'QA_FRONTEND_URL=%s\n' "$QA_FRONTEND_URL"
  printf 'QA_CREDENTIALS_FILE=%s\n' "$QA_CREDENTIALS_FILE"
  printf 'QA_CLEANUP_TOKEN=%s\n' "$cleanup_token"
}

verify_image_map() {
  VERIFY_IMAGE_MAP_MODE=auto bash "$IMAGE_MAP_SCRIPT"
}

verify_deployment() {
  bash "$DEPLOYMENT_SCRIPT" config
}

verify_evidence_only() {
  local attempt_dir="$1"
  local evidence_path="$attempt_dir/github-protection.json"
  local status

  [[ -d "$attempt_dir" ]] || fail "missing-attempt-directory"
  mkdir -p -- "$attempt_dir"
  set +e
  bash "$PROTECTION_SCRIPT" --evidence "$evidence_path"
  status=$?
  set -e
  if [[ "$status" -eq 2 ]]; then
    exit 2
  fi
  [[ "$status" -eq 0 ]] || fail "github-protection"
  printf 'GITHUB_PROTECTION_EVIDENCE_OK path=%s\n' "$evidence_path"
}

run_full_gate() {
  [[ -n "${TEST_DATABASE_URL:-}" ]] || environment_blocked 'test-database-url-unset'

  run_gate backend-npm-ci backend_npm_ci
  run_gate backend-db-generate backend_db_generate
  run_gate backend-unit-tests backend_unit_tests
  run_gate backend-integration-tests backend_integration_tests
  run_gate backend-typecheck backend_typecheck
  run_gate backend-build backend_build

  run_gate frontend-npm-ci frontend_npm_ci
  run_gate frontend-tests frontend_tests
  run_gate frontend-typecheck frontend_typecheck
  run_gate frontend-lint frontend_lint
  run_gate frontend-build frontend_build

  run_gate image-map verify_image_map
  run_gate deployment-configuration verify_deployment

  info 'CI_LOCAL_PUBLIC_AND_PRIVATE_GATES_OK'
}

main() {
  local node_command

  node_command="${1:-}"
  if [[ "$node_command" == --cleanup-qa ]]; then
    [[ "$#" -eq 2 ]] || { usage; exit 2; }
    cleanup_qa "$2"
    return
  fi

  require_command bash
  require_command cat
  require_command mktemp
  require_command node
  require_command npm
  if [[ "$node_command" == --serve-qa ]]; then
    require_command basename
    require_command chmod
    require_command curl
    require_command kill
    require_command mkdir
    require_command openssl
    require_command setsid
    require_command sleep
    require_command tail
    require_command tar
    require_command tr
  fi
  [[ -f "$IMAGE_MAP_SCRIPT" ]] || fail 'missing-image-map-script'
  [[ -f "$DEPLOYMENT_SCRIPT" ]] || fail 'missing-deployment-script'
  [[ -f "$PROTECTION_SCRIPT" ]] || fail 'missing-protection-script'

  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam-ci-local.XXXXXX")"
  case "$node_command" in
    --serve-qa)
      [[ "$#" -eq 1 ]] || { usage; exit 2; }
      serve_qa
      ;;
    --verify-evidence-only)
      [[ "$#" -eq 2 ]] || { usage; exit 2; }
      verify_evidence_only "$2"
      ;;
    '')
      [[ "$#" -eq 0 ]] || { usage; exit 2; }
      run_full_gate
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
