#!/usr/bin/env bash
set -euo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly CAPTURE_SCRIPT="$SCRIPT_DIR/capture-pushed-image-digests.sh"
TEST_TMPDIR=''

fail() {
  printf 'IMAGE_PUSH_BINDING_TEST_FAILED reason=%s\n' "$1" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  [[ -z "$TEST_TMPDIR" || ! -d "$TEST_TMPDIR" ]] || rm -rf -- "$TEST_TMPDIR"
  exit "$status"
}

write_manifest() {
  node - "$1" <<'NODE'
const fs = require('node:fs');
const output = process.argv[2];
const names = ['ipam-backend', 'ipam-combined', 'ipam-frontend'];
const images = names.map((name, index) => ({
  imageName: name,
  imageReference: `ghcr.io/example/${name}:commit-sha`,
  imageId: `sha256:${String(index + 1).repeat(64)}`,
}));
fs.writeFileSync(output, `${JSON.stringify({ images })}\n`);
NODE
}

write_fake_docker() {
  cat >"$TEST_TMPDIR/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail

state="${FAKE_DOCKER_STATE:?}"
mode="${FAKE_DOCKER_MODE:-success}"
command_name="${1:-}"
shift || true
printf '%s %s\n' "$command_name" "$*" >>"$state/calls"

image_index() {
  case "$1" in
    *ipam-backend*) printf '1' ;;
    *ipam-combined*) printf '2' ;;
    *ipam-frontend*) printf '3' ;;
    *) exit 91 ;;
  esac
}

repeat_digit() {
  local digit="$1"
  local value
  printf -v value '%*s' 64 ''
  printf '%s' "${value// /$digit}"
}

case "$command_name" in
  image)
    [[ "${1:-}" == inspect && "${2:-}" == --format ]] || exit 92
    reference="${4:-}"
    index="$(image_index "$reference")"
    if [[ "$reference" == *@sha256:* ]]; then
      if [[ "$mode" == identity-mismatch && "$index" == 2 ]]; then
        printf 'sha256:'
        printf '9%.0s' {1..64}
        printf '\n'
      else
        printf 'sha256:'
        repeat_digit "$index"
        printf '\n'
      fi
    elif [[ -f "$state/tag-overwritten-$index" ]]; then
      printf 'sha256:'
      printf '8%.0s' {1..64}
      printf '\n'
    else
      printf 'sha256:'
      repeat_digit "$index"
      printf '\n'
    fi
    ;;
  push)
    reference="${1:-}"
    index="$(image_index "$reference")"
    [[ "$mode" != push-fail || "$index" != 2 ]] || exit 1
    : >"$state/tag-overwritten-$index"
    if [[ "$mode" == parse-fail && "$index" == 2 ]]; then
      printf 'push completed without digest\n'
    else
      digit="$((index + 3))"
      digest="$(repeat_digit "$digit")"
      tag="${reference##*:}"
      printf '%s: digest: sha256:%s size: 1234\n' "$tag" "$digest"
    fi
    ;;
  pull)
    [[ "${1:-}" == *@sha256:* ]] || exit 93
    ;;
  *) exit 94 ;;
esac
FAKE_DOCKER
  chmod 0755 "$TEST_TMPDIR/bin/docker"
}

run_failure_case() {
  local mode="$1"
  local output="$TEST_TMPDIR/$mode.json"
  local status

  set +e
  PATH="$TEST_TMPDIR/bin:$PATH" FAKE_DOCKER_STATE="$TEST_TMPDIR/state" FAKE_DOCKER_MODE="$mode" \
    bash "$CAPTURE_SCRIPT" "$TEST_TMPDIR/local.json" "$output" >"$TEST_TMPDIR/$mode.log" 2>&1
  status=$?
  set -e
  [[ "$status" -eq 1 ]] || fail "$mode-status-$status"
  [[ ! -e "$output" ]] || fail "$mode-left-output"
}

main() {
  local output status
  TEST_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/image-push-binding-test.XXXXXX")"
  trap cleanup EXIT INT TERM
  mkdir -p "$TEST_TMPDIR/bin" "$TEST_TMPDIR/state"
  write_manifest "$TEST_TMPDIR/local.json"
  write_fake_docker

  output="$TEST_TMPDIR/bindings.json"
  if ! PATH="$TEST_TMPDIR/bin:$PATH" FAKE_DOCKER_STATE="$TEST_TMPDIR/state" \
    bash "$CAPTURE_SCRIPT" "$TEST_TMPDIR/local.json" "$output" >"$TEST_TMPDIR/success.log" 2>&1; then
    cat "$TEST_TMPDIR/success.log" >&2
    fail 'tag-overwrite-case-failed'
  fi
  node - "$output" <<'NODE' || fail 'binding-content-invalid'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.schemaVersion !== 1 || value.images.length !== 3) process.exit(1);
for (const [index, image] of value.images.entries()) {
  const digit = String(index + 4);
  if (image.repositoryDigest !== `ghcr.io/example/${image.name}@sha256:${digit.repeat(64)}`) process.exit(1);
  if (!/^sha256:[1-3]{64}$/.test(image.imageId)) process.exit(1);
}
NODE
  grep -q '^pull ghcr.io/example/ipam-backend@sha256:' "$TEST_TMPDIR/state/calls" \
    || fail 'immutable-pull-absent'
  if grep -Eq '^pull .*:commit-sha$|imagetools' "$TEST_TMPDIR/state/calls"; then
    fail 'mutable-reference-used-after-push'
  fi

  rm -f "$TEST_TMPDIR/state"/tag-overwritten-* "$output"
  : >"$TEST_TMPDIR/state/calls"
  run_failure_case identity-mismatch
  rm -f "$TEST_TMPDIR/state"/tag-overwritten-*
  run_failure_case parse-fail
  rm -f "$TEST_TMPDIR/state"/tag-overwritten-*
  run_failure_case push-fail

  printf 'IMAGE_PUSH_BINDING_TESTS_OK\n'
}

main "$@"
