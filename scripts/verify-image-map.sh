#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${VERIFY_IMAGE_MAP_MODE:-auto}"
OUTPUT_PATH="${IMAGE_MAP_OUTPUT:-}"
TEMP_DIR="$(mktemp -d)"
ROWS_FILE="$TEMP_DIR/images.tsv"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

info() {
  printf '%s\n' "$*" >&2
}

fail() {
  printf 'IMAGE_MAP_INVALID code=%s\n' "$1" >&2
  exit 1
}

environment_blocked() {
  printf 'ENVIRONMENT_BLOCKED component=docker reason=%s\n' "$1" >&2
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing-command-$1"
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  local code="$3"
  grep -Eq -- "$pattern" "$file" || fail "$code"
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  local code="$3"
  if grep -Eq -- "$pattern" "$file"; then
    fail "$code"
  fi
}

assert_count() {
  local file="$1"
  local pattern="$2"
  local expected="$3"
  local code="$4"
  local actual
  actual="$(grep -Ec -- "$pattern" "$file" || true)"
  [ "$actual" = "$expected" ] || fail "$code"
}

assert_min_count() {
  local file="$1"
  local pattern="$2"
  local expected="$3"
  local code="$4"
  local actual
  actual="$(grep -Eic -- "$pattern" "$file" || true)"
  [ "$actual" -ge "$expected" ] || fail "$code"
}

assert_last_user_node() {
  local file="$1"
  local last_user
  last_user="$(awk 'toupper($1) == "USER" { value=$2 } END { print value }' "$file")"
  [ "$last_user" = "node" ] || fail "runtime-user-$file"
}

assert_runtime_has_no_sources() {
  local file="$1"
  local runtime_file="$TEMP_DIR/runtime-$(basename "$file")"
  awk 'toupper($1) == "FROM" { content="" } { content=content $0 ORS } END { printf "%s", content }' "$file" >"$runtime_file"
  assert_not_contains "$runtime_file" 'COPY[^#]*(/|[[:space:]])src([[:space:]]|/|$)' "runtime-source-$file"
  assert_not_contains "$runtime_file" 'COPY[^#]*(tsconfig|nest-cli|eslint\.config|postcss\.config)' "runtime-tooling-$file"
}

assert_secret_policy() {
  local file="$1"
  local expected_mounts="$2"
  assert_not_contains "$file" '^[[:space:]]*(ARG|ENV)[[:space:]][^#]*HEROUI_AUTH_TOKEN' "token-arg-env-$file"
  assert_count "$file" '--mount=type=secret,id=heroui_token,env=HEROUI_AUTH_TOKEN,required=true[[:space:]]+npm ci' "$expected_mounts" "secret-mount-$file"
}

static_checks() {
  local backend="$ROOT_DIR/Dockerfile.backend"
  local frontend="$ROOT_DIR/Dockerfile.frontend"
  local combined="$ROOT_DIR/Dockerfile"
  local zeabur="$ROOT_DIR/zeabur.yaml"
  local railway="$ROOT_DIR/railway.json"

  for file in "$backend" "$frontend" "$combined" "$zeabur" "$railway" "$ROOT_DIR/scripts/start-combined.sh"; do
    [ -f "$file" ] || fail "missing-file-$(basename "$file")"
  done

  assert_min_count "$backend" '^[[:space:]]*FROM[[:space:]]+' 3 'backend-multistage'
  assert_min_count "$frontend" '^[[:space:]]*FROM[[:space:]]+' 2 'frontend-multistage'
  assert_min_count "$combined" '^[[:space:]]*FROM[[:space:]]+' 4 'combined-multistage'
  assert_min_count "$zeabur" '^[[:space:]]*FROM[[:space:]]+' 5 'zeabur-multistage'

  assert_last_user_node "$backend"
  assert_last_user_node "$frontend"
  assert_last_user_node "$combined"
  assert_count "$zeabur" '^[[:space:]]*USER[[:space:]]+node[[:space:]]*$' 2 'zeabur-runtime-users'

  assert_runtime_has_no_sources "$backend"
  assert_runtime_has_no_sources "$frontend"
  assert_runtime_has_no_sources "$combined"

  assert_secret_policy "$backend" 0
  assert_secret_policy "$frontend" 1
  assert_secret_policy "$combined" 1
  assert_secret_policy "$zeabur" 1
  assert_not_contains "$backend" '(heroui_token|HEROUI_AUTH_TOKEN)' 'backend-secret-reference'
  assert_not_contains "$zeabur" '^[[:space:]]*(- key:|HEROUI_AUTH_TOKEN:)[[:space:]]*HEROUI_AUTH_TOKEN' 'zeabur-token-variable'

  assert_contains "$backend" '^[[:space:]]*ENV[[:space:]]+NODE_ENV=production' 'backend-production-env'
  assert_contains "$backend" '^[[:space:]]*EXPOSE[[:space:]]+8080[[:space:]]*$' 'backend-port'
  assert_contains "$backend" '^ENTRYPOINT \["sh", "scripts/start-prod\.sh"\]$' 'backend-entrypoint'
  assert_contains "$backend" 'npm ci --omit=dev' 'backend-production-deps'

  assert_contains "$frontend" '^[[:space:]]*EXPOSE[[:space:]]+8080[[:space:]]*$' 'frontend-port'
  assert_contains "$frontend" '^ENTRYPOINT \["node", "server\.js"\]$' 'frontend-entrypoint'
  assert_contains "$frontend" '/\.next/standalone' 'frontend-standalone-copy'
  assert_contains "$ROOT_DIR/frontend/next.config.ts" 'output:[[:space:]]*"standalone"' 'frontend-standalone-config'

  assert_contains "$combined" '^[[:space:]]*EXPOSE[[:space:]]+3003[[:space:]]*$' 'combined-public-port'
  assert_contains "$combined" 'BACKEND_PORT=3001' 'combined-backend-port'
  assert_contains "$combined" '^ENTRYPOINT \["sh", "/app/scripts/start-combined\.sh"\]$' 'combined-entrypoint'
  assert_contains "$ROOT_DIR/scripts/start-combined.sh" '/api/health/ready' 'combined-readiness'
  assert_contains "$ROOT_DIR/scripts/start-combined.sh" 'node server\.js' 'combined-frontend-entrypoint'
  sh -n "$ROOT_DIR/scripts/start-combined.sh" || fail 'combined-start-shell-syntax'

  assert_contains "$railway" '"healthcheckPath"[[:space:]]*:[[:space:]]*"/api/health/ready"' 'railway-readiness'
  assert_contains "$zeabur" 'path:[[:space:]]*/api/health/ready' 'zeabur-backend-readiness'
  assert_contains "$zeabur" 'path:[[:space:]]*/[[:space:]]*$' 'zeabur-frontend-readiness'
  assert_contains "$zeabur" 'APP_ORIGIN:' 'zeabur-app-origin'

  ROOT_DIR_FOR_NODE="$ROOT_DIR" node <<'NODE' || fail 'backend-prisma-production-dependency'
const packageJson = require(`${process.env.ROOT_DIR_FOR_NODE}/backend/package.json`);
if (typeof packageJson.dependencies?.prisma !== 'string') process.exit(1);
if (packageJson.devDependencies?.prisma !== undefined) process.exit(1);
NODE

  info 'IMAGE_MAP_STATIC_CHECKS_OK'
}

context_sha() {
  tar --sort=name \
    --mtime='UTC 1970-01-01' \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    --exclude-vcs \
    --exclude-from="$ROOT_DIR/.dockerignore" \
    -cf - \
    -C "$ROOT_DIR" . \
    | sha256sum \
    | awk '{ print $1 }'
}

resolve_mode() {
  case "$MODE" in
    static)
      printf 'static'
      ;;
    docker)
      command -v docker >/dev/null 2>&1 || environment_blocked 'command-not-found'
      docker info >/dev/null 2>&1 || environment_blocked 'daemon-unavailable'
      printf 'docker'
      ;;
    auto)
      if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        printf 'docker'
      else
        printf 'static'
      fi
      ;;
    *)
      fail 'invalid-mode'
      ;;
  esac
}

scan_image_for_secret() {
  local name="$1"
  local image="$2"
  local inspect_file="$TEMP_DIR/$name-inspect.json"
  local history_file="$TEMP_DIR/$name-history.txt"
  local layers_file="$TEMP_DIR/$name-image.tar"

  [ -n "${HEROUI_AUTH_TOKEN:-}" ] || return 0

  docker image inspect "$image" >"$inspect_file"
  docker image history --no-trunc "$image" >"$history_file"
  docker image save --output "$layers_file" "$image"

  for file in "$inspect_file" "$history_file" "$layers_file"; do
    if LC_ALL=C grep -aFq -- "$HEROUI_AUTH_TOKEN" "$file"; then
      fail "secret-value-in-image-$name"
    fi
  done
}

assert_runtime_contents() {
  local name="$1"
  local image="$2"
  local check

  case "$name" in
    ipam-backend)
      check='test -d /app/dist && test -x /app/node_modules/.bin/prisma && test ! -d /app/src && test ! -x /app/node_modules/.bin/nest && test ! -x /app/node_modules/.bin/tsc'
      ;;
    ipam-frontend)
      check='test -f /app/server.js && test -d /app/.next/static && test ! -d /app/src && test ! -e /app/tsconfig.json && test ! -x /app/node_modules/.bin/tsc'
      ;;
    ipam-combined)
      check='test -d /app/backend/dist && test -x /app/backend/node_modules/.bin/prisma && test -f /app/frontend/server.js && test -f /app/scripts/start-combined.sh && test ! -d /app/backend/src && test ! -d /app/frontend/src && test ! -x /app/backend/node_modules/.bin/nest && test ! -x /app/backend/node_modules/.bin/tsc'
      ;;
    *)
      fail "unknown-image-$name"
      ;;
  esac

  docker run --rm --entrypoint sh "$image" -ceu "$check" >/dev/null \
    || fail "runtime-contents-$name"
}

write_inspect_helper() {
  cat >"$TEMP_DIR/inspect-image.cjs" <<'NODE'
const fs = require('node:fs');

const inspected = JSON.parse(fs.readFileSync(0, 'utf8'));
const image = inspected[0];
const fail = (code) => {
  process.stderr.write(`inspect mismatch: ${code}\n`);
  process.exit(1);
};
if (!image?.Config) fail('missing-config');

const labels = image.Config.Labels ?? {};
const expectedLabels = {
  'io.ipam.image.name': process.env.EXPECTED_NAME,
  'io.ipam.image.dockerfile': process.env.EXPECTED_DOCKERFILE,
  'io.ipam.image.secret-required': process.env.EXPECTED_SECRET,
  'io.ipam.image.entrypoint': process.env.EXPECTED_LABEL_ENTRYPOINT,
  'io.ipam.image.ports': process.env.EXPECTED_LABEL_PORTS,
  'io.ipam.image.runtime-uid': '1000',
};
for (const [key, value] of Object.entries(expectedLabels)) {
  if (labels[key] !== value) fail(`label-${key}`);
}

if (image.Config.User !== 'node') fail('configured-user');
if (JSON.stringify(image.Config.Entrypoint ?? []) !== process.env.EXPECTED_ENTRYPOINT_JSON) {
  fail('entrypoint');
}
const exposed = Object.keys(image.Config.ExposedPorts ?? {}).sort();
const expectedExposed = (process.env.EXPECTED_EXPOSED_PORTS ?? '').split(',').filter(Boolean).sort();
if (JSON.stringify(exposed) !== JSON.stringify(expectedExposed)) fail('exposed-ports');

const configuredEnv = new Set(image.Config.Env ?? []);
for (const value of (process.env.EXPECTED_ENV ?? '').split(';').filter(Boolean)) {
  if (!configuredEnv.has(value)) fail(`env-${value.split('=')[0]}`);
}
if ([...configuredEnv].some((value) => value.startsWith('HEROUI_AUTH_TOKEN='))) {
  fail('secret-runtime-env');
}

const platformParts = [image.Os, image.Architecture, image.Variant].filter(Boolean);
const registryDigest = (image.RepoDigests ?? []).find((value) => value.includes('@sha256:')) ?? null;
process.stdout.write(JSON.stringify({
  entrypointArgv: image.Config.Entrypoint ?? [],
  imageId: image.Id ?? null,
  registryDigest,
  runtimeUid: Number(process.env.ACTUAL_UID),
  targetPlatform: platformParts.join('/'),
}));
NODE
}

inspect_image() {
  local name="$1"
  local image="$2"
  local dockerfile="$3"
  local secret_required="$4"
  local entrypoint_json="$5"
  local label_entrypoint="$6"
  local label_ports="$7"
  local exposed_ports="$8"
  local required_env="$9"
  local metadata_file="${10}"
  local actual_uid

  docker image inspect "$image" >/dev/null 2>&1 \
    || environment_blocked "image-unavailable-$name"

  actual_uid="$(docker run --rm --entrypoint id "$image" -u 2>/dev/null)" \
    || environment_blocked "image-not-runnable-$name"
  [ "$actual_uid" = '1000' ] || fail "runtime-uid-$name"

  if ! docker image inspect "$image" | \
    EXPECTED_NAME="$name" \
    EXPECTED_DOCKERFILE="$dockerfile" \
    EXPECTED_SECRET="$secret_required" \
    EXPECTED_ENTRYPOINT_JSON="$entrypoint_json" \
    EXPECTED_LABEL_ENTRYPOINT="$label_entrypoint" \
    EXPECTED_LABEL_PORTS="$label_ports" \
    EXPECTED_EXPOSED_PORTS="$exposed_ports" \
    EXPECTED_ENV="$required_env" \
    ACTUAL_UID="$actual_uid" \
    node "$TEMP_DIR/inspect-image.cjs" >"$metadata_file"
  then
    fail "image-inspect-$name"
  fi

  assert_runtime_contents "$name" "$image"
  scan_image_for_secret "$name" "$image"
}

write_manifest() {
  local verification_mode="$1"
  local docker_status="$2"
  local context_digest="$3"
  local manifest

  manifest="$(ROWS_FILE="$ROWS_FILE" VERIFY_MODE="$verification_mode" DOCKER_STATUS="$docker_status" CONTEXT_SHA="$context_digest" node <<'NODE'
const fs = require('node:fs');

const rows = fs.readFileSync(process.env.ROWS_FILE, 'utf8').trim().split('\n').filter(Boolean);
const images = rows.map((row) => {
  const [
    imageName,
    dockerfile,
    dockerfileSha256,
    secretRequired,
    entrypoint,
    publicPorts,
    internalPorts,
    imageReference,
    metadataPath,
  ] = row.split('\t');
  const metadata = metadataPath && fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    : {
        entrypointArgv: null,
        imageId: null,
        registryDigest: null,
        runtimeUid: 1000,
        targetPlatform: null,
      };
  return {
    imageName,
    dockerfile,
    dockerfileSha256,
    contextSha256: process.env.CONTEXT_SHA,
    secretRequired: secretRequired === 'true',
    entrypoint,
    entrypointArgv: metadata.entrypointArgv,
    ports: {
      public: publicPorts.split(',').filter(Boolean).map(Number),
      internal: internalPorts.split(',').filter(Boolean).map(Number),
    },
    runtimeUid: metadata.runtimeUid,
    registryDigest: metadata.registryDigest,
    targetPlatform: metadata.targetPlatform,
    imageReference,
    imageId: metadata.imageId,
    verification: process.env.VERIFY_MODE === 'docker' ? 'verified' : 'static-only',
  };
});

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  contextShaAlgorithm: 'canonical-tar-v1',
  dockerVerification: {
    status: process.env.DOCKER_STATUS,
  },
  images,
}, null, 2)}\n`);
NODE
)"

  if [ -n "$OUTPUT_PATH" ]; then
    mkdir -p "$(dirname "$OUTPUT_PATH")"
    printf '%s\n' "$manifest" >"$OUTPUT_PATH"
    info "IMAGE_MAP_WRITTEN path=$OUTPUT_PATH"
  else
    printf '%s\n' "$manifest"
  fi
}

main() {
  require_command awk
  require_command grep
  require_command node
  require_command sha256sum
  require_command tar

  static_checks
  write_inspect_helper

  local resolved_mode
  local docker_status
  local context_digest
  resolved_mode="$(resolve_mode)"
  context_digest="$(context_sha)"

  local names=('ipam-backend' 'ipam-frontend' 'ipam-combined')
  local dockerfiles=('Dockerfile.backend' 'Dockerfile.frontend' 'Dockerfile')
  local secret_required=('false' 'true' 'true')
  local entrypoints=('sh scripts/start-prod.sh' 'node server.js' 'sh /app/scripts/start-combined.sh')
  local entrypoint_json=('["sh","scripts/start-prod.sh"]' '["node","server.js"]' '["sh","/app/scripts/start-combined.sh"]')
  local label_ports=('8080' '8080' 'public=3003,backend=3001')
  local exposed_ports=('8080/tcp' '8080/tcp' '3003/tcp')
  local public_ports=('8080' '8080' '3003')
  local internal_ports=('' '' '3001')
  local required_env=('NODE_ENV=production;PORT=8080' 'NODE_ENV=production;PORT=8080' 'NODE_ENV=production;PORT=3003;BACKEND_PORT=3001')
  local image_refs=(
    "${IPAM_BACKEND_IMAGE:-ipam-backend:qa}"
    "${IPAM_FRONTEND_IMAGE:-ipam-frontend:qa}"
    "${IPAM_COMBINED_IMAGE:-ipam-combined:qa}"
  )

  : >"$ROWS_FILE"
  local index
  for index in "${!names[@]}"; do
    local name="${names[$index]}"
    local dockerfile="${dockerfiles[$index]}"
    local image_ref="${image_refs[$index]}"
    local metadata_file=""

    if [ "$resolved_mode" = 'docker' ]; then
      metadata_file="$TEMP_DIR/$name-metadata.json"
      inspect_image \
        "$name" \
        "$image_ref" \
        "$dockerfile" \
        "${secret_required[$index]}" \
        "${entrypoint_json[$index]}" \
        "${entrypoints[$index]}" \
        "${label_ports[$index]}" \
        "${exposed_ports[$index]}" \
        "${required_env[$index]}" \
        "$metadata_file"
    fi

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$name" \
      "$dockerfile" \
      "$(sha256sum "$ROOT_DIR/$dockerfile" | awk '{ print $1 }')" \
      "${secret_required[$index]}" \
      "${entrypoints[$index]}" \
      "${public_ports[$index]}" \
      "${internal_ports[$index]}" \
      "$image_ref" \
      "$metadata_file" \
      >>"$ROWS_FILE"
  done

  if [ "$resolved_mode" = 'docker' ]; then
    if [ "${VERIFY_IMAGE_MAP_REQUIRE_SECRET_SCAN:-0}" = '1' ] && [ -z "${HEROUI_AUTH_TOKEN:-}" ]; then
      environment_blocked 'secret-scan-input-unavailable'
    fi
    docker_status='VERIFIED'
    info 'IMAGE_MAP_DOCKER_CHECKS_OK'
  else
    docker_status='ENVIRONMENT_BLOCKED'
    info 'ENVIRONMENT_BLOCKED component=docker reason=command-or-daemon-unavailable static_checks=passed'
  fi

  write_manifest "$resolved_mode" "$docker_status" "$context_digest"
}

main "$@"
