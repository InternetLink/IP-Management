#!/usr/bin/env bash
set -euo pipefail

umask 077

# Proves the documented `npm run auth:bootstrap` command actually creates the
# first admin account, and is safely idempotent on a second run, against a
# real MySQL database using the already-compiled backend artifact.
#
# This is the success-path companion to test-production-auth-bootstrap.sh,
# which only proves the no-credentials failure boundary. Neither script
# rebuilds the backend: both consume whatever `backend/dist` the caller has
# already produced with a single `npm run build`.

declare ROOT_DIR
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT_DIR
readonly BACKEND_DIR="$ROOT_DIR/backend"
readonly BOOTSTRAP_ARTIFACT="$BACKEND_DIR/dist/src/scripts/bootstrap-admin.js"
readonly PRISMA_SCHEMA="$BACKEND_DIR/prisma/schema.prisma"
readonly PRISMA_BIN="$BACKEND_DIR/node_modules/.bin/prisma"

DB_HOST=''
DB_PORT=''
DB_USER=''
DB_PASSWORD=''
DB_NAME=''

fail() {
  printf 'PRODUCTION_AUTH_BOOTSTRAP_SUCCESS_TEST_FAILED reason=%s\n' "$1" >&2
  exit 1
}

blocked() {
  printf 'ENVIRONMENT_BLOCKED component=production-auth-bootstrap-success reason=%s\n' "$1" >&2
  exit 2
}

mask_secret() {
  # Best-effort GitHub Actions log redaction. A no-op outside CI.
  if [[ "${GITHUB_ACTIONS:-}" == 'true' ]]; then
    printf '::add-mask::%s\n' "$1"
  fi
}

reset_bootstrap_state() {
  printf '%s\n%s\n%s\n' \
    'DELETE FROM `audit_logs`;' \
    'DELETE FROM `users`;' \
    "UPDATE \`bootstrap_states\` SET \`completedAt\` = NULL, \`completedByUserId\` = NULL WHERE \`id\` = 'bootstrap';" \
    | "$PRISMA_BIN" db execute --url "$TEST_DATABASE_URL" --stdin >/dev/null
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  # Leave the shared TEST_DATABASE_URL fixture exactly as this script found
  # it (no created user, no completed bootstrap state), pass or fail, so a
  # retried job step never inherits state from a previous attempt.
  if [[ -n "${TEST_DATABASE_URL:-}" && -n "$DB_HOST" ]]; then
    reset_bootstrap_state || printf 'PRODUCTION_AUTH_BOOTSTRAP_SUCCESS_CLEANUP_FAILED\n' >&2
  fi
  exit "$status"
}

parse_test_database_url() {
  node -e '
    const u = new URL(process.env.TEST_DATABASE_URL);
    process.stdout.write([
      u.hostname,
      u.port || "3306",
      decodeURIComponent(u.username),
      decodeURIComponent(u.password),
      u.pathname.replace(/^\//, ""),
    ].join("\t"));
  '
}

query_scalar() {
  local sql="$1"
  MYSQL_PWD="$DB_PASSWORD" mysql --protocol=TCP --host="$DB_HOST" --port="$DB_PORT" \
    --user="$DB_USER" "$DB_NAME" -N -B -e "$sql"
}

run_bootstrap_once() {
  local admin_username="$1" admin_password="$2" auth_secret="$3" bootstrap_token="$4"
  (
    cd "$BACKEND_DIR" && env -i PATH="$PATH" HOME="${HOME:-/tmp}" NODE_ENV=production \
      DATABASE_URL="$TEST_DATABASE_URL" \
      AUTH_SECRET="$auth_secret" \
      BOOTSTRAP_TOKEN="$bootstrap_token" \
      BOOTSTRAP_ADMIN_USERNAME="$admin_username" \
      BOOTSTRAP_ADMIN_PASSWORD="$admin_password" \
      npm run auth:bootstrap 2>&1
  )
}

main() {
  [[ -n "${TEST_DATABASE_URL:-}" ]] || blocked 'test-database-url-unavailable'
  command -v openssl >/dev/null 2>&1 || fail 'openssl-unavailable'
  command -v mysql >/dev/null 2>&1 || fail 'mysql-client-unavailable'
  command -v node >/dev/null 2>&1 || fail 'node-unavailable'
  [[ -x "$PRISMA_BIN" ]] || fail 'prisma-cli-missing'

  # Given: an already-compiled backend artifact. This script never rebuilds
  # it; a missing artifact is a setup error, not something to paper over.
  [[ -f "$BOOTSTRAP_ARTIFACT" && -s "$BOOTSTRAP_ARTIFACT" ]] \
    || fail 'missing-compiled-bootstrap-artifact'

  IFS=$'\t' read -r DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME <<<"$(parse_test_database_url)"
  [[ -n "$DB_HOST" && -n "$DB_NAME" ]] || fail 'unparseable-test-database-url'

  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  # `prisma migrate deploy` is idempotent, so running it here is always safe.
  # It also seeds the `bootstrap_states` singleton row this test depends on.
  (cd "$BACKEND_DIR" && DATABASE_URL="$TEST_DATABASE_URL" "$PRISMA_BIN" migrate deploy --schema "$PRISMA_SCHEMA") \
    || fail 'migrate-deploy-failed'

  # Defensive pre-clean: a retried job step must not inherit state from a
  # previous, possibly-failed attempt against the same service container.
  reset_bootstrap_state || fail 'pre-clean-failed'

  local admin_username='ci-bootstrap-admin'
  local admin_password auth_secret bootstrap_token
  admin_password="$(openssl rand -base64 18)"
  auth_secret="$(openssl rand -base64 48)"
  bootstrap_token="$(openssl rand -base64 32)"
  mask_secret "$admin_password"
  mask_secret "$auth_secret"
  mask_secret "$bootstrap_token"

  # When: an operator runs the documented production command against a real,
  # freshly migrated MySQL database with no admin yet.
  local output status
  set +e
  output="$(run_bootstrap_once "$admin_username" "$admin_password" "$auth_secret" "$bootstrap_token")"
  status=$?
  set -e

  # Then: the compiled CLI actually creates the admin account end to end.
  if [[ "$status" -ne 0 ]]; then
    printf '%s\n' "$output" >&2
    fail "unexpected-first-run-status-$status"
  fi
  if [[ "$output" == *'ts-node'* || "$output" == *'MODULE_NOT_FOUND'* || "$output" == *'Cannot find module'* ]]; then
    printf '%s\n' "$output" >&2
    fail 'runtime-module-resolution'
  fi
  if [[ "$output" != *'Bootstrap completed.'* ]]; then
    printf '%s\n' "$output" >&2
    fail 'missing-success-message'
  fi

  local user_count completed_at
  user_count="$(query_scalar 'SELECT COUNT(*) FROM `users`;')"
  [[ "$user_count" == '1' ]] || fail 'admin-row-not-persisted'
  completed_at="$(query_scalar "SELECT \`completedAt\` FROM \`bootstrap_states\` WHERE \`id\` = 'bootstrap';")"
  [[ -n "$completed_at" && "$completed_at" != 'NULL' ]] || fail 'bootstrap-state-not-marked-complete'

  # When: the operator runs the exact same documented command again.
  set +e
  output="$(run_bootstrap_once "$admin_username" "$admin_password" "$auth_secret" "$bootstrap_token")"
  status=$?
  set -e

  # Then: it reports the idempotent no-op message and exits success, not an
  # error, and does not create a second admin row.
  if [[ "$status" -ne 0 ]]; then
    printf '%s\n' "$output" >&2
    fail "unexpected-idempotent-run-status-$status"
  fi
  if [[ "$output" != *'Bootstrap already completed; no action taken.'* ]]; then
    printf '%s\n' "$output" >&2
    fail 'missing-idempotent-message'
  fi

  user_count="$(query_scalar 'SELECT COUNT(*) FROM `users`;')"
  [[ "$user_count" == '1' ]] || fail 'idempotent-duplicate-admin-row'

  printf 'PRODUCTION_AUTH_BOOTSTRAP_SUCCESS_TESTS_OK\n'
}

main "$@"
