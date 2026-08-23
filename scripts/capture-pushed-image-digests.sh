#!/usr/bin/env bash
set -euo pipefail

umask 077

SCRIPT_NAME="$(basename -- "$0")"
readonly SCRIPT_NAME
TEMP_DIR=''

fail() {
  printf 'IMAGE_PUSH_BINDING_FAILED reason=%s\n' "$1" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
  exit "$status"
}

usage() {
  printf 'Usage: %s LOCAL_IMAGE_MANIFEST OUTPUT_BINDINGS\n' "$SCRIPT_NAME" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "command-unavailable-$1"
}

extract_push_digest() {
  local push_log="$1"
  node - "$push_log" <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const matches = [...text.matchAll(/(?:^|\n)digest:\s*(sha256:[0-9a-f]{64})\s+size:\s*[0-9]+(?:\r?\n|$)/g)]
  .map(match => match[1]);
const unique = [...new Set(matches)];
if (unique.length !== 1) process.exit(1);
process.stdout.write(unique[0]);
NODE
}

main() {
  local local_manifest="${1:-}"
  local output_path="${2:-}"
  local output_dir output_tmp rows_path bindings_path
  local name image_reference expected_image_id repository
  local actual_image_id digest immutable_reference pulled_image_id push_log
  local -a image_rows=()

  [[ "$#" -eq 2 ]] || { usage; exit 2; }
  [[ -f "$local_manifest" ]] || fail 'local-manifest-absent'
  [[ -n "$output_path" ]] || fail 'output-path-empty'

  require_command docker
  require_command mktemp
  require_command mv
  require_command node
  require_command rm
  require_command sync

  output_dir="$(dirname -- "$output_path")"
  mkdir -p -- "$output_dir"
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/image-push-binding.XXXXXX")"
  rows_path="$TEMP_DIR/images.tsv"
  bindings_path="$TEMP_DIR/bindings.tsv"
  trap cleanup EXIT INT TERM

  if ! node - "$local_manifest" >"$rows_path" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expectedNames = ['ipam-backend', 'ipam-combined', 'ipam-frontend'];
if (!Array.isArray(manifest.images) || manifest.images.length !== expectedNames.length) process.exit(1);
const images = [...manifest.images].sort((left, right) => String(left.imageName).localeCompare(String(right.imageName)));
if (images.some((image, index) => image.imageName !== expectedNames[index])) process.exit(1);
for (const image of images) {
  if (!/^sha256:[0-9a-f]{64}$/.test(image.imageId)) process.exit(1);
  if (typeof image.imageReference !== 'string' || image.imageReference.includes('@') || !/:[^/]+$/.test(image.imageReference)) {
    process.exit(1);
  }
  for (const value of [image.imageName, image.imageReference, image.imageId]) {
    if (/[\t\r\n]/.test(value)) process.exit(1);
  }
  process.stdout.write(`${image.imageName}\t${image.imageReference}\t${image.imageId}\n`);
}
NODE
  then
    fail 'local-manifest-invalid'
  fi

  mapfile -t image_rows <"$rows_path"
  [[ "${#image_rows[@]}" -eq 3 ]] || fail 'local-image-count-invalid'

  : >"$bindings_path"
  for row in "${image_rows[@]}"; do
    IFS=$'\t' read -r name image_reference expected_image_id <<<"$row"
    repository="${image_reference%:*}"
    [[ "$repository" == */"$name" ]] || fail "repository-name-mismatch-$name"

    actual_image_id="$(docker image inspect --format '{{.Id}}' "$image_reference")" \
      || fail "local-image-inspect-failed-$name"
    if [[ "$actual_image_id" != "$expected_image_id" ]]; then
      printf 'IMAGE_PUSH_BINDING_IDENTITY expected=%s actual=%s image=%s\n' \
        "$expected_image_id" "$actual_image_id" "$name" >&2
      fail "local-image-identity-mismatch-$name"
    fi

    push_log="$TEMP_DIR/$name.push.log"
    if ! docker push "$image_reference" >"$push_log" 2>&1; then
      fail "push-failed-$name"
    fi
    digest="$(extract_push_digest "$push_log")" || fail "push-digest-invalid-$name"
    immutable_reference="$repository@$digest"

    docker pull "$immutable_reference" >/dev/null \
      || fail "immutable-pull-failed-$name"
    pulled_image_id="$(docker image inspect --format '{{.Id}}' "$immutable_reference")" \
      || fail "immutable-image-inspect-failed-$name"
    [[ "$pulled_image_id" == "$expected_image_id" ]] \
      || fail "immutable-image-identity-mismatch-$name"

    printf '%s\t%s\t%s\n' "$name" "$expected_image_id" "$immutable_reference" >>"$bindings_path"
  done

  output_tmp="$(mktemp "$output_dir/.push-bindings.XXXXXX")"
  if ! node - "$bindings_path" >"$output_tmp" <<'NODE'
const fs = require('node:fs');
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean);
const images = rows.map(row => {
  const [name, imageId, repositoryDigest] = row.split('\t');
  return { imageId, name, repositoryDigest };
});
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, images })}\n`);
NODE
  then
    rm -f -- "$output_tmp"
    fail 'binding-serialization-failed'
  fi
  chmod 0600 "$output_tmp"
  sync -f "$output_tmp"
  mv -f -- "$output_tmp" "$output_path"
  sync -f "$output_dir"

  printf 'IMAGE_PUSH_BINDING_OK output=%s\n' "$output_path"
}

main "$@"
