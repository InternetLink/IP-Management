#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly PROTECTION_SCRIPT="$ROOT_DIR/scripts/verify-github-protection.sh"
readonly FRESHNESS_WINDOW_SECONDS=600

# Reviewer verdict contract for the final verification wave.
#
# `aggregate` approves only when all four documents below exist directly inside
# the attempt directory as regular, non-symlink files, and each one uses this
# exact machine-readable format:
#
#   line 1              `VERDICT: APPROVE`            (exact, nothing before it)
#   artifact binding    `Artifact SHA-256: <hash>`    (must equal final-artifact.sha256)
#   command marker(s)   `Command: <text> | exit=0`    (at least one; every
#                                                      `Command:` line must end
#                                                      with ` | exit=0`)
#   evidence marker(s)  `Evidence: <path>`            (at least one; every
#                                                      `Evidence:` line must
#                                                      carry a path)
#
# Evidence paths are canonicalized (relative paths resolve against the attempt
# directory, symlinks are followed) and must exist inside the attempt directory.
# Absolute and relative paths are both accepted as long as the canonical target
# stays inside the attempt directory; any path resolving outside it is rejected,
# including `..` traversal and symlinks pointing elsewhere.
# Any violation is an INCONCLUSIVE release result, never an approval.
readonly REVIEWER_VERDICT_FILES=(
  'final-F1-compliance.md'
  'final-F2-quality.md'
  'final-F3-manual-qa.md'
  'final-F4-scope.md'
)

TEMP_DIR=""
ATTEMPT_DIR=""
REVIEWER_VERDICT_HASHES=()

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
  exit "$status"
}

fail() {
  printf 'FINAL_VERIFICATION_FAILED code=%s\n' "$1" >&2
  exit 1
}

environment_blocked() {
  local reason="$1"
  if [[ -n "${ATTEMPT_DIR:-}" ]]; then
    mkdir -p -- "$ATTEMPT_DIR"
    cat > "$ATTEMPT_DIR/final-verdict.md" <<EOF
VERDICT: INCONCLUSIVE

Reason: $reason
EOF
  fi
  printf 'ENVIRONMENT_BLOCKED component=final-verification reason=%s\n' "$reason" >&2
  exit 2
}

inconclusive() {
  local reason="$1"
  if [[ -n "${ATTEMPT_DIR:-}" ]]; then
    mkdir -p -- "$ATTEMPT_DIR"
    cat > "$ATTEMPT_DIR/final-verdict.md" <<EOF
VERDICT: INCONCLUSIVE

Reason: $reason
EOF
  fi
  printf 'VERDICT: INCONCLUSIVE reason=%s\n' "$reason" >&2
  exit 2
}

usage() {
  printf 'Usage: %s init <attempt-directory> | aggregate <attempt-directory>\n' "${BASH_SOURCE[0]}" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || environment_blocked "command-unavailable-$1"
}

validate_attempt_directory() {
  ATTEMPT_DIR="$(cd -- "$1" 2>/dev/null && pwd)" || {
    mkdir -p -- "$1" || fail 'attempt-directory-unavailable'
    ATTEMPT_DIR="$(cd -- "$1" && pwd)"
  }
}

artifact_hash() {
  local attempt_relative=''
  local -a tar_args=(
    --sort=name
    --mtime='UTC 1970-01-01'
    --owner=0
    --group=0
    --numeric-owner
    --exclude='./.git'
    --exclude='./.omo'
    --exclude='./.sisyphus'
    --exclude='./.cortexkit'
    --exclude='./.cache'
    --exclude='*/node_modules'
    --exclude='*/dist'
    --exclude='*/.next'
    --exclude='*/build'
    --exclude='*/coverage'
    --exclude='*.tsbuildinfo'
    --exclude='*/.env'
    --exclude='*/.env.*'
    --exclude='*.pem'
    --exclude='*.key'
    --exclude='*.log'
  )

  case "$ATTEMPT_DIR" in
    "$ROOT_DIR"/*)
      attempt_relative="${ATTEMPT_DIR#"$ROOT_DIR/"}"
      tar_args+=("--exclude=./$attempt_relative")
      ;;
  esac

  tar "${tar_args[@]}" -cf - -C "$ROOT_DIR" . | sha256sum | awk '{ print $1 }'
}

write_final_helpers() {
  cat > "$TEMP_DIR/final-json.cjs" <<'NODE'
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function evidenceText(path) {
  return fs.readFileSync(path, 'utf8').trim();
}

function evidenceHash(path) {
  return crypto.createHash('sha256').update(evidenceText(path), 'utf8').digest('hex');
}

function freshness(evidence) {
  const requiredQueries = ['branch', 'commit', 'environment', 'protection', 'repository', 'workflow'];
  const queryTimestamps = evidence.queryTimestamps || {};
  const timestamps = requiredQueries.map(key => Date.parse(queryTimestamps[key] || ''));
  timestamps.push(Date.parse(evidence.queriedAt || ''));
  if (timestamps.some(value => !Number.isFinite(value))) return false;
  const now = Date.now();
  return timestamps.every(value => Math.abs(now - value) <= 600 * 1000);
}

function projection(evidence) {
  const copy = JSON.parse(JSON.stringify(evidence));
  delete copy.queryTimestamps;
  delete copy.queriedAt;
  delete copy.verdict;
  return canonical(copy);
}

function fail(reason) {
  process.stdout.write(JSON.stringify({ ok: false, reason }));
  process.exit(2);
}

const mode = process.argv[2];
if (mode === 'init') {
  const [evidencePath, initPath, artifactSha256] = process.argv.slice(3);
  const evidence = readJson(evidencePath);
  const record = canonical({
    schemaVersion: 1,
    repositoryId: evidence.repositoryId,
    repositoryName: evidence.repositoryName,
    ref: evidence.ref,
    commitSha: evidence.commitSha,
    workflowPath: evidence.workflowPath,
    workflowSha: evidence.workflowSha,
    protectionFields: projection(evidence),
    protectionEvidenceSha256: evidenceHash(evidencePath),
    artifactSha256,
    initializedAt: new Date().toISOString(),
  });
  fs.writeFileSync(initPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify(record));
  process.exit(0);
}

if (mode !== 'aggregate') fail('invalid-mode');

const [initPath, initialEvidencePath, recheckEvidencePath, artifactSha256, currentArtifactSha256] = process.argv.slice(3);
const init = readJson(initPath);
const initial = readJson(initialEvidencePath);
const recheck = readJson(recheckEvidencePath);

if (artifactSha256 !== currentArtifactSha256) fail('artifact-drift');
if (init.artifactSha256 !== artifactSha256) fail('initialized-artifact-drift');
if (!freshness(initial) || !freshness(recheck)) fail('protection-evidence-stale');
if (initial.verdict !== 'MATCH' || recheck.verdict !== 'MATCH') fail('protection-verdict-not-match');
if (JSON.stringify(projection(initial)) !== JSON.stringify(projection(recheck))) fail('protection-fields-drift');
if (init.repositoryId !== recheck.repositoryId || init.repositoryName !== recheck.repositoryName) fail('repository-drift');
if (init.ref !== recheck.ref || init.commitSha !== recheck.commitSha) fail('ref-or-commit-drift');
if (init.workflowPath !== recheck.workflowPath || init.workflowSha !== recheck.workflowSha) fail('workflow-drift');
if (init.protectionEvidenceSha256 !== evidenceHash(initialEvidencePath)) fail('initial-evidence-hash-drift');
if (init.protectionFields && JSON.stringify(init.protectionFields) !== JSON.stringify(projection(initial))) {
  fail('initial-protection-fields-drift');
}

process.stdout.write(JSON.stringify({
  ok: true,
  repositoryId: recheck.repositoryId,
  repositoryName: recheck.repositoryName,
  ref: recheck.ref,
  commitSha: recheck.commitSha,
  workflowSha: recheck.workflowSha,
  artifactSha256,
  protectionEvidenceSha256: evidenceHash(recheckEvidencePath),
}));
NODE
}

run_protection_verifier() {
  local evidence_path="$1"
  local log_path="$2"
  local status

  set +e
  bash "$PROTECTION_SCRIPT" --evidence "$evidence_path" >"$log_path" 2>&1
  status=$?
  set -e
  return "$status"
}

init_command() {
  local evidence_path
  local init_path
  local artifact_path
  local artifact_sha
  local status

  [[ -n "${GITHUB_REPOSITORY:-}" ]] || environment_blocked 'repository-unavailable'
  [[ -n "${GITHUB_REF:-}" ]] || environment_blocked 'ref-unavailable'
  [[ -n "${GITHUB_SHA:-}" ]] || environment_blocked 'commit-unavailable'

  evidence_path="$ATTEMPT_DIR/github-protection.json"
  init_path="$ATTEMPT_DIR/final-init.json"
  artifact_path="$ATTEMPT_DIR/final-artifact.sha256"
  if run_protection_verifier "$evidence_path" "$TEMP_DIR/protection-init.log"; then
    status=0
  else
    status=$?
  fi
  if [[ "$status" -eq 2 ]]; then
    environment_blocked 'github-protection-unavailable'
  fi
  [[ "$status" -eq 0 ]] || inconclusive 'github-protection-mismatch'

  artifact_sha="$(artifact_hash)"
  printf '%s\n' "$artifact_sha" > "$artifact_path"
  if ! node "$TEMP_DIR/final-json.cjs" init "$evidence_path" "$init_path" "$artifact_sha" > "$TEMP_DIR/init-result.json"; then
    fail 'initial-binding-write-failed'
  fi
  printf 'FINAL_INIT_OK artifact_sha256=%s evidence=%s\n' "$artifact_sha" "$evidence_path"
}

# Resolve one evidence path to its canonical location, or fail with empty output.
# Relative paths resolve against the attempt directory; symlinks are followed so
# a link pointing outside the attempt directory cannot pass the containment test.
canonical_evidence_path() {
  local raw="$1"
  local candidate

  case "$raw" in
    /*) candidate="$raw" ;;
    *) candidate="$ATTEMPT_DIR/$raw" ;;
  esac
  realpath -e -- "$candidate" 2>/dev/null
}

# Enforce the reviewer verdict contract documented next to REVIEWER_VERDICT_FILES.
# Populates REVIEWER_VERDICT_HASHES on success; any violation exits 2 through
# inconclusive() and never returns.
validate_reviewer_verdicts() {
  local bound_sha="$1"
  local verdict_file
  local verdict_path
  local normalized
  local first_line
  local command_lines
  local approved_commands
  local evidence_lines
  local evidence_count
  local evidence_raw
  local evidence_resolved

  REVIEWER_VERDICT_HASHES=()

  for verdict_file in "${REVIEWER_VERDICT_FILES[@]}"; do
    verdict_path="$ATTEMPT_DIR/$verdict_file"
    normalized="$TEMP_DIR/reviewer-$verdict_file"

    [[ -L "$verdict_path" ]] && inconclusive "reviewer-verdict-symlink-$verdict_file"
    [[ -f "$verdict_path" ]] || inconclusive "reviewer-verdict-missing-$verdict_file"

    tr -d '\r' < "$verdict_path" > "$normalized"

    first_line="$(head -n 1 -- "$normalized")"
    [[ "$first_line" == 'VERDICT: APPROVE' ]] || inconclusive "reviewer-verdict-not-approve-$verdict_file"

    grep -Fxq -e "Artifact SHA-256: $bound_sha" -- "$normalized" \
      || inconclusive "reviewer-verdict-artifact-binding-$verdict_file"

    command_lines="$(grep -c '^Command:' -- "$normalized" || true)"
    approved_commands="$(grep -cE '^Command: .+ \| exit=0$' -- "$normalized" || true)"
    [[ "$command_lines" -ge 1 ]] || inconclusive "reviewer-verdict-command-marker-missing-$verdict_file"
    [[ "$command_lines" -eq "$approved_commands" ]] \
      || inconclusive "reviewer-verdict-command-not-exit-zero-$verdict_file"
    [[ "$approved_commands" -ge 1 ]] || inconclusive "reviewer-verdict-command-marker-missing-$verdict_file"

    evidence_lines="$(grep -c '^Evidence:' -- "$normalized" || true)"
    [[ "$evidence_lines" -ge 1 ]] || inconclusive "reviewer-verdict-evidence-marker-missing-$verdict_file"
    evidence_count=0
    while IFS= read -r evidence_raw; do
      evidence_raw="${evidence_raw%"${evidence_raw##*[![:space:]]}"}"
      [[ -n "$evidence_raw" ]] || inconclusive "reviewer-verdict-evidence-marker-empty-$verdict_file"
      evidence_count=$((evidence_count + 1))
      evidence_resolved="$(canonical_evidence_path "$evidence_raw" || true)"
      [[ -n "$evidence_resolved" ]] || inconclusive "reviewer-verdict-evidence-unresolved-$verdict_file"
      case "$evidence_resolved" in
        "$ATTEMPT_DIR" | "$ATTEMPT_DIR"/*) ;;
        *) inconclusive "reviewer-verdict-evidence-outside-attempt-$verdict_file" ;;
      esac
      [[ -e "$evidence_resolved" ]] || inconclusive "reviewer-verdict-evidence-unresolved-$verdict_file"
    done < <(sed -n 's/^Evidence:[[:space:]]\{1,\}//p' -- "$normalized")
    [[ "$evidence_count" -ge 1 ]] || inconclusive "reviewer-verdict-evidence-marker-missing-$verdict_file"
    [[ "$evidence_lines" -eq "$evidence_count" ]] \
      || inconclusive "reviewer-verdict-evidence-marker-malformed-$verdict_file"

    REVIEWER_VERDICT_HASHES+=("$(sha256sum -- "$verdict_path" | awk '{ print $1 }')")
  done
}

aggregate_command() {
  local initial_evidence="$ATTEMPT_DIR/github-protection.json"
  local recheck_evidence="$ATTEMPT_DIR/github-protection-recheck.json"
  local init_path="$ATTEMPT_DIR/final-init.json"
  local artifact_path="$ATTEMPT_DIR/final-artifact.sha256"
  local artifact_sha
  local recorded_artifact_sha
  local status
  local result
  local verdict_sha
  local reviewer_block=''
  local reviewer_index

  [[ -f "$init_path" ]] || inconclusive 'missing-final-init'
  [[ -f "$initial_evidence" ]] || inconclusive 'missing-initial-protection-evidence'
  [[ -f "$artifact_path" ]] || inconclusive 'missing-final-artifact-hash'
  recorded_artifact_sha="$(tr -d '[:space:]' < "$artifact_path")"
  artifact_sha="$(artifact_hash)"
  [[ "$recorded_artifact_sha" == "$artifact_sha" ]] || inconclusive 'artifact-drift'

  if run_protection_verifier "$recheck_evidence" "$TEMP_DIR/protection-recheck.log"; then
    status=0
  else
    status=$?
  fi
  if [[ "$status" -eq 2 ]]; then
    environment_blocked 'github-protection-recheck-unavailable'
  fi
  [[ "$status" -eq 0 ]] || inconclusive 'github-protection-recheck-mismatch'

  set +e
  result="$(node "$TEMP_DIR/final-json.cjs" aggregate \
    "$init_path" \
    "$initial_evidence" \
    "$recheck_evidence" \
    "$recorded_artifact_sha" \
    "$artifact_sha" 2>"$TEMP_DIR/aggregate.error")"
  status=$?
  set -e
  printf '%s\n' "$result" > "$TEMP_DIR/aggregate-result.json"
  if [[ "$status" -eq 2 ]]; then
    inconclusive "$(node - "$TEMP_DIR/aggregate-result.json" <<'NODE'
const fs = require('node:fs');
try {
  const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(value.reason || 'protection-recheck-failed');
} catch {
  process.stdout.write('protection-recheck-failed');
}
NODE
    )"
  fi
  [[ "$status" -eq 0 ]] || inconclusive 'aggregate-failed'

  validate_reviewer_verdicts "$recorded_artifact_sha"
  for reviewer_index in "${!REVIEWER_VERDICT_FILES[@]}"; do
    reviewer_block+="Reviewer verdict ${REVIEWER_VERDICT_FILES[$reviewer_index]} SHA-256: ${REVIEWER_VERDICT_HASHES[$reviewer_index]}"$'\n'
  done
  reviewer_block="${reviewer_block%$'\n'}"

  cat > "$ATTEMPT_DIR/final-verdict.md" <<EOF
VERDICT: APPROVE

Repository: $(node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(value.repositoryName);' "$TEMP_DIR/aggregate-result.json")
Ref: $(node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(value.ref);' "$TEMP_DIR/aggregate-result.json")
Commit: $(node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(value.commitSha);' "$TEMP_DIR/aggregate-result.json")
Workflow SHA: $(node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(value.workflowSha);' "$TEMP_DIR/aggregate-result.json")
Artifact SHA-256: $recorded_artifact_sha
Protection evidence: $initial_evidence
Protection recheck: $recheck_evidence
${reviewer_block}
EOF
  verdict_sha="$(sha256sum "$ATTEMPT_DIR/final-verdict.md" | awk '{ print $1 }')"
  printf '%s\n' "$verdict_sha" > "$ATTEMPT_DIR/final-verdict.sha256"
  printf 'FINAL_VERDICT_OK sha256=%s\n' "$verdict_sha"
}

main() {
  local command_name="${1:-}"
  [[ "$#" -eq 2 ]] || { usage; exit 2; }
  case "$command_name" in
    init|aggregate)
      ;;
    *)
      usage
      exit 2
      ;;
  esac
  require_command awk
  require_command date
  require_command grep
  require_command head
  require_command mkdir
  require_command node
  require_command realpath
  require_command rm
  require_command sed
  require_command sha256sum
  require_command tar
  require_command tr
  require_command mktemp
  [[ -x "$PROTECTION_SCRIPT" ]] || fail 'missing-protection-script'
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam-final.XXXXXX")"
  write_final_helpers
  validate_attempt_directory "$2"
  if [[ "$command_name" == init ]]; then
    init_command
  else
    aggregate_command
  fi
}

# Executing the script runs the CLI exactly as before. Sourcing it only defines
# the functions, so individual verifiers can be exercised in isolation.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  trap cleanup EXIT INT TERM
  main "$@"
fi
