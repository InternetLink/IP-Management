#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT_DIR
readonly VERIFIER="$ROOT_DIR/scripts/verify-deployment.sh"
readonly FIXTURE_BIN="$ROOT_DIR/scripts/fixtures/verify-deployment-all"
readonly SAFE_DATABASE_URL='mysql://fixture:fixture-password@127.0.0.1:3306/ipam_fixture_test'
readonly SAFE_MYSQL_SERVICE_CONTAINER_ID='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ipam-deployment-all-test.XXXXXX")"
readonly TEST_ROOT
readonly ORIGINAL_PATH="$PATH"
LAST_STATUS=0
CASE_ROOT=""
OUTPUT_FILE=""

cleanup() {
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT INT TERM

fail() {
  printf 'DEPLOYMENT_ALL_TEST_FAILED: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$file" || fail "missing expected output: $expected"
}

assert_secret_absent() {
  local file="$1"
  if grep -Fq -- "$SAFE_DATABASE_URL" "$file" || grep -Fq -- 'fixture-password' "$file"; then
    fail "database credential leaked from verifier"
  fi
  if grep -Eq -- 'AUTH_SECRET=[a-f0-9]{32,}' "$file"; then
    fail "generated auth secret leaked from verifier"
  fi
}

initialize_case() {
  local name="$1"
  CASE_ROOT="$TEST_ROOT/$name"
  OUTPUT_FILE="$CASE_ROOT/output.log"
  mkdir -p "$CASE_ROOT/state"
  : > "$CASE_ROOT/state/docker.calls"
  : > "$CASE_ROOT/state/curl.calls"
  : > "$CASE_ROOT/state/events"
}

run_all() {
  local database_url="$1"
  local backend_image="${2:-example.test/ipam-backend:sha}"
  set +e
  env \
    "PATH=$FIXTURE_BIN:$ORIGINAL_PATH" \
    "FAKE_STATE=$CASE_ROOT/state" \
    "FAKE_DOCKER_MODE=${FAKE_DOCKER_MODE:-success}" \
    "FAKE_CURL_MODE=${FAKE_CURL_MODE:-success}" \
    "FAKE_MYSQL_SERVICE_CONTAINER_ID=$SAFE_MYSQL_SERVICE_CONTAINER_ID" \
    "VERIFY_DEPLOYMENT_ATTEMPTS=3" \
    "VERIFY_DEPLOYMENT_INTERVAL_SECONDS=0" \
    "IPAM_BACKEND_IMAGE=$backend_image" \
    "IPAM_FRONTEND_IMAGE=example.test/ipam-frontend:sha" \
    "IPAM_COMBINED_IMAGE=example.test/ipam-combined:sha" \
    "TEST_DATABASE_URL=$database_url" \
    "MYSQL_SERVICE_CONTAINER_ID=${MYSQL_SERVICE_CONTAINER_ID-$SAFE_MYSQL_SERVICE_CONTAINER_ID}" \
    bash "$VERIFIER" all > "$OUTPUT_FILE" 2>&1
  LAST_STATUS=$?
  set -e
}

case_missing_docker_is_blocked() {
  # Given: a PATH that has dirname but no Docker command.
  initialize_case missing-docker
  mkdir -p "$CASE_ROOT/missing-bin"
  ln -s "$(command -v dirname)" "$CASE_ROOT/missing-bin/dirname"

  # When: all mode is invoked.
  set +e
  PATH="$CASE_ROOT/missing-bin" /bin/bash "$VERIFIER" all > "$OUTPUT_FILE" 2>&1
  LAST_STATUS=$?
  set -e

  # Then: the environment boundary returns exit 2.
  [[ "$LAST_STATUS" -eq 2 ]] || fail "missing Docker returned $LAST_STATUS"
  assert_contains "$OUTPUT_FILE" 'ENVIRONMENT_BLOCKED component=docker reason=command-unavailable'
}

case_missing_url_and_daemon_are_blocked() {
  # Given: fake Docker can distinguish missing URL from daemon failure.
  initialize_case blocked-environment

  # When/Then: each missing prerequisite returns exit 2.
  run_all ""
  [[ "$LAST_STATUS" -eq 2 ]] || fail "missing URL returned $LAST_STATUS"
  assert_contains "$OUTPUT_FILE" 'ENVIRONMENT_BLOCKED component=database reason=url-unavailable'

  run_all 'mysql://fixture:fixture-password@127.0.0.1:3306/ipam_production'
  [[ "$LAST_STATUS" -eq 2 ]] || fail "unsafe database URL returned $LAST_STATUS"
  assert_contains "$OUTPUT_FILE" 'ENVIRONMENT_BLOCKED component=database reason=unsafe-url'
  assert_secret_absent "$OUTPUT_FILE"

  FAKE_DOCKER_MODE=daemon-fail run_all "$SAFE_DATABASE_URL"
  [[ "$LAST_STATUS" -eq 2 ]] || fail "missing daemon returned $LAST_STATUS"
  assert_contains "$OUTPUT_FILE" 'ENVIRONMENT_BLOCKED component=docker reason=daemon-unavailable'
  assert_secret_absent "$OUTPUT_FILE"
}

case_mysql_service_target_is_validated_and_redacted() {
  initialize_case mysql-service-target

  MYSQL_SERVICE_CONTAINER_ID='' run_all "$SAFE_DATABASE_URL"
  [[ "$LAST_STATUS" -eq 2 ]] || fail "missing MySQL service target returned $LAST_STATUS"
  assert_contains "$OUTPUT_FILE" 'ENVIRONMENT_BLOCKED component=mysql-service reason=invalid-container-id'

  MYSQL_SERVICE_CONTAINER_ID='not-a-container-id' run_all "$SAFE_DATABASE_URL"
  [[ "$LAST_STATUS" -eq 2 ]] || fail "malformed MySQL service target returned $LAST_STATUS"
  assert_contains "$OUTPUT_FILE" 'ENVIRONMENT_BLOCKED component=mysql-service reason=invalid-container-id'

  FAKE_DOCKER_MODE=mysql-invalid-container run_all "$SAFE_DATABASE_URL"
  [[ "$LAST_STATUS" -eq 2 ]] || fail "wrong MySQL service target returned $LAST_STATUS"
  assert_contains "$OUTPUT_FILE" 'ENVIRONMENT_BLOCKED component=mysql-service reason=invalid-container'
  assert_secret_absent "$OUTPUT_FILE"
  if grep -Fq -- "$SAFE_MYSQL_SERVICE_CONTAINER_ID" "$OUTPUT_FILE"; then
    fail "MySQL service container ID leaked from verifier"
  fi
}

case_unsafe_image_is_rejected() {
  # Given: an image argument begins with an option prefix.
  initialize_case unsafe-image

  # When: all mode parses image references.
  run_all "$SAFE_DATABASE_URL" '--privileged'

  # Then: argument construction fails before docker run.
  [[ "$LAST_STATUS" -eq 2 ]] || fail "unsafe image returned $LAST_STATUS"
  assert_contains "$OUTPUT_FILE" 'ENVIRONMENT_BLOCKED component=image reason=invalid-reference'
  [[ ! -s "$CASE_ROOT/state/docker.calls" ]] || fail "unsafe image reached Docker"
  assert_secret_absent "$OUTPUT_FILE"
}

case_success_runs_every_contract_and_cleans() {
  # Given: Docker and every HTTP contract succeed.
  initialize_case success

  # When: the production all path runs.
  run_all "$SAFE_DATABASE_URL"

  # Then: all three images run on host networking and are removed.
  if [[ "$LAST_STATUS" -ne 0 ]]; then
    assert_secret_absent "$OUTPUT_FILE"
    while IFS= read -r line; do printf 'SAFE_VERIFIER_OUTPUT: %s\n' "$line" >&2; done < "$OUTPUT_FILE"
    fail "success path returned $LAST_STATUS"
  fi
  assert_contains "$OUTPUT_FILE" 'BACKEND_SMOKE_OK live=200 ready=200 migrations=applied'
  assert_contains "$OUTPUT_FILE" 'FRONTEND_SMOKE_OK page=200 bff=200'
  assert_contains "$OUTPUT_FILE" 'COMBINED_SMOKE_OK page=200 ready=200'
  assert_contains "$OUTPUT_FILE" 'ALL_OK'
  [[ "$(grep -c '^RUN ' "$CASE_ROOT/state/docker.calls")" -eq 3 ]] || fail "expected three docker runs"
  [[ "$(grep -c '^RM ' "$CASE_ROOT/state/docker.calls")" -eq 3 ]] || fail "expected three docker removals"
  [[ "$(grep -c '^STOP component=mysql-service$' "$CASE_ROOT/state/docker.calls")" -eq 1 ]] || fail "expected explicit MySQL service stop"
  [[ "$(grep -c 'network=host' "$CASE_ROOT/state/docker.calls")" -eq 3 ]] || fail "host networking missing"
  [[ "$(grep -c 'BOOTSTRAP_DISABLED=true' "$CASE_ROOT/state/docker.calls")" -eq 2 ]] || fail "bootstrap boundary missing"
  [[ "$(grep -c 'DATABASE_URL=<protected>' "$CASE_ROOT/state/docker.calls")" -eq 2 ]] || fail "database env-file boundary missing"
  [[ "$(grep -c 'API_PROXY_TARGET=http://127.0.0.1:' "$CASE_ROOT/state/docker.calls")" -eq 2 ]] || fail "BFF target boundary missing"
  grep -Fq '/api/health/live' "$CASE_ROOT/state/curl.calls" || fail "live probe missing"
  grep -Fq '/api/auth/status' "$CASE_ROOT/state/curl.calls" || fail "BFF probe missing"
  [[ -f "$CASE_ROOT/state/mysql.stopped" ]] || fail "MySQL service was not stopped"
  local stop_line backend_outage_live_line backend_outage_ready_line
  stop_line="$(grep -n '^STOP component=mysql-service$' "$CASE_ROOT/state/events" | cut -d: -f1)"
  backend_outage_live_line="$(grep -n 'CURL .*api/health/live' "$CASE_ROOT/state/events" | tail -n1 | cut -d: -f1)"
  backend_outage_ready_line="$(grep -n 'CURL .*api/health/ready' "$CASE_ROOT/state/events" | tail -n1 | cut -d: -f1)"
  [[ "$stop_line" -lt "$backend_outage_live_line" && "$backend_outage_live_line" -lt "$backend_outage_ready_line" ]] \
    || fail "outage probes did not follow MySQL stop"
  [[ -z "$(compgen -G "$CASE_ROOT/state/*.label" || true)" ]] || fail "success left containers"
  assert_secret_absent "$OUTPUT_FILE"
}

case_mysql_outage_keeps_backend_live_and_marks_ready_unavailable() {
  initialize_case mysql-outage
  FAKE_CURL_MODE=mysql-outage-transition run_all "$SAFE_DATABASE_URL"

  [[ "$LAST_STATUS" -eq 0 ]] || fail "MySQL outage scenario returned $LAST_STATUS"
  assert_contains "$OUTPUT_FILE" 'MYSQL_OUTAGE_SMOKE_OK live=200 ready=503'
  [[ "$(grep -c '^STOP component=mysql-service$' "$CASE_ROOT/state/docker.calls")" -eq 1 ]] || fail "MySQL was stopped incorrectly"
  [[ "$(grep -c '^RM ' "$CASE_ROOT/state/docker.calls")" -eq 3 ]] || fail "outage cleanup did not remove application containers"
  grep -Eq '^RUN .*backend' "$CASE_ROOT/state/events" || fail "backend did not start"
  grep -Eq '^RUN .*frontend' "$CASE_ROOT/state/events" || fail "frontend did not start"
  grep -Eq '^RUN .*combined' "$CASE_ROOT/state/events" || fail "combined did not start"
  grep -Eq '.*/api/health/live status=200$' "$CASE_ROOT/state/curl.calls" \
    || fail "outage live probe did not return 200"
  grep -Eq '.*/api/health/ready status=503$' "$CASE_ROOT/state/curl.calls" \
    || fail "outage ready probe did not return 503"
  local stop_line outage_live_line outage_ready_transition_line outage_ready_line
  stop_line="$(grep -n '^STOP component=mysql-service$' "$CASE_ROOT/state/events" | cut -d: -f1)"
  outage_live_line="$(grep -n '^CURL status=200 url=.*api/health/live$' "$CASE_ROOT/state/events" | tail -n1 | cut -d: -f1)"
  outage_ready_transition_line="$(grep -n '^CURL status=200 url=.*api/health/ready$' "$CASE_ROOT/state/events" | tail -n1 | cut -d: -f1)"
  outage_ready_line="$(grep -n '^CURL status=503 url=.*api/health/ready$' "$CASE_ROOT/state/events" | tail -n1 | cut -d: -f1)"
  [[ "$stop_line" -lt "$outage_live_line" && "$outage_live_line" -lt "$outage_ready_transition_line" \
    && "$outage_ready_transition_line" -lt "$outage_ready_line" ]] \
    || fail "outage statuses did not converge after MySQL stop"
  assert_secret_absent "$OUTPUT_FILE"
}

case_mysql_outage_readiness_failure_is_bounded_and_redacted() {
  # Given: readiness remains 200 after the MySQL service stops.
  initialize_case mysql-outage-readiness-failure

  # When: the exact-status outage assertion reaches its bounded limit.
  FAKE_CURL_MODE=mysql-outage-never-ready run_all "$SAFE_DATABASE_URL"

  # Then: exit 1, three post-stop readiness attempts, redacted diagnostics, and cleanup occur.
  [[ "$LAST_STATUS" -eq 1 ]] || fail "MySQL outage readiness failure returned $LAST_STATUS"
  [[ "$(grep -c '^CURL status=200 url=.*api/health/ready$' "$CASE_ROOT/state/events")" -eq 5 ]] \
    || fail "outage readiness retry count is unbounded"
  assert_contains "$OUTPUT_FILE" 'DEPLOYMENT_ERROR component=backend probe=ready expected=503'
  assert_contains "$OUTPUT_FILE" 'DATABASE_URL=***REDACTED*** AUTH_SECRET=***REDACTED***'
  [[ "$(grep -c '^RM ' "$CASE_ROOT/state/docker.calls")" -eq 3 ]] || fail "outage failure cleanup did not remove containers"
  assert_secret_absent "$OUTPUT_FILE"
}

case_probe_failure_is_bounded_redacted_and_cleaned() {
  # Given: every host HTTP probe returns 503.
  initialize_case probe-failure

  # When: backend live readiness reaches its bounded limit.
  FAKE_CURL_MODE=fail run_all "$SAFE_DATABASE_URL"

  # Then: exit 1, three attempts, redacted diagnostics, and exact cleanup occur.
  [[ "$LAST_STATUS" -eq 1 ]] || fail "probe failure returned $LAST_STATUS"
  [[ "$(wc -l < "$CASE_ROOT/state/curl.calls")" -eq 3 ]] || fail "probe retry count is unbounded"
  assert_contains "$OUTPUT_FILE" 'DEPLOYMENT_ERROR component=backend probe=live expected=200'
  assert_contains "$OUTPUT_FILE" 'DATABASE_URL=***REDACTED*** AUTH_SECRET=***REDACTED***'
  [[ "$(grep -c '^RM ' "$CASE_ROOT/state/docker.calls")" -eq 1 ]] || fail "failed backend was not removed"
  assert_secret_absent "$OUTPUT_FILE"
}

case_signal_cleans_active_container() {
  # Given: a backend probe remains active long enough to deliver TERM.
  initialize_case signal

  # When: the verifier receives TERM after starting its first container.
  env \
    "PATH=$FIXTURE_BIN:$ORIGINAL_PATH" \
    "FAKE_STATE=$CASE_ROOT/state" \
    "FAKE_CURL_MODE=block" \
    "FAKE_MYSQL_SERVICE_CONTAINER_ID=$SAFE_MYSQL_SERVICE_CONTAINER_ID" \
    "VERIFY_DEPLOYMENT_ATTEMPTS=3" \
    "VERIFY_DEPLOYMENT_INTERVAL_SECONDS=0" \
    "IPAM_BACKEND_IMAGE=example.test/ipam-backend:sha" \
    "IPAM_FRONTEND_IMAGE=example.test/ipam-frontend:sha" \
    "IPAM_COMBINED_IMAGE=example.test/ipam-combined:sha" \
    "TEST_DATABASE_URL=$SAFE_DATABASE_URL" \
    "MYSQL_SERVICE_CONTAINER_ID=$SAFE_MYSQL_SERVICE_CONTAINER_ID" \
    bash "$VERIFIER" all > "$OUTPUT_FILE" 2>&1 &
  verifier_pid=$!
  for _ in {1..100}; do
    [[ -f "$CASE_ROOT/state/curl.blocked" ]] && break
    /bin/sleep 0.01
  done
  [[ -f "$CASE_ROOT/state/curl.blocked" ]] || fail "signal case never reached probe"
  kill -TERM "$verifier_pid"
  set +e
  wait "$verifier_pid"
  LAST_STATUS=$?
  set -e

  # Then: signal status is preserved and the labeled container is removed.
  [[ "$LAST_STATUS" -eq 143 ]] || fail "TERM returned $LAST_STATUS"
  [[ "$(grep -c '^RM ' "$CASE_ROOT/state/docker.calls")" -eq 1 ]] || fail "TERM did not clean container"
  [[ -z "$(compgen -G "$CASE_ROOT/state/*.label" || true)" ]] || fail "TERM left containers"
  assert_secret_absent "$OUTPUT_FILE"
}

case_cleanup_failures_are_distinct() {
  local mode expected
  for mode in inspect-fail label-mismatch rm-fail; do
    initialize_case "cleanup-$mode"
    FAKE_DOCKER_MODE="$mode" run_all "$SAFE_DATABASE_URL"
    [[ "$LAST_STATUS" -eq 1 ]] || fail "$mode cleanup returned $LAST_STATUS"
    case "$mode" in
      inspect-fail) expected='CLEANUP_ERROR component=container reason=inspect-failed' ;;
      label-mismatch) expected='CLEANUP_ERROR component=container reason=label-mismatch' ;;
      rm-fail) expected='CLEANUP_ERROR component=container reason=remove-failed' ;;
    esac
    assert_contains "$OUTPUT_FILE" "$expected"
    assert_secret_absent "$OUTPUT_FILE"
  done
}

case_missing_docker_is_blocked
case_missing_url_and_daemon_are_blocked
case_mysql_service_target_is_validated_and_redacted
case_unsafe_image_is_rejected
case_success_runs_every_contract_and_cleans
case_mysql_outage_keeps_backend_live_and_marks_ready_unavailable
case_mysql_outage_readiness_failure_is_bounded_and_redacted
case_probe_failure_is_bounded_redacted_and_cleaned
case_signal_cleans_active_container
case_cleanup_failures_are_distinct
printf 'DEPLOYMENT_ALL_TESTS_OK cases=10\n'
