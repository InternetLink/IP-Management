#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORTEX_PROBE_DIR="$ROOT_DIR/.cortexkit/artifact-hash-test-$$"
TSC_PROBE="$ROOT_DIR/frontend/artifact-hash-test-$$.tsbuildinfo"
PRODUCT_PROBE="$ROOT_DIR/scripts/.artifact-hash-test-$$.txt"

cleanup_artifact_hash_probes() {
  rm -rf -- "$CORTEX_PROBE_DIR"
  rm -f -- "$TSC_PROBE" "$PRODUCT_PROBE"
}
trap cleanup_artifact_hash_probes EXIT INT TERM

# shellcheck disable=SC1090
source "$ROOT_DIR/scripts/verify-final.sh"
export ATTEMPT_DIR="$ROOT_DIR/.omo/artifact-hash-test"

baseline_hash="$(artifact_hash)"

mkdir -p -- "$CORTEX_PROBE_DIR"
printf 'session metadata\n' > "$CORTEX_PROBE_DIR/state.xml"
printf 'incremental compiler state\n' > "$TSC_PROBE"

generated_output_hash="$(artifact_hash)"
[[ "$generated_output_hash" == "$baseline_hash" ]] \
  || fail 'generated-output-changed-artifact-hash'

printf 'product probe\n' > "$PRODUCT_PROBE"
product_change_hash="$(artifact_hash)"
[[ "$product_change_hash" != "$baseline_hash" ]] \
  || fail 'product-file-did-not-change-artifact-hash'

printf 'FINAL_ARTIFACT_HASH_TESTS_OK\n'
