#!/usr/bin/env bash
set -euo pipefail

umask 077

USERCONFIG_PATH=''

fail() {
  printf 'PRIVATE_NPM_INSTALL_FAILED reason=%s\n' "$1" >&2
  exit 2
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [[ -n "$USERCONFIG_PATH" ]]; then
    rm -f -- "$USERCONFIG_PATH"
  fi
  exit "$status"
}

main() {
  local working_directory="${1:-}"
  local heroui_token="${HEROUI_AUTH_TOKEN:-}"

  [[ "$#" -eq 1 ]] || fail 'usage'
  [[ -d "$working_directory" ]] || fail 'working-directory-invalid'
  [[ -n "$heroui_token" ]] || fail 'heroui-auth-token-unset'
  command -v mktemp >/dev/null 2>&1 || fail 'command-unavailable-mktemp'
  command -v npm >/dev/null 2>&1 || fail 'command-unavailable-npm'
  command -v rm >/dev/null 2>&1 || fail 'command-unavailable-rm'

  unset HEROUI_AUTH_TOKEN NPM_CONFIG_USERCONFIG
  export -n heroui_token 2>/dev/null || true
  USERCONFIG_PATH="$(mktemp "${TMPDIR:-/tmp}/ipam-npm-userconfig.XXXXXX")"
  chmod 0600 "$USERCONFIG_PATH"
  trap cleanup EXIT INT TERM HUP

  (
    cd -- "$working_directory"
    env \
      "HEROUI_AUTH_TOKEN=$heroui_token" \
      "NPM_CONFIG_USERCONFIG=$USERCONFIG_PATH" \
      npm ci
  )
  printf 'PRIVATE_NPM_INSTALL_OK\n'
}

main "$@"
