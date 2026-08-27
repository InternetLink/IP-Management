#!/usr/bin/env bash
set -euo pipefail

umask 077

declare ROOT_DIR
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT_DIR
readonly BACKEND_DIR="$ROOT_DIR/backend"
readonly BACKEND_DIST_DIR="$BACKEND_DIR/dist"
readonly BOOTSTRAP_ARTIFACT="$BACKEND_DIST_DIR/src/scripts/bootstrap-admin.js"
TEST_TMPDIR=''

fail() {
  printf 'PRODUCTION_AUTH_BOOTSTRAP_TEST_FAILED reason=%s\n' "$1" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$TEST_TMPDIR" && -d "$TEST_TMPDIR" && ! -L "$TEST_TMPDIR" && -O "$TEST_TMPDIR" ]]; then
    case "$TEST_TMPDIR" in
      "${TMPDIR:-/tmp}"/production-auth-bootstrap-test.*|"${TMPDIR:-/tmp}"/production-auth-bootstrap-test.*/signal-*)
        rm -rf -- "$TEST_TMPDIR"
        ;;
    esac
  fi
  exit "$status"
}

assert_signal_cleanup() {
  local signal="$1"
  local expected_status="$2"
  local probe_dir="$TEST_TMPDIR/signal-$signal"
  local status

  set +e
  BOOTSTRAP_SIGNAL_PROBE="$signal" BOOTSTRAP_SIGNAL_PROBE_DIR="$probe_dir" \
    bash "$0" >/dev/null 2>&1
  status=$?
  set -e

  [[ "$status" -eq "$expected_status" ]] || fail "signal-$signal-status-$status"
  [[ ! -d "$probe_dir" ]] || fail "signal-$signal-cleanup"
}

assert_docker_contract() {
  local dockerfile="$1"
  local runtime_scripts_copy="$2"

  grep -Fq 'COPY backend/src ./src' "$dockerfile" \
    || fail "missing-backend-source-$(basename "$dockerfile")"
  grep -Fq "$runtime_scripts_copy" "$dockerfile" \
    || fail "runtime-shell-scripts-$(basename "$dockerfile")"
  if grep -Fq 'tsconfig.bootstrap.json' "$dockerfile"; then
    fail "dedicated-bootstrap-config-$(basename "$dockerfile")"
  fi
  if grep -Fq 'COPY backend/scripts/bootstrap-admin.ts' "$dockerfile"; then
    fail "external-bootstrap-source-$(basename "$dockerfile")"
  fi
  if grep -Eq '^COPY .*backend/scripts[[:space:]]+\./(backend/)?scripts/?$' "$dockerfile"; then
    fail "runtime-typescript-source-$(basename "$dockerfile")"
  fi
}

assert_package_contract() {
  BACKEND_PACKAGE_JSON="$BACKEND_DIR/package.json" node <<'NODE' || fail 'package-script-contract'
const packageJson = require(process.env.BACKEND_PACKAGE_JSON);
if (packageJson.scripts?.build !== 'nest build') process.exit(1);
if (packageJson.scripts?.['auth:bootstrap'] !== 'node dist/src/scripts/bootstrap-admin.js') process.exit(1);
NODE
}

assert_compiled_artifact() {
  [[ ! -e "$BACKEND_DIST_DIR/scripts/bootstrap-admin.js" ]] \
    || fail 'stale-bootstrap-artifact'
  [[ -f "$BOOTSTRAP_ARTIFACT" && -s "$BOOTSTRAP_ARTIFACT" ]] \
    || fail 'missing-compiled-bootstrap-artifact'
}

main() {
  local output status

  TEST_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/production-auth-bootstrap-test.XXXXXX")"

  # Given: a freshly built backend with only production dependencies and runtime artifacts.
  assert_signal_cleanup INT 130
  assert_signal_cleanup TERM 143
  assert_compiled_artifact
  assert_package_contract
  assert_docker_contract \
    "$ROOT_DIR/Dockerfile.backend" \
    'COPY --chown=node:node backend/scripts/start-prod.sh backend/scripts/verify-migrations.sh ./scripts/'
  assert_docker_contract \
    "$ROOT_DIR/Dockerfile" \
    'COPY --chown=node:node backend/scripts/start-prod.sh backend/scripts/verify-migrations.sh ./backend/scripts/'
  mkdir -p "$TEST_TMPDIR/backend"
  cp "$BACKEND_DIR/package.json" "$BACKEND_DIR/package-lock.json" "$TEST_TMPDIR/backend/"
  cp -R "$BACKEND_DIR/prisma" "$BACKEND_DIST_DIR" "$TEST_TMPDIR/backend/"
  : >"$TEST_TMPDIR/npmrc"
  chmod 600 "$TEST_TMPDIR/npmrc"
  if ! (cd "$TEST_TMPDIR/backend" && env -i \
    PATH="$PATH" HOME="${HOME:-/tmp}" NPM_CONFIG_USERCONFIG="$TEST_TMPDIR/npmrc" \
    npm ci --omit=dev); then
    fail 'production-install-failed'
  fi
  [[ ! -x "$TEST_TMPDIR/backend/node_modules/.bin/ts-node" ]] || fail 'ts-node-present'

  # When: an operator executes the documented package command without required credentials.
  set +e
  output="$(
    cd "$TEST_TMPDIR/backend" &&
      env -i PATH="$PATH" HOME="${HOME:-/tmp}" \
        NPM_CONFIG_USERCONFIG="$TEST_TMPDIR/npmrc" NODE_ENV=production \
        npm run auth:bootstrap 2>&1
  )"
  status=$?
  set -e

  # Then: compiled JavaScript starts and reports the existing safe boundary error.
  if [[ "$status" -ne 1 ]]; then
    printf '%s\n' "$output" >&2
    fail "unexpected-status-$status"
  fi
  if [[ "$output" == *'ts-node'* || "$output" == *'MODULE_NOT_FOUND'* || "$output" == *'Cannot find module'* ]]; then
    printf '%s\n' "$output" >&2
    fail 'runtime-module-resolution'
  fi
  [[ "$output" == *'BOOTSTRAP_TOKEN'* ]] || fail 'bootstrap-token-boundary'

  printf 'PRODUCTION_AUTH_BOOTSTRAP_TESTS_OK\n'
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -n "${BOOTSTRAP_SIGNAL_PROBE:-}" ]]; then
  TEST_TMPDIR="${BOOTSTRAP_SIGNAL_PROBE_DIR:?}"
  mkdir -p -- "$TEST_TMPDIR"
  kill -s "$BOOTSTRAP_SIGNAL_PROBE" "$BASHPID"
  fail 'signal-probe-returned'
fi

main "$@"
