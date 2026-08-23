#!/usr/bin/env bash
set -euo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly INSTALL_SCRIPT="$SCRIPT_DIR/npm-ci-private.sh"
readonly TOKEN_SENTINEL='fixture-token-not-a-credential'
TEST_TMPDIR=''

fail() {
  printf 'PRIVATE_NPM_INSTALL_TEST_FAILED reason=%s\n' "$1" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  [[ -z "$TEST_TMPDIR" || ! -d "$TEST_TMPDIR" ]] || rm -rf -- "$TEST_TMPDIR"
  exit "$status"
}

write_fake_npm() {
  cat >"$TEST_TMPDIR/bin/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
set -euo pipefail

state="${FAKE_NPM_STATE:?}"
[[ "$#" -eq 1 && "$1" == ci ]] || exit 91
[[ -n "${NPM_CONFIG_USERCONFIG:-}" && -f "$NPM_CONFIG_USERCONFIG" ]] || exit 92
[[ -n "${HEROUI_AUTH_TOKEN:-}" ]] || exit 93
printf '%s\n' "$NPM_CONFIG_USERCONFIG" >"$state/userconfig-path"
stat -c '%a' "$NPM_CONFIG_USERCONFIG" >"$state/userconfig-mode"
wc -c <"$NPM_CONFIG_USERCONFIG" >"$state/userconfig-bytes"
printf '%s\n' "$PWD" >"$state/working-directory"
printf '%s\n' "$HEROUI_AUTH_TOKEN" >"$state/token-seen"
if [[ "${FAKE_NPM_MODE:-success}" == fail ]]; then exit 7; fi
FAKE_NPM
  chmod 0755 "$TEST_TMPDIR/bin/npm"
}

run_case() {
  local mode="$1"
  local expected_status="$2"
  local output="$TEST_TMPDIR/$mode.log"
  local status userconfig_path

  rm -f "$TEST_TMPDIR/state"/*
  set +e
  PATH="$TEST_TMPDIR/bin:$PATH" \
    FAKE_NPM_MODE="$mode" \
    FAKE_NPM_STATE="$TEST_TMPDIR/state" \
    HEROUI_AUTH_TOKEN="$TOKEN_SENTINEL" \
    NPM_CONFIG_USERCONFIG="$TEST_TMPDIR/ambient-userconfig" \
    bash "$INSTALL_SCRIPT" "$TEST_TMPDIR/project" >"$output" 2>&1
  status=$?
  set -e

  [[ "$status" -eq "$expected_status" ]] || fail "$mode-status-$status"
  userconfig_path="$(<"$TEST_TMPDIR/state/userconfig-path")"
  [[ ! -e "$userconfig_path" ]] || fail "$mode-userconfig-not-removed"
  [[ "$(<"$TEST_TMPDIR/state/userconfig-mode")" == 600 ]] || fail "$mode-userconfig-mode"
  [[ "$(<"$TEST_TMPDIR/state/userconfig-bytes")" -eq 0 ]] || fail "$mode-userconfig-not-empty"
  [[ "$(<"$TEST_TMPDIR/state/working-directory")" == "$TEST_TMPDIR/project" ]] \
    || fail "$mode-working-directory"
  [[ "$(<"$TEST_TMPDIR/state/token-seen")" == "$TOKEN_SENTINEL" ]] || fail "$mode-token-missing"
  if grep -Rq --exclude='token-seen' -- "$TOKEN_SENTINEL" "$TEST_TMPDIR"; then
    grep -Rl --exclude='token-seen' -- "$TOKEN_SENTINEL" "$TEST_TMPDIR" >&2
    fail "$mode-token-persisted"
  fi
}

main() {
  TEST_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/private-npm-install-test.XXXXXX")"
  trap cleanup EXIT INT TERM
  mkdir -p "$TEST_TMPDIR/bin" "$TEST_TMPDIR/project" "$TEST_TMPDIR/state"
  write_fake_npm
  run_case success 0
  run_case fail 7
  printf 'PRIVATE_NPM_INSTALL_TESTS_OK\n'
}

main "$@"
