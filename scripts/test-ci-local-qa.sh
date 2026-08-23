#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly CI_LOCAL_SCRIPT="$SCRIPT_DIR/ci-local.sh"

fail() {
  printf 'CI_LOCAL_QA_TEST_FAILED code=%s\n' "$1" >&2
  exit 1
}

assert_status() {
  local expected="$1"
  shift
  local output
  local status

  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  [[ "$status" -eq "$expected" ]] || fail "unexpected-status-$status-expected-$expected"
  printf '%s' "$output"
}

environment_value() {
  local pid="$1"
  local expected_name="$2"
  local entry

  while IFS= read -r -d '' entry; do
    if [[ "${entry%%=*}" == "$expected_name" ]]; then
      printf '%s' "${entry#*=}"
      return 0
    fi
  done <"/proc/$pid/environ"
  return 1
}

assert_group_excludes() {
  local group_id="$1"
  shift
  local pid
  local process_group
  local entry
  local name
  local forbidden

  while read -r pid process_group; do
    [[ "$process_group" == "$group_id" && -r "/proc/$pid/environ" ]] || continue
    while IFS= read -r -d '' entry; do
      name="${entry%%=*}"
      for forbidden in "$@"; do
        [[ "$name" != "$forbidden" ]] || fail "forbidden-environment-$name"
      done
    done <"/proc/$pid/environ"
  done < <(ps -eo pid=,pgid=)
}

missing_output="$(assert_status 2 env -u HEROUI_AUTH_TOKEN -u TEST_DATABASE_URL bash "$CI_LOCAL_SCRIPT" --serve-qa)"
[[ "$missing_output" == *'ENVIRONMENT_BLOCKED component=ci-local reason=heroui-auth-token-unset'* ]] || fail 'missing-heroui-contract'

missing_database_output="$(assert_status 2 env -u TEST_DATABASE_URL HEROUI_AUTH_TOKEN=test-only-placeholder bash "$CI_LOCAL_SCRIPT" --serve-qa)"
[[ "$missing_database_output" == *'ENVIRONMENT_BLOCKED component=ci-local reason=test-database-url-unset'* ]] || fail 'missing-database-contract'

invalid_output="$(assert_status 2 bash "$CI_LOCAL_SCRIPT" --cleanup-qa '../invalid')"
[[ "$invalid_output" == *'CI_LOCAL_FAILED code=invalid-qa-cleanup-token'* ]] || fail 'invalid-token-contract'

unknown_output="$(assert_status 2 bash "$CI_LOCAL_SCRIPT" --unknown-mode)"
[[ "$unknown_output" == *'Usage:'* && "$unknown_output" == *'--serve-qa'* && "$unknown_output" == *'--cleanup-qa <token>'* ]] || fail 'unknown-mode-usage-contract'

serve_args_output="$(assert_status 2 bash "$CI_LOCAL_SCRIPT" --serve-qa unexpected)"
[[ "$serve_args_output" == *'Usage:'* ]] || fail 'serve-args-usage-contract'

cleanup_args_output="$(assert_status 2 bash "$CI_LOCAL_SCRIPT" --cleanup-qa)"
[[ "$cleanup_args_output" == *'Usage:'* ]] || fail 'cleanup-args-usage-contract'

# shellcheck disable=SC2016
assert_status 0 bash -c '
  set -u
  source "$1"
  unset QA_HEROUI_AUTH_TOKEN QA_BOOTSTRAP_TOKEN
  qa_assert_ephemeral_secrets_cleared
' _ "$CI_LOCAL_SCRIPT" >/dev/null

# shellcheck disable=SC2016
secret_lifetime_output="$(assert_status 1 bash -c '
  source "$1"
  QA_HEROUI_AUTH_TOKEN=still-present
  unset QA_BOOTSTRAP_TOKEN
  qa_assert_ephemeral_secrets_cleared
' _ "$CI_LOCAL_SCRIPT")"
[[ "$secret_lifetime_output" == *'CI_LOCAL_FAILED code=qa-secret-lifetime'* ]] || fail 'secret-lifetime-contract'

cleanup_token="$(openssl rand -hex 32)"
assert_status 0 bash "$CI_LOCAL_SCRIPT" --cleanup-qa "$cleanup_token" >/dev/null
assert_status 0 bash "$CI_LOCAL_SCRIPT" --cleanup-qa "$cleanup_token" >/dev/null

test_root="$(mktemp -d "${TMPDIR:-/tmp}/ipam-ci-local-qa-test.XXXXXX")"
chmod 700 "$test_root"
pid_record="$test_root/process.pid"
state_record="$test_root/state.path"

set +e
CI_LOCAL_QA_TEST_PID_RECORD="$pid_record" \
CI_LOCAL_QA_TEST_STATE_RECORD="$state_record" \
CI_LOCAL_QA_TEST_TOKEN="$(openssl rand -hex 32)" \
bash -c '
  set -euo pipefail
  source "$1"
  qa_create_state "$CI_LOCAL_QA_TEST_TOKEN"
  printf "%s\n" "$QA_STATE_DIR" >"$CI_LOCAL_QA_TEST_STATE_RECORD"
  qa_start_process test "$QA_STATE_DIR/test.log" "$ROOT_DIR" test sleep 60
  cp "$QA_STATE_DIR/test.pid" "$CI_LOCAL_QA_TEST_PID_RECORD"
  exit 19
' _ "$CI_LOCAL_SCRIPT" >/dev/null 2>&1
partial_status=$?
set -e

[[ "$partial_status" -eq 19 ]] || fail 'partial-start-status'
partial_pid="$(<"$pid_record")"
partial_state="$(<"$state_record")"
[[ ! -d "$partial_state" ]] || fail 'partial-state-remains'
if kill -0 "$partial_pid" 2>/dev/null; then
  fail 'partial-process-remains'
fi

environment_state_record="$test_root/environment-state.path"
backend_app_pid_record="$test_root/backend-app.pid"
backend_ready="$test_root/backend.ready"
frontend_app_pid_record="$test_root/frontend-app.pid"
frontend_ready="$test_root/frontend.ready"

CI_LOCAL_QA_TEST_STATE_RECORD="$environment_state_record" \
CI_LOCAL_QA_TEST_TOKEN="$(openssl rand -hex 32)" \
CI_LOCAL_QA_TEST_BACKEND_PID_RECORD="$backend_app_pid_record" \
CI_LOCAL_QA_TEST_BACKEND_READY="$backend_ready" \
CI_LOCAL_QA_TEST_FRONTEND_PID_RECORD="$frontend_app_pid_record" \
CI_LOCAL_QA_TEST_FRONTEND_READY="$frontend_ready" \
bash -c '
  set -euo pipefail
  source "$1"
  qa_create_state "$CI_LOCAL_QA_TEST_TOKEN"
  printf "%s\n" "$QA_STATE_DIR" >"$CI_LOCAL_QA_TEST_STATE_RECORD"

  export HEROUI_AUTH_TOKEN=forbidden-heroui
  export TEST_DATABASE_URL=forbidden-test-database
  export QA_HEROUI_AUTH_TOKEN=forbidden-internal-heroui
  export QA_DATABASE_URL=forbidden-internal-database
  export QA_AUTH_SECRET=forbidden-internal-auth
  export QA_BOOTSTRAP_TOKEN=forbidden-bootstrap
  export QA_USERNAME=forbidden-username
  export QA_PASSWORD=forbidden-password
  export BOOTSTRAP_TOKEN=forbidden-bootstrap-env
  export BOOTSTRAP_ADMIN_USERNAME=forbidden-bootstrap-username
  export BOOTSTRAP_ADMIN_PASSWORD=forbidden-bootstrap-password
  export REDACT_HEROUI_AUTH_TOKEN=forbidden-redactor-heroui
  export REDACT_BOOTSTRAP_TOKEN=forbidden-redactor-bootstrap
  export REDACT_QA_USERNAME=forbidden-redactor-username
  export REDACT_QA_PASSWORD=forbidden-redactor-password

  DATABASE_URL=mysql://qa-user:qa-password@127.0.0.1:3306/ipam_probe_test \
  CORS_ORIGINS=http://127.0.0.1:43101 \
  AUTH_SECRET=backend-auth-secret-32-characters-minimum \
  BOOTSTRAP_DISABLED=true \
  HOST=127.0.0.1 \
  PORT=43100 \
  NODE_ENV=production \
  REDACT_DATABASE_URL=mysql://qa-user:qa-password@127.0.0.1:3306/ipam_probe_test \
  REDACT_AUTH_SECRET=backend-auth-secret-32-characters-minimum \
    qa_start_process backend "$QA_STATE_DIR/backend.log" "$ROOT_DIR" backend \
      bash -c '\''printf "%s\n" "$BASHPID" >"$1"; printf ready >"$2"; exec sleep 60'\'' \
      _ "$CI_LOCAL_QA_TEST_BACKEND_PID_RECORD" "$CI_LOCAL_QA_TEST_BACKEND_READY"

  APP_ORIGIN=http://127.0.0.1:43101 \
  API_PROXY_TARGET=http://127.0.0.1:43100 \
    qa_start_process frontend "$QA_STATE_DIR/frontend.log" "$ROOT_DIR" frontend \
      bash -c '\''printf "%s\n" "$BASHPID" >"$1"; printf ready >"$2"; exec sleep 60'\'' \
      _ "$CI_LOCAL_QA_TEST_FRONTEND_PID_RECORD" "$CI_LOCAL_QA_TEST_FRONTEND_READY"

  wait_for_file() {
    local path="$1"
    local attempt
    for attempt in {1..100}; do
      [[ -s "$path" ]] && return 0
      sleep 0.02
    done
    return 1
  }
  wait_for_file "$CI_LOCAL_QA_TEST_BACKEND_READY"
  wait_for_file "$CI_LOCAL_QA_TEST_FRONTEND_READY"
  QA_KEEP_STATE=1
' _ "$CI_LOCAL_SCRIPT" >/dev/null 2>&1

environment_state="$(<"$environment_state_record")"
backend_group="$(<"$environment_state/backend.pid")"
frontend_group="$(<"$environment_state/frontend.pid")"
backend_app_pid="$(<"$backend_app_pid_record")"
frontend_app_pid="$(<"$frontend_app_pid_record")"

common_forbidden=(
  HEROUI_AUTH_TOKEN TEST_DATABASE_URL QA_HEROUI_AUTH_TOKEN QA_DATABASE_URL
  QA_AUTH_SECRET QA_BOOTSTRAP_TOKEN QA_USERNAME QA_PASSWORD
  BOOTSTRAP_TOKEN BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_PASSWORD
  REDACT_HEROUI_AUTH_TOKEN REDACT_BOOTSTRAP_TOKEN REDACT_QA_USERNAME REDACT_QA_PASSWORD
)
assert_group_excludes "$backend_group" "${common_forbidden[@]}"
assert_group_excludes "$frontend_group" "${common_forbidden[@]}" \
  DATABASE_URL CORS_ORIGINS AUTH_SECRET BOOTSTRAP_DISABLED HOST \
  REDACT_DATABASE_URL REDACT_AUTH_SECRET

[[ "$(environment_value "$backend_app_pid" DATABASE_URL)" == 'mysql://qa-user:qa-password@127.0.0.1:3306/ipam_probe_test' ]] || fail 'backend-database-environment'
[[ "$(environment_value "$backend_app_pid" CORS_ORIGINS)" == 'http://127.0.0.1:43101' ]] || fail 'backend-cors-environment'
[[ "$(environment_value "$backend_app_pid" AUTH_SECRET)" == 'backend-auth-secret-32-characters-minimum' ]] || fail 'backend-auth-environment'
[[ "$(environment_value "$backend_app_pid" BOOTSTRAP_DISABLED)" == true ]] || fail 'backend-bootstrap-environment'
[[ "$(environment_value "$backend_app_pid" HOST)" == '127.0.0.1' ]] || fail 'backend-host-environment'
[[ "$(environment_value "$backend_app_pid" PORT)" == 43100 ]] || fail 'backend-port-environment'
[[ "$(environment_value "$backend_app_pid" NODE_ENV)" == production ]] || fail 'backend-node-environment'
[[ "$(environment_value "$frontend_app_pid" APP_ORIGIN)" == 'http://127.0.0.1:43101' ]] || fail 'frontend-origin-environment'
[[ "$(environment_value "$frontend_app_pid" API_PROXY_TARGET)" == 'http://127.0.0.1:43100' ]] || fail 'frontend-proxy-environment'

bash -c 'source "$1"; qa_cleanup_state_dir "$2"' _ "$CI_LOCAL_SCRIPT" "$environment_state" >/dev/null 2>&1
[[ ! -d "$environment_state" ]] || fail 'environment-state-remains'

# --- Install/build child environment boundary -------------------------------
#
# The runtime probe above only covers processes started through qa_start_process.
# Install, generate, build, and test steps run through qa_run_logged instead, so
# they need their own proof. Each step is driven with a fake `npm` that spawns a
# real child and dumps that child's environment, which is exactly what the real
# npm would have inherited.

install_probe_root="$(mktemp -d "${TMPDIR:-/tmp}/ipam-ci-local-qa-install.XXXXXX")"
chmod 700 "$install_probe_root"
install_state_record="$install_probe_root/state.path"

CI_LOCAL_QA_TEST_STATE_RECORD="$install_state_record" \
CI_LOCAL_QA_TEST_TOKEN="$(openssl rand -hex 32)" \
CI_LOCAL_QA_TEST_CAPTURE_DIR="$install_probe_root" \
bash -c '
  set -euo pipefail
  source "$1"
  qa_create_state "$CI_LOCAL_QA_TEST_TOKEN"
  printf "%s\n" "$QA_STATE_DIR" >"$CI_LOCAL_QA_TEST_STATE_RECORD"

  QA_BACKEND_RUNTIME_DIR="$QA_STATE_DIR/backend-runtime"
  QA_FRONTEND_RUNTIME_DIR="$QA_STATE_DIR/frontend-runtime"

  # Ambient pollution the boundary must absorb: exported before capture, exactly
  # as a careless caller or a leaked parent shell would leave them. Nothing
  # downstream may inherit them.
  export HEROUI_AUTH_TOKEN=ambient-heroui
  export TEST_DATABASE_URL=ambient-test-database
  export DATABASE_URL=ambient-database
  export AUTH_SECRET=ambient-auth
  export BOOTSTRAP_TOKEN=ambient-bootstrap
  export BOOTSTRAP_ADMIN_USERNAME=ambient-bootstrap-username
  export BOOTSTRAP_ADMIN_PASSWORD=ambient-bootstrap-password

  # Drive the REAL capture path. Replicating it here would let a regression in
  # ci-local.sh pass unnoticed, which is precisely how this defect escaped.
  qa_capture_secrets

  # qa_prepare_database unsets QA_BOOTSTRAP_TOKEN once bootstrap completes, so
  # stash it now for the post-run assertion.
  CI_LOCAL_QA_TEST_BOOTSTRAP_TOKEN="$QA_BOOTSTRAP_TOKEN"

  # Fake npm: derives its capture name from cwd plus argv, so the probe can call
  # the REAL qa_install_and_build / qa_prepare_database instead of restating the
  # command wiring. A regression that re-adds a secret to any step is therefore
  # caught, which a hand-copied command list would miss.
  npm() {
    local capture_name

    case "$PWD::$*" in
      "$QA_BACKEND_RUNTIME_DIR::ci") capture_name=backend-npm-ci ;;
      "$QA_FRONTEND_RUNTIME_DIR::ci") capture_name=frontend-npm-ci ;;
      *"::run db:generate") capture_name=backend-db-generate ;;
      *"::run build") capture_name=backend-build ;;
      *"::run db:deploy") capture_name=database-migrate ;;
      *"::run auth:bootstrap") capture_name=operator-bootstrap ;;
      *"::test --"*) capture_name=frontend-cookie-test ;;
      *) printf "unexpected-npm-invocation %s\n" "$PWD::$*" >&2; return 1 ;;
    esac
    command env >"$CI_LOCAL_QA_TEST_CAPTURE_DIR/$capture_name.env"
  }

  # Stub only the pieces that need real infrastructure: filesystem copies and the
  # live database connection. Every secret-carrying code path stays real.
  qa_copy_backend_runtime() { mkdir -m 700 -p -- "$QA_BACKEND_RUNTIME_DIR"; }
  qa_copy_frontend_runtime() { mkdir -m 700 -p -- "$QA_FRONTEND_RUNTIME_DIR"; }
  qa_validate_database() { printf "QA_DATABASE_FRESH_OK\n"; }

  qa_install_and_build
  qa_prepare_database

  # Publish the generated secret values so the assertions below can prove the
  # bootstrap step received exactly what qa_capture_secrets minted. Double quotes
  # are required here: this block lives inside a single-quoted bash -c script.
  {
    printf "QA_AUTH_SECRET=%s\n" "$QA_AUTH_SECRET"
    printf "QA_USERNAME=%s\n" "$QA_USERNAME"
    printf "QA_PASSWORD=%s\n" "$QA_PASSWORD"
    printf "QA_BOOTSTRAP_TOKEN=%s\n" "$CI_LOCAL_QA_TEST_BOOTSTRAP_TOKEN"
  } >"$CI_LOCAL_QA_TEST_CAPTURE_DIR/generated.env"

  QA_KEEP_STATE=1
' _ "$CI_LOCAL_SCRIPT" >/dev/null 2>&1 || fail 'install-probe-execution'

install_state="$(<"$install_state_record")"

generated_value() {
  local name="$1"
  local line

  while IFS= read -r line; do
    if [[ "${line%%=*}" == "$name" ]]; then
      printf '%s' "${line#*=}"
      return 0
    fi
  done <"$install_probe_root/generated.env"
  fail "missing-generated-$name"
}

generated_auth_secret="$(generated_value QA_AUTH_SECRET)"
generated_username="$(generated_value QA_USERNAME)"
generated_password="$(generated_value QA_PASSWORD)"
generated_bootstrap_token="$(generated_value QA_BOOTSTRAP_TOKEN)"
[[ -n "$generated_auth_secret" && -n "$generated_username" ]] || fail 'install-probe-secret-generation'

capture_has() {
  local capture="$install_probe_root/$1.env"
  local name="$2"

  [[ -r "$capture" ]] || fail "missing-capture-$1"
  grep -q "^$name=" -- "$capture"
}

assert_capture_excludes() {
  local capture_name="$1"
  shift
  local forbidden

  for forbidden in "$@"; do
    if capture_has "$capture_name" "$forbidden"; then
      fail "install-secret-leak-$capture_name-$forbidden"
    fi
  done
}

assert_capture_value() {
  local capture="$install_probe_root/$1.env"
  local name="$2"
  local expected="$3"

  [[ -r "$capture" ]] || fail "missing-capture-$1"
  grep -qx -- "$name=$expected" "$capture" || fail "install-missing-required-$1-$name"
}

# Every QA secret plus every ambient alias. No install/build/test child may see
# any of these; the frontend install is allowed exactly one exception below.
install_forbidden=(
  QA_HEROUI_AUTH_TOKEN QA_DATABASE_URL QA_AUTH_SECRET QA_BOOTSTRAP_TOKEN
  QA_USERNAME QA_PASSWORD
  HEROUI_AUTH_TOKEN TEST_DATABASE_URL DATABASE_URL AUTH_SECRET
  BOOTSTRAP_TOKEN BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_PASSWORD
  REDACT_HEROUI_AUTH_TOKEN REDACT_DATABASE_URL REDACT_AUTH_SECRET
  REDACT_BOOTSTRAP_TOKEN REDACT_QA_USERNAME REDACT_QA_PASSWORD
)

assert_capture_excludes backend-npm-ci "${install_forbidden[@]}"
assert_capture_excludes backend-db-generate "${install_forbidden[@]}"
assert_capture_excludes backend-build "${install_forbidden[@]}"
assert_capture_excludes frontend-cookie-test "${install_forbidden[@]}"

# The frontend install is the sole authenticated fetch, so it may see its HeroUI
# token and nothing else.
frontend_install_forbidden=()
for forbidden_name in "${install_forbidden[@]}"; do
  [[ "$forbidden_name" == HEROUI_AUTH_TOKEN ]] && continue
  frontend_install_forbidden+=("$forbidden_name")
done
assert_capture_excludes frontend-npm-ci "${frontend_install_forbidden[@]}"
assert_capture_value frontend-npm-ci HEROUI_AUTH_TOKEN ambient-heroui

# Positive control: scoping must not have broken the steps that need a value.
assert_capture_value database-migrate DATABASE_URL ambient-test-database
assert_capture_value operator-bootstrap DATABASE_URL ambient-test-database
assert_capture_value operator-bootstrap AUTH_SECRET "$generated_auth_secret"
assert_capture_value operator-bootstrap BOOTSTRAP_TOKEN "$generated_bootstrap_token"
assert_capture_value operator-bootstrap BOOTSTRAP_ADMIN_USERNAME "$generated_username"
assert_capture_value operator-bootstrap BOOTSTRAP_ADMIN_PASSWORD "$generated_password"
assert_capture_value operator-bootstrap BOOTSTRAP_DISABLED false

# The migrate step needs the database URL and nothing else.
assert_capture_excludes database-migrate \
  QA_HEROUI_AUTH_TOKEN QA_DATABASE_URL QA_AUTH_SECRET QA_BOOTSTRAP_TOKEN \
  QA_USERNAME QA_PASSWORD HEROUI_AUTH_TOKEN AUTH_SECRET BOOTSTRAP_TOKEN \
  BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_PASSWORD

# Guard the guard: a secret left exported must be rejected.
# shellcheck disable=SC2016
exported_secret_output="$(assert_status 1 bash -c '
  source "$1"
  export QA_DATABASE_URL=leaked
  qa_assert_secrets_unexported
' _ "$CI_LOCAL_SCRIPT")"
[[ "$exported_secret_output" == *'CI_LOCAL_FAILED code=qa-secret-exported'* ]] || fail 'exported-secret-contract'

# shellcheck disable=SC2016
assert_status 0 bash -c '
  source "$1"
  QA_DATABASE_URL=scoped
  QA_AUTH_SECRET=scoped
  export -n QA_DATABASE_URL QA_AUTH_SECRET 2>/dev/null || true
  qa_assert_secrets_unexported
' _ "$CI_LOCAL_SCRIPT" >/dev/null

bash -c 'source "$1"; qa_cleanup_state_dir "$2"' _ "$CI_LOCAL_SCRIPT" "$install_state" >/dev/null 2>&1
[[ ! -d "$install_state" ]] || fail 'install-state-remains'
rm -rf -- "$install_probe_root"

rm -rf -- "$test_root"
printf 'CI_LOCAL_QA_SHELL_TESTS_OK\n'
