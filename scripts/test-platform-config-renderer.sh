#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT_DIR
readonly RENDERER="$ROOT_DIR/scripts/render-platform-configs.mjs"
readonly IMAGE_VERIFIER="$ROOT_DIR/scripts/verify-image-map.sh"
readonly RELEASE_MANIFEST="$ROOT_DIR/scripts/release-manifest.mjs"

TEST_ROOT=""
FAILURES=0

cleanup() {
  if [[ -n "$TEST_ROOT" && -d "$TEST_ROOT" ]]; then
    rm -rf -- "$TEST_ROOT"
  fi
}
trap cleanup EXIT

fail() {
  printf 'PLATFORM_RENDERER_TEST_FAILED case=%s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

write_manifest() {
  local path="$1"
  node - "$path" <<'NODE'
const fs = require("node:fs");

const outputPath = process.argv[2];
const digest = (character) => character.repeat(64);
const repository = (name, character) =>
  `ghcr.io/internetlink/${name}@sha256:${digest(character)}`;

const images = [
  {
    imageName: "ipam-backend",
    dockerfile: "Dockerfile.backend",
    dockerfileSha256: digest("1"),
    contextSha256: digest("4"),
    secretRequired: false,
    entrypoint: "sh scripts/start-prod.sh",
    entrypointArgv: ["sh", "scripts/start-prod.sh"],
    ports: { public: [8080], internal: [] },
    runtimeUid: 1000,
    registryDigest: repository("ipam-backend", "a"),
    imageReference: repository("ipam-backend", "a"),
    imageId: `sha256:${digest("1")}`,
    targetPlatform: "linux/amd64",
    verification: "verified",
  },
  {
    imageName: "ipam-frontend",
    dockerfile: "Dockerfile.frontend",
    dockerfileSha256: digest("2"),
    contextSha256: digest("4"),
    secretRequired: true,
    entrypoint: "node server.js",
    entrypointArgv: ["node", "server.js"],
    ports: { public: [8080], internal: [] },
    runtimeUid: 1000,
    registryDigest: repository("ipam-frontend", "b"),
    imageReference: repository("ipam-frontend", "b"),
    imageId: `sha256:${digest("2")}`,
    targetPlatform: "linux/amd64",
    verification: "verified",
  },
  {
    imageName: "ipam-combined",
    dockerfile: "Dockerfile",
    dockerfileSha256: digest("3"),
    contextSha256: digest("4"),
    secretRequired: true,
    entrypoint: "sh /app/scripts/start-combined.sh",
    entrypointArgv: ["sh", "/app/scripts/start-combined.sh"],
    ports: { public: [3003], internal: [3001] },
    runtimeUid: 1000,
    registryDigest: repository("ipam-combined", "c"),
    imageReference: repository("ipam-combined", "c"),
    imageId: `sha256:${digest("3")}`,
    targetPlatform: "linux/amd64",
    verification: "verified",
  },
];

fs.writeFileSync(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  contextShaAlgorithm: "canonical-tar-v1",
  dockerVerification: { status: "VERIFIED" },
  images,
}, null, 2)}\n`);
NODE
}

mutate_manifest() {
  local path="$1"
  local mutation="$2"
  node - "$path" "$mutation" <<'NODE'
const fs = require("node:fs");

const [path, mutation] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path, "utf8"));

switch (mutation) {
  case "null-digest":
    manifest.images[0].registryDigest = null;
    break;
  case "wrong-repository":
    manifest.images[1].registryDigest =
      `ghcr.io/internetlink/ipam-backend@sha256:${"b".repeat(64)}`;
    break;
  case "wrong-topology":
    manifest.images.pop();
    break;
  case "interpolation":
    manifest.images[0].registryDigest = "${IMAGE_BACKEND}";
    break;
  case "secret-string":
    manifest.packageCredential = "HEROUI_AUTH_TOKEN";
    break;
  case "unknown-image-field":
    manifest.images[0].unexpected = true;
    break;
  case "schema-version":
    manifest.schemaVersion = 2;
    break;
  case "algorithm-drift":
    manifest.contextShaAlgorithm = "canonical-tar-v2";
    break;
  case "digest-reuse":
    manifest.images[1].registryDigest = manifest.images[0].registryDigest.replace("ipam-backend", "ipam-frontend");
    manifest.images[1].imageReference = manifest.images[1].registryDigest;
    break;
  case "verification-drift":
    manifest.images[1].verification = "static-only";
    break;
  default:
    process.exit(2);
}

fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
}

run_renderer() {
  local case_root="$1"
  local log_path="$2"
  node "$RENDERER" "$case_root/image-manifest.json" "$case_root/output" "$case_root/repository" \
    >"$log_path" 2>&1
}

run_release_manifest_verifier() {
  local case_root="$1"
  local log_path="$2"
  bash "$IMAGE_VERIFIER" --validate-release-manifest "$case_root/image-manifest.json" \
    >"$log_path" 2>&1
}

run_failure_case() {
  local name="$1"
  local mutation="$2"
  local case_root="$TEST_ROOT/$name"

  mkdir -p -- "$case_root/repository"
  write_manifest "$case_root/image-manifest.json"
  mutate_manifest "$case_root/image-manifest.json" "$mutation"
  if run_release_manifest_verifier "$case_root" "$case_root/image-verifier.log"; then
    fail "$name-image-map-accepted"
  fi
  if run_renderer "$case_root" "$case_root/render.log"; then
    fail "$name-accepted"
  fi
}

run_success_case() {
  local case_root="$TEST_ROOT/valid"
  local backend_digest
  local frontend_digest
  local combined_digest
  backend_digest="ghcr.io/internetlink/ipam-backend@sha256:$(printf 'a%.0s' {1..64})"
  frontend_digest="ghcr.io/internetlink/ipam-frontend@sha256:$(printf 'b%.0s' {1..64})"
  combined_digest="ghcr.io/internetlink/ipam-combined@sha256:$(printf 'c%.0s' {1..64})"

  mkdir -p -- "$case_root/repository"
  write_manifest "$case_root/image-manifest.json"
  if ! run_release_manifest_verifier "$case_root" "$case_root/image-verifier.log"; then
    cat "$case_root/image-verifier.log" >&2
    fail 'valid-image-map-rejected'
    return
  fi
  if ! run_renderer "$case_root" "$case_root/render.log"; then
    cat "$case_root/render.log" >&2
    fail 'valid-rejected'
    return
  fi

  [[ -f "$case_root/output/railway.ts" ]] || fail 'railway-output-missing'
  [[ -f "$case_root/output/zeabur.yaml" ]] || fail 'zeabur-output-missing'
  grep -Fq -- "source: image(\"$combined_digest\")" "$case_root/output/railway.ts" \
    || fail 'railway-combined-digest'
  grep -Fq -- "image: $backend_digest" "$case_root/output/zeabur.yaml" \
    || fail 'zeabur-backend-digest'
  grep -Fq -- "image: $frontend_digest" "$case_root/output/zeabur.yaml" \
    || fail 'zeabur-frontend-digest'
  [[ "$(grep -Fc -- '@sha256:' "$case_root/output/railway.ts")" -eq 1 ]] \
    || fail 'railway-digest-count'
  [[ "$(grep -Fc -- '@sha256:' "$case_root/output/zeabur.yaml")" -eq 2 ]] \
    || fail 'zeabur-digest-count'
  [[ "$(grep -Fc -- 'template: PREBUILT_V2' "$case_root/output/zeabur.yaml")" -eq 2 ]] \
    || fail 'zeabur-prebuilt-count'
  if grep -ERq -- '(\$\{IMAGE|HEROUI_AUTH_TOKEN|_authToken|npm_token)' "$case_root/output"; then
    fail 'generated-credential-or-interpolation'
  fi
}

run_legacy_case() {
  local case_root="$TEST_ROOT/legacy-config"

  mkdir -p -- "$case_root/repository"
  write_manifest "$case_root/image-manifest.json"
  printf '{}\n' >"$case_root/repository/railway.json"
  if run_renderer "$case_root" "$case_root/render.log"; then
    fail 'legacy-config-accepted'
  fi
}

run_release_mode_case() {
  local case_root="$TEST_ROOT/release-mode"

  mkdir -p -- "$case_root"
  if VERIFY_IMAGE_MAP_MODE=static \
    VERIFY_IMAGE_MAP_REQUIRE_REGISTRY_DIGEST=1 \
    IMAGE_MAP_OUTPUT="$case_root/image-manifest.json" \
    bash "$IMAGE_VERIFIER" >"$case_root/image-verifier.log" 2>&1; then
    fail 'release-mode-accepted-static-verification'
    return
  fi
  grep -Fq -- 'code=release-requires-docker-mode' "$case_root/image-verifier.log" \
    || fail 'release-mode-wrong-failure'
}

run_manifest_creation_cases() {
  local case_root="$TEST_ROOT/release-manifest"
  local failed_output="$case_root/failed.json"

  mkdir -p -- "$case_root"
  write_manifest "$case_root/release.json"
  node - "$case_root/release.json" "$case_root/local.json" "$case_root/bindings.json" <<'NODE'
const fs = require("node:fs");
const [releasePath, localPath, bindingsPath] = process.argv.slice(2);
const local = JSON.parse(fs.readFileSync(releasePath, "utf8"));
const bindings = {
  schemaVersion: 1,
  images: local.images.map(image => ({
    imageId: image.imageId,
    name: image.imageName,
    repositoryDigest: image.registryDigest,
  })),
};
for (const image of local.images) {
  image.imageReference = `${image.registryDigest.split("@")[0]}:commit-sha`;
  image.registryDigest = null;
}
fs.writeFileSync(localPath, `${JSON.stringify(local)}\n`);
fs.writeFileSync(bindingsPath, `${JSON.stringify(bindings)}\n`);
NODE

  if ! node "$RELEASE_MANIFEST" "$case_root/local.json" "$case_root/bindings.json" \
    "$case_root/generated.json" >"$case_root/create.log" 2>&1; then
    fail 'release-manifest-create-rejected'
    return
  fi
  if ! bash "$IMAGE_VERIFIER" --validate-release-manifest "$case_root/generated.json" \
    >"$case_root/generated-verify.log" 2>&1; then
    cat "$case_root/generated-verify.log" >&2
    fail 'generated-release-manifest-invalid'
  fi

  node - "$case_root/bindings.json" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
const bindings = JSON.parse(fs.readFileSync(path, "utf8"));
bindings.images[1].repositoryDigest = bindings.images[0].repositoryDigest.replace("ipam-backend", "ipam-frontend");
fs.writeFileSync(path, `${JSON.stringify(bindings)}\n`);
NODE
  if node "$RELEASE_MANIFEST" "$case_root/local.json" "$case_root/bindings.json" "$failed_output" \
    >"$case_root/create-failure.log" 2>&1; then
    fail 'release-manifest-digest-reuse-accepted'
  fi
  [[ ! -e "$failed_output" ]] || fail 'release-manifest-failure-left-output'
  if compgen -G "$case_root/.failed.json.*.tmp" >/dev/null; then
    fail 'release-manifest-failure-left-temp'
  fi
}

run_atomic_output_failure_case() {
  local case_root="$TEST_ROOT/atomic-output-failure"
  local output="$case_root/configs"

  mkdir -p -- "$case_root"
  if node --input-type=module - "$RENDERER" "$output" >"$case_root/fault.log" 2>&1 <<'NODE'
import {writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const [rendererPath, outputPath] = process.argv.slice(2);
const {commitPlatformConfigs} = await import(pathToFileURL(rendererPath));
let writes = 0;
await commitPlatformConfigs(outputPath, {railway: "railway\n", zeabur: "zeabur\n"}, async (...args) => {
  writes += 1;
  if (writes === 2) throw new Error("forced-second-output-failure");
  await writeFile(...args);
});
NODE
  then
    fail 'atomic-second-output-failure-accepted'
  fi
  [[ ! -e "$output" ]] || fail 'atomic-failure-left-final-set'
  if compgen -G "$case_root/.configs.*" >/dev/null; then
    fail 'atomic-failure-left-temporary-set'
  fi
  grep -Fq 'forced-second-output-failure' "$case_root/fault.log" \
    || fail 'atomic-failure-reason-absent'
}

main() {
  command -v node >/dev/null 2>&1 || {
    printf 'ENVIRONMENT_BLOCKED component=platform-renderer-tests reason=node-unavailable\n' >&2
    exit 2
  }

  TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/platform-renderer-test.XXXXXX")"
  run_success_case
  run_failure_case null-digest null-digest
  run_failure_case wrong-repository wrong-repository
  run_failure_case wrong-topology wrong-topology
  run_failure_case interpolation interpolation
  run_failure_case secret-string secret-string
  run_failure_case unknown-image-field unknown-image-field
  run_failure_case schema-version schema-version
  run_failure_case algorithm-drift algorithm-drift
  run_failure_case digest-reuse digest-reuse
  run_failure_case verification-drift verification-drift
  run_legacy_case
  run_release_mode_case
  run_manifest_creation_cases
  run_atomic_output_failure_case

  if [[ "$FAILURES" -ne 0 ]]; then
    printf 'PLATFORM_RENDERER_TESTS_FAILED count=%s\n' "$FAILURES" >&2
    exit 1
  fi
  printf 'PLATFORM_RENDERER_TESTS_OK cases=15\n'
}

main "$@"
