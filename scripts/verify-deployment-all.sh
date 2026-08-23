#!/usr/bin/env bash
set -euo pipefail

readonly LABEL_KEY='io.ipam.verify.run'
readonly COMPONENT_LABEL_KEY='io.ipam.verify.component'
readonly ATTEMPTS="${VERIFY_DEPLOYMENT_ATTEMPTS:-60}"
readonly INTERVAL_SECONDS="${VERIFY_DEPLOYMENT_INTERVAL_SECONDS:-1}"
NODE_BIN=""
STATE_ROOT=""
RUN_ID=""
AUTH_SECRET=""
CURRENT_CONTAINER=""
ACTIVE_CONTAINERS=()
PORTS=()

blocked() {
  printf 'ENVIRONMENT_BLOCKED component=%s reason=%s\n' "$1" "$2" >&2
  exit 2
}

contract_failed() {
  printf 'DEPLOYMENT_ERROR component=%s reason=%s\n' "$1" "$2" >&2
  exit 1
}

remove_owned_container() {
  local name="$1"
  local actual_label
  local inspect_error="$STATE_ROOT/cleanup-inspect.error"

  if ! actual_label="$(docker container inspect \
    --format '{{ index .Config.Labels "io.ipam.verify.run" }}' "$name" 2>"$inspect_error")"; then
    if grep -Eq -- '^(Error response from daemon: No such container:|Error: No such (object|container):)' "$inspect_error"; then
      return 0
    fi
    printf 'CLEANUP_ERROR component=container reason=inspect-failed\n' >&2
    return 1
  fi
  if [[ "$actual_label" != "$RUN_ID" ]]; then
    printf 'CLEANUP_ERROR component=container reason=label-mismatch\n' >&2
    return 1
  fi
  if ! docker container rm --force "$name" >/dev/null 2>&1; then
    printf 'CLEANUP_ERROR component=container reason=remove-failed\n' >&2
    return 1
  fi
}

finish() {
  local status="$1"
  local cleanup_failed=0
  local index

  trap - EXIT INT TERM
  set +e
  for ((index=${#ACTIVE_CONTAINERS[@]} - 1; index >= 0; index--)); do
    remove_owned_container "${ACTIVE_CONTAINERS[$index]}" || cleanup_failed=1
  done
  if [[ -n "$STATE_ROOT" && "$STATE_ROOT" == "${TMPDIR:-/tmp}"/ipam-deployment-all.* ]]; then
    rm -rf -- "$STATE_ROOT" || cleanup_failed=1
  fi
  if ((status == 0 && cleanup_failed != 0)); then status=1; fi
  exit "$status"
}

trap 'finish $?' EXIT
trap 'finish 130' INT
trap 'finish 143' TERM

validate_inputs() {
  local image

  command -v docker >/dev/null 2>&1 || blocked docker command-unavailable
  command -v curl >/dev/null 2>&1 || blocked curl command-unavailable
  NODE_BIN="$(command -v node || true)"
  [[ -n "$NODE_BIN" ]] || blocked node command-unavailable
  [[ -n "${TEST_DATABASE_URL:-}" ]] || blocked database url-unavailable
  MYSQL_SERVICE_CONTAINER_ID="${MYSQL_SERVICE_CONTAINER_ID:-}"
  [[ "$MYSQL_SERVICE_CONTAINER_ID" =~ ^[a-f0-9]{64}$ ]] \
    || blocked mysql-service invalid-container-id

  for image in "${IPAM_BACKEND_IMAGE:-}" "${IPAM_FRONTEND_IMAGE:-}" "${IPAM_COMBINED_IMAGE:-}"; do
    [[ "$image" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]] || blocked image invalid-reference
  done
  [[ "$ATTEMPTS" =~ ^[1-9][0-9]*$ ]] && ((ATTEMPTS <= 120)) \
    || blocked probe invalid-attempts
  [[ "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]] && ((INTERVAL_SECONDS <= 10)) \
    || blocked probe invalid-interval

  TEST_URL="$TEST_DATABASE_URL" "$NODE_BIN" <<'NODE' >/dev/null 2>&1 \
    || blocked database unsafe-url
const raw = process.env.TEST_URL ?? "";
if (/[\u0000-\u001f\u007f]/.test(raw)) process.exit(2);
try {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.protocol !== "mysql:") process.exit(2);
  if (!url.username || !["127.0.0.1", "localhost", "::1"].includes(host)) process.exit(2);
  if (!/^[A-Za-z0-9_]+_test$/.test(database)) process.exit(2);
  const port = Number(url.port || "3306");
  if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(2);
} catch {
  process.exit(2);
}
NODE

  docker info >/dev/null 2>&1 || blocked docker daemon-unavailable
  local mysql_service_details
  mysql_service_details="$(docker container inspect \
    --format '{{.Config.Image}} {{.State.Running}}' "$MYSQL_SERVICE_CONTAINER_ID" 2>/dev/null)" \
    || blocked mysql-service unavailable
  [[ "$mysql_service_details" == mysql:8\ true ]] \
    || blocked mysql-service invalid-container
  for image in "$IPAM_BACKEND_IMAGE" "$IPAM_FRONTEND_IMAGE" "$IPAM_COMBINED_IMAGE"; do
    docker image inspect "$image" >/dev/null 2>&1 \
      || contract_failed image unavailable
  done
}

initialize_state() {
  local raw_id

  umask 077
  STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ipam-deployment-all.XXXXXX")"
  raw_id="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-${BASHPID}-${RANDOM}"
  RUN_ID="$(printf '%s' "$raw_id" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | cut -c1-32)"
  RUN_ID="${RUN_ID%-}"
  [[ "$RUN_ID" =~ ^[a-z0-9][a-z0-9-]{3,31}$ ]] || contract_failed runtime unsafe-run-id
  AUTH_SECRET="$($NODE_BIN -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"

  mapfile -t PORTS < <("$NODE_BIN" <<'NODE'
const net = require("node:net");
const servers = Array.from({length: 4}, () => net.createServer());
Promise.all(servers.map(server => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
}))).then(() => {
  const ports = servers.map(server => server.address().port);
  if (new Set(ports).size !== ports.length || ports.some(port => port < 20000)) process.exit(2);
  process.stdout.write(`${ports.join("\n")}\n`);
  return Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
}).catch(() => process.exit(2));
NODE
  )
  [[ "${#PORTS[@]}" -eq 4 ]] || contract_failed runtime port-allocation
}

redact_log() {
  local raw_file="$1"
  local output_file="$2"

  REDACT_URL="$TEST_DATABASE_URL" REDACT_AUTH_SECRET="$AUTH_SECRET" "$NODE_BIN" - "$raw_file" "$output_file" <<'NODE'
const fs = require("node:fs");
const [inputPath, outputPath] = process.argv.slice(2);
let output = fs.readFileSync(inputPath, "utf8");
const url = process.env.REDACT_URL ?? "";
const secrets = [url, process.env.REDACT_AUTH_SECRET ?? ""];
const parsed = new URL(url);
secrets.push(parsed.password, decodeURIComponent(parsed.password));
for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) {
  output = output.split(secret).join("***REDACTED***");
}
fs.writeFileSync(outputPath, output, {mode: 0o600});
NODE
}

print_failure_log() {
  local name="$1"
  local component="$2"
  local raw_file="$STATE_ROOT/$component.raw.log"
  local redacted_file="$STATE_ROOT/$component.log"

  docker logs --tail 40 "$name" > "$raw_file" 2>&1 || true
  redact_log "$raw_file" "$redacted_file"
  rm -f -- "$raw_file"
  printf 'CONTAINER_LOG_REDACTED component=%s\n' "$component" >&2
  while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$redacted_file"
}

start_container() {
  local name="$1"
  local image="$2"
  local env_file="$3"
  local component="${name##*-}"

  docker run --detach \
    --name "$name" \
    --label "$LABEL_KEY=$RUN_ID" \
    --label "$COMPONENT_LABEL_KEY=$component" \
    --network host \
    --env-file "$env_file" \
    "$image" >/dev/null \
    || contract_failed "$component" container-start
  ACTIVE_CONTAINERS+=("$name")
  CURRENT_CONTAINER="$name"
}

probe_http() {
  local component="$1"
  local base_url="$2"
  local path="$3"
  local status=""
  local attempt

  for ((attempt=1; attempt<=ATTEMPTS; attempt++)); do
    status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --connect-timeout 2 --max-time 5 "${base_url}${path}" 2>/dev/null || true)"
    [[ "$status" == "200" ]] && return 0
    if [[ "$(docker container inspect --format '{{.State.Running}}' "$CURRENT_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
      break
    fi
    ((attempt == ATTEMPTS)) || sleep "$INTERVAL_SECONDS"
  done

  printf 'DEPLOYMENT_ERROR component=%s probe=%s expected=200\n' "$component" "${path##*/}" >&2
  print_failure_log "$CURRENT_CONTAINER" "$component"
  exit 1
}

assert_http_status() {
  local component="$1"
  local base_url="$2"
  local path="$3"
  local expected_status="$4"
  local status=""
  local attempt

  for ((attempt=1; attempt<=ATTEMPTS; attempt++)); do
    status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --connect-timeout 2 --max-time 5 "${base_url}${path}" 2>/dev/null || true)"
    [[ "$status" == "$expected_status" ]] && return 0
    if [[ "$(docker container inspect --format '{{.State.Running}}' "$CURRENT_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
      break
    fi
    ((attempt == ATTEMPTS)) || sleep "$INTERVAL_SECONDS"
  done
  printf 'DEPLOYMENT_ERROR component=%s probe=%s expected=%s\n' \
    "$component" "${path##*/}" "$expected_status" >&2
  print_failure_log "$CURRENT_CONTAINER" "$component"
  exit 1
}

stop_mysql_service() {
  docker container stop "$MYSQL_SERVICE_CONTAINER_ID" >/dev/null 2>&1 \
    || contract_failed mysql-service stop-failed
}

write_backend_env() {
  local file="$1"
  local port="$2"
  local cors_origin="$3"
  printf '%s\n' \
    "DATABASE_URL=$TEST_DATABASE_URL" \
    "AUTH_SECRET=$AUTH_SECRET" \
    'BOOTSTRAP_DISABLED=true' \
    "PORT=$port" \
    'HOST=0.0.0.0' \
    "CORS_ORIGINS=$cors_origin" > "$file"
}

run_all() {
  local backend_port frontend_port combined_port combined_backend_port
  local backend_name frontend_name combined_name
  local backend_origin frontend_origin combined_origin

  validate_inputs
  initialize_state
  backend_port="${PORTS[0]}"
  frontend_port="${PORTS[1]}"
  combined_port="${PORTS[2]}"
  combined_backend_port="${PORTS[3]}"
  backend_name="ipam-${RUN_ID}-backend"
  frontend_name="ipam-${RUN_ID}-frontend"
  combined_name="ipam-${RUN_ID}-combined"
  backend_origin="http://127.0.0.1:$backend_port"
  frontend_origin="http://127.0.0.1:$frontend_port"
  combined_origin="http://127.0.0.1:$combined_port"

  write_backend_env "$STATE_ROOT/backend.env" "$backend_port" "$frontend_origin"
  start_container "$backend_name" "$IPAM_BACKEND_IMAGE" "$STATE_ROOT/backend.env"
  probe_http backend "$backend_origin" /api/health/live
  probe_http backend "$backend_origin" /api/health/ready
  printf 'BACKEND_SMOKE_OK live=200 ready=200 migrations=applied\n'

  printf '%s\n' \
    "PORT=$frontend_port" \
    'HOSTNAME=0.0.0.0' \
    "APP_ORIGIN=$frontend_origin" \
    "API_PROXY_TARGET=$backend_origin" > "$STATE_ROOT/frontend.env"
  start_container "$frontend_name" "$IPAM_FRONTEND_IMAGE" "$STATE_ROOT/frontend.env"
  probe_http frontend "$frontend_origin" /
  probe_http frontend "$frontend_origin" /api/auth/status
  printf 'FRONTEND_SMOKE_OK page=200 bff=200\n'

  printf '%s\n' \
    "DATABASE_URL=$TEST_DATABASE_URL" \
    "AUTH_SECRET=$AUTH_SECRET" \
    'BOOTSTRAP_DISABLED=true' \
    "PORT=$combined_port" \
    "BACKEND_PORT=$combined_backend_port" \
    'HOST=0.0.0.0' \
    "CORS_ORIGINS=$combined_origin" \
    "APP_ORIGIN=$combined_origin" \
    "API_PROXY_TARGET=http://127.0.0.1:$combined_backend_port" > "$STATE_ROOT/combined.env"
  start_container "$combined_name" "$IPAM_COMBINED_IMAGE" "$STATE_ROOT/combined.env"
  probe_http combined "$combined_origin" /
  probe_http combined "$combined_origin" /api/health/ready
  printf 'COMBINED_SMOKE_OK page=200 ready=200\n'
  remove_owned_container "$frontend_name" || contract_failed frontend cleanup
  remove_owned_container "$combined_name" || contract_failed combined cleanup
  stop_mysql_service
  CURRENT_CONTAINER="$backend_name"
  assert_http_status backend "$backend_origin" /api/health/live 200
  assert_http_status backend "$backend_origin" /api/health/ready 503
  printf 'MYSQL_OUTAGE_SMOKE_OK live=200 ready=503\n'
  remove_owned_container "$backend_name" || contract_failed backend cleanup
  printf 'ALL_OK\n'
}

run_all
