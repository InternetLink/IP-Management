#!/usr/bin/env bash
set -euo pipefail

umask 077

# Usage:
#   APP_ORIGIN=http://localhost:3003 \
#   BFF_BASE_URL=http://localhost:3003 \
#   BACKEND_BASE_URL=http://127.0.0.1:3001 \
#   AUTH_USERNAME=admin AUTH_PASSWORD='password' \
#   bash scripts/auth-boundary-driver.sh
#
# APP_ORIGIN is the exact origin configured in the BFF allowlist. BFF_BASE_URL
# and BACKEND_BASE_URL select the live processes under test.

readonly APP_ORIGIN="${APP_ORIGIN:-http://localhost:3003}"
readonly BFF_BASE_URL="${BFF_BASE_URL:-http://localhost:3003}"
readonly BACKEND_BASE_URL="${BACKEND_BASE_URL:-http://127.0.0.1:3001}"
readonly FOREIGN_ORIGIN="${FOREIGN_ORIGIN:-https://foreign.example}"
readonly REQUEST_TIMEOUT_SECONDS="${REQUEST_TIMEOUT_SECONDS:-10}"
readonly AUTH_USERNAME="${AUTH_USERNAME:-}"
readonly AUTH_PASSWORD="${AUTH_PASSWORD:-}"

TEMP_ROOT=""
LOGIN_BODY=""
COOKIE_JAR=""
CSRF_TOKEN=""
SESSION_TOKEN=""
SETUP_STATUS="000"
FAILED=0

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "${TEMP_ROOT:-}" && -d "$TEMP_ROOT" ]]; then
    rm -rf -- "$TEMP_ROOT"
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM

report() {
  local name="$1"
  local status="$2"
  local expected="$3"
  local result="FAIL"
  if [[ "$status" == "$expected" ]]; then
    result="PASS"
  else
    FAILED=1
  fi
  printf '%s %s %s\n' "$name" "$status" "$result"
}

configuration_failure() {
  printf 'configuration 000 FAIL\n'
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || configuration_failure
}

curl_status() {
  local status
  status="$(curl \
    --silent \
    --max-time "$REQUEST_TIMEOUT_SECONDS" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$@" || true)"
  if [[ ! "$status" =~ ^[0-9]{3}$ ]]; then
    status="000"
  fi
  printf '%s' "$status"
}

extract_cookie() {
  local expected_name="$1"
  local jar="$2"
  local domain include_subdomains path secure expires name value

  while IFS=$'\t' read -r domain include_subdomains path secure expires name value; do
    if [[ "$name" == "$expected_name" && -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done < "$jar"
  return 1
}

prepare_case() {
  local name="$1"
  local csrf

  COOKIE_JAR="$TEMP_ROOT/${name}.cookies"
  : > "$COOKIE_JAR"

  SETUP_STATUS="$(curl_status \
    --request GET \
    --cookie "$COOKIE_JAR" \
    --cookie-jar "$COOKIE_JAR" \
    "$BFF_BASE_URL/api/auth/login")"
  if [[ "$SETUP_STATUS" != "204" ]]; then
    return 1
  fi
  if ! csrf="$(extract_cookie ipam_csrf "$COOKIE_JAR")"; then
    SETUP_STATUS="000"
    return 1
  fi

  SETUP_STATUS="$(curl_status \
    --request POST \
    --cookie "$COOKIE_JAR" \
    --cookie-jar "$COOKIE_JAR" \
    --header 'Accept: application/json' \
    --header 'Content-Type: application/json' \
    --header "Origin: $APP_ORIGIN" \
    --header "X-CSRF-Token: $csrf" \
    --data-binary "@$LOGIN_BODY" \
    "$BFF_BASE_URL/api/auth/login")"
  if [[ "$SETUP_STATUS" != "200" ]]; then
    return 1
  fi
  if ! CSRF_TOKEN="$(extract_cookie ipam_csrf "$COOKIE_JAR")"; then
    SETUP_STATUS="000"
    return 1
  fi
  if ! SESSION_TOKEN="$(extract_cookie ipam_session "$COOKIE_JAR")"; then
    SETUP_STATUS="000"
    return 1
  fi
}

run_case() {
  local name="$1"
  local expected="$2"
  local status

  if ! prepare_case "$name"; then
    report "$name" "$SETUP_STATUS" "$expected"
    return
  fi

  case "$name" in
    origin-same)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header "Origin: $APP_ORIGIN" --header "X-CSRF-Token: $CSRF_TOKEN" \
        "$BFF_BASE_URL/api/auth/logout")"
      ;;
    referer-same)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header "Referer: $APP_ORIGIN/settings" --header "X-CSRF-Token: $CSRF_TOKEN" \
        "$BFF_BASE_URL/api/auth/logout")"
      ;;
    sources-missing)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header "X-CSRF-Token: $CSRF_TOKEN" "$BFF_BASE_URL/api/auth/logout")"
      ;;
    referer-malformed)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header 'Referer: not-a-url' --header "X-CSRF-Token: $CSRF_TOKEN" \
        "$BFF_BASE_URL/api/auth/logout")"
      ;;
    referer-foreign)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header "Referer: $FOREIGN_ORIGIN/path" --header "X-CSRF-Token: $CSRF_TOKEN" \
        "$BFF_BASE_URL/api/auth/logout")"
      ;;
    origin-foreign-referer-same)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header "Origin: $FOREIGN_ORIGIN" --header "Referer: $APP_ORIGIN/settings" \
        --header "X-CSRF-Token: $CSRF_TOKEN" "$BFF_BASE_URL/api/auth/logout")"
      ;;
    csrf-wrong)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header "Origin: $APP_ORIGIN" --header 'X-CSRF-Token: wrong-csrf-token' \
        "$BFF_BASE_URL/api/auth/logout")"
      ;;
    bff-bootstrap-blocked)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header 'Content-Type: application/json' --header "Origin: $APP_ORIGIN" \
        --header "X-CSRF-Token: $CSRF_TOKEN" --data '{}' \
        "$BFF_BASE_URL/api/auth/bootstrap")"
      ;;
    bff-case-variant-login-blocked)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header 'Content-Type: application/json' --header "Origin: $APP_ORIGIN" \
        --header "X-CSRF-Token: $CSRF_TOKEN" --data-binary "@$LOGIN_BODY" \
        "$BFF_BASE_URL/api/AUTH/login")"
      ;;
    forged-bff-authorization)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header 'Accept: application/json' --header 'Content-Type: application/json' \
        --header 'Authorization: Bearer forged-browser-token' \
        --header "Origin: $APP_ORIGIN" --header "X-CSRF-Token: $CSRF_TOKEN" \
        --data '{}' "$BFF_BASE_URL/api/auth/password")"
      ;;
    spoofed-forwarding-headers)
      status="$(curl_status --request POST --cookie "$COOKIE_JAR" \
        --header 'Accept: application/json' --header 'Content-Type: application/json' \
        --header 'Forwarded: for=203.0.113.10;proto=https' \
        --header 'X-Forwarded-For: 203.0.113.10' \
        --header 'X-Forwarded-Host: foreign.example' \
        --header 'X-Bootstrap-Token: browser-bootstrap-token' \
        --header "Origin: $APP_ORIGIN" --header "X-CSRF-Token: $CSRF_TOKEN" \
        --data '{}' "$BFF_BASE_URL/api/auth/password")"
      ;;
    raw-cookie-only-backend-auth)
      status="$(curl_status --request POST \
        --header "Cookie: ipam_session=$SESSION_TOKEN; ipam_csrf=$CSRF_TOKEN" \
        "$BACKEND_BASE_URL/api/auth/logout")"
      ;;
    foreign-origin-backend-bearer)
      status="$(curl_status --request POST \
        --header "Authorization: Bearer $SESSION_TOKEN" \
        --header "Origin: $FOREIGN_ORIGIN" \
        "$BACKEND_BASE_URL/api/auth/logout")"
      ;;
    backend-bearer-no-origin)
      status="$(curl_status --request POST \
        --header "Authorization: Bearer $SESSION_TOKEN" \
        "$BACKEND_BASE_URL/api/auth/logout")"
      ;;
    *)
      status="000"
      ;;
  esac

  report "$name" "$status" "$expected"
}

main() {
  require_command curl
  require_command node
  [[ -n "$AUTH_USERNAME" && -n "$AUTH_PASSWORD" ]] || configuration_failure

  TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ipam-auth-boundary.XXXXXX")"
  LOGIN_BODY="$TEMP_ROOT/login.json"
  AUTH_USERNAME_VALUE="$AUTH_USERNAME" AUTH_PASSWORD_VALUE="$AUTH_PASSWORD" \
    node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({username: process.env.AUTH_USERNAME_VALUE, password: process.env.AUTH_PASSWORD_VALUE}));' \
    "$LOGIN_BODY" >/dev/null 2>&1 || configuration_failure

  run_case origin-same 200
  run_case referer-same 200
  run_case sources-missing 403
  run_case referer-malformed 403
  run_case referer-foreign 403
  run_case origin-foreign-referer-same 403
  run_case csrf-wrong 403
  run_case bff-bootstrap-blocked 404
  run_case bff-case-variant-login-blocked 404
  run_case forged-bff-authorization 400
  run_case spoofed-forwarding-headers 400
  run_case raw-cookie-only-backend-auth 401
  run_case foreign-origin-backend-bearer 403
  run_case backend-bearer-no-origin 201

  exit "$FAILED"
}

main "$@"
