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

TEMP_DIR=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM

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
  printf 'Usage: %s [--verify-evidence-only <attempt-directory>]\n' "${BASH_SOURCE[0]}" >&2
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

  require_command bash
  require_command cat
  require_command mktemp
  require_command node
  require_command npm
  [[ -f "$IMAGE_MAP_SCRIPT" ]] || fail 'missing-image-map-script'
  [[ -f "$DEPLOYMENT_SCRIPT" ]] || fail 'missing-deployment-script'
  [[ -f "$PROTECTION_SCRIPT" ]] || fail 'missing-protection-script'

  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam-ci-local.XXXXXX")"
  node_command="${1:-}"
  case "$node_command" in
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

main "$@"
