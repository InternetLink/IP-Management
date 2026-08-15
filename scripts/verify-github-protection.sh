#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly RELEASE_ENVIRONMENT='release'
readonly REQUIRED_CHECK_NAME="${RELEASE_GATE_CHECK_NAME:-release-gate}"

TEMP_DIR=""
EVIDENCE_PATH=""
REPOSITORY=""
COMMIT_SHA=""
REF_NAME=""
DEFAULT_BRANCH=""
WORKFLOW_PATH=""

declare -A API_BODY_PATH=()
declare -A API_ETAG=()
declare -A API_TIMESTAMP=()

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM

fail() {
  printf 'GITHUB_PROTECTION_MISMATCH code=%s\n' "$1" >&2
  exit 1
}

environment_blocked() {
  printf 'ENVIRONMENT_BLOCKED component=github-protection reason=%s\n' "$1" >&2
  exit 2
}

usage() {
  printf 'Usage: %s [--evidence <path>] [OWNER/REPO]\n' "${BASH_SOURCE[0]}" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || environment_blocked "command-unavailable-$1"
}

require_git_repository() {
  git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || environment_blocked 'not-a-git-repository'
}

validate_repository() {
  [[ "$1" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || environment_blocked 'invalid-repository'
}

resolve_repository() {
  local argument_repository="${1:-}"

  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    REPOSITORY="$GITHUB_REPOSITORY"
  elif [[ -n "$argument_repository" ]]; then
    REPOSITORY="$argument_repository"
  elif [[ -n "${OWNER:-}" && -n "${REPO:-}" ]]; then
    REPOSITORY="$OWNER/$REPO"
  else
    environment_blocked 'repository-unavailable'
  fi
  validate_repository "$REPOSITORY"
}

resolve_context() {
  COMMIT_SHA="${GITHUB_SHA:-}"
  REF_NAME="${GITHUB_REF:-}"
  [[ -n "$COMMIT_SHA" ]] || environment_blocked 'commit-unavailable'
  [[ "$COMMIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || environment_blocked 'commit-invalid'
  COMMIT_SHA="${COMMIT_SHA,,}"
  [[ -n "$REF_NAME" ]] || environment_blocked 'ref-unavailable'

  WORKFLOW_PATH="${PROTECTION_WORKFLOW_PATH:-}"
  if [[ -z "$WORKFLOW_PATH" && -n "${GITHUB_WORKFLOW_REF:-}" ]]; then
    local workflow_ref="$GITHUB_WORKFLOW_REF"
    if [[ "$workflow_ref" == "$REPOSITORY/"* ]]; then
      workflow_ref="${workflow_ref#"$REPOSITORY/"}"
      WORKFLOW_PATH="${workflow_ref%@*}"
    fi
  fi
  WORKFLOW_PATH="${WORKFLOW_PATH:-.github/workflows/ci.yml}"
  [[ "$WORKFLOW_PATH" == .github/workflows/* ]] || environment_blocked 'workflow-path-invalid'
  [[ "$WORKFLOW_PATH" != *'..'* && "$WORKFLOW_PATH" != *$'\n'* ]] || environment_blocked 'workflow-path-invalid'
}

check_authentication() {
  if [[ -z "${GH_TOKEN:-}" && -n "${GITHUB_TOKEN:-}" ]]; then
    export GH_TOKEN="$GITHUB_TOKEN"
  fi
  gh auth status >/dev/null 2>&1 || environment_blocked 'gh-auth-unavailable'
}

write_response_parser() {
  cat > "$TEMP_DIR/parse-gh-response.cjs" <<'NODE'
'use strict';

const fs = require('node:fs');

const [rawPath, bodyPath, metadataPath] = process.argv.slice(2);
const raw = fs.readFileSync(rawPath, 'utf8');
const statusMatches = [...raw.matchAll(/^HTTP\/[^\s]+\s+(\d{3})[^\r\n]*$/gm)];
let status = 200;
let headers = '';
let body = raw;

if (statusMatches.length > 0) {
  const start = statusMatches.at(-1).index;
  const block = raw.slice(start);
  const separator = block.search(/\r?\n\r?\n/);
  if (separator < 0) process.exit(2);
  const separatorLength = block[separator] === '\r' ? 4 : 2;
  status = Number(statusMatches.at(-1)[1]);
  headers = block.slice(0, separator);
  body = block.slice(separator + separatorLength).trim();
}

let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  process.exit(2);
}

let etag = null;
for (const line of headers.split(/\r?\n/)) {
  const separator = line.indexOf(':');
  if (separator >= 0 && line.slice(0, separator).toLowerCase() === 'etag') {
    etag = line.slice(separator + 1).trim();
  }
}

fs.writeFileSync(bodyPath, `${JSON.stringify(parsed)}\n`, { encoding: 'utf8', mode: 0o600 });
fs.writeFileSync(metadataPath, JSON.stringify({ status, etag }), { encoding: 'utf8', mode: 0o600 });
NODE
}

api_metadata_value() {
  local metadata_path="$1"
  local field="$2"
  node - "$metadata_path" "$field" <<'NODE'
const fs = require('node:fs');
const [metadataPath, field] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
process.stdout.write(metadata[field] === null || metadata[field] === undefined ? '' : String(metadata[field]));
NODE
}

api_call() {
  local key="$1"
  local endpoint="$2"
  local raw_path="$TEMP_DIR/$key.raw"
  local error_path="$TEMP_DIR/$key.error"
  local body_path="$TEMP_DIR/$key.json"
  local metadata_path="$TEMP_DIR/$key.metadata.json"
  local query_timestamp
  local status

  query_timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  if ! gh api \
    --include \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    "$endpoint" >"$raw_path" 2>"$error_path"; then
    environment_blocked "api-$key-unavailable"
  fi
  if ! node "$TEMP_DIR/parse-gh-response.cjs" "$raw_path" "$body_path" "$metadata_path" >/dev/null 2>&1; then
    environment_blocked "api-$key-invalid"
  fi
  status="$(api_metadata_value "$metadata_path" status)"
  if [[ ! "$status" =~ ^2[0-9][0-9]$ ]]; then
    environment_blocked "api-$key-status-$status"
  fi

  API_BODY_PATH["$key"]="$body_path"
  API_ETAG["$key"]="$(api_metadata_value "$metadata_path" etag)"
  API_TIMESTAMP["$key"]="$query_timestamp"
}

json_field() {
  local json_path="$1"
  local expression="$2"
  node - "$json_path" "$expression" <<'NODE'
const fs = require('node:fs');

const [jsonPath, expression] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const fields = expression.split('.');
let current = value;
for (const field of fields) current = current?.[field];
if (current === undefined || current === null) process.exit(2);
if (typeof current === 'object') process.stdout.write(JSON.stringify(current));
else process.stdout.write(String(current));
NODE
}

url_encode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
}

write_evidence_builder() {
  cat > "$TEMP_DIR/build-evidence.cjs" <<'NODE'
'use strict';

const fs = require('node:fs');

const [repositoryPath, branchPath, commitPath, workflowPath, protectionPath, environmentPath] = process.argv.slice(2);
const repository = JSON.parse(fs.readFileSync(repositoryPath, 'utf8'));
const branch = JSON.parse(fs.readFileSync(branchPath, 'utf8'));
const commit = JSON.parse(fs.readFileSync(commitPath, 'utf8'));
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const protection = JSON.parse(fs.readFileSync(protectionPath, 'utf8'));
const environment = JSON.parse(fs.readFileSync(environmentPath, 'utf8'));

const commitSha = String(process.env.COMMIT_SHA || '').toLowerCase();
const ref = process.env.REF_NAME || '';
const defaultBranch = repository.default_branch;
const requiredCheckName = process.env.REQUIRED_CHECK_NAME || 'release-gate';
const workflowPathName = process.env.WORKFLOW_PATH || '';

function required(value, name) {
  if (value === undefined || value === null || value === '') {
    process.stderr.write(`missing-${name}\n`);
    process.exit(2);
  }
  return value;
}

function booleanValue(value) {
  return value === true;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value !== undefined && value !== null && value !== '').map(String))].sort();
}

const repositoryId = required(repository.id, 'repository-id');
const repositoryName = required(repository.full_name, 'repository-name');
const branchName = required(defaultBranch, 'default-branch');
const branchHeadSha = String(required(branch.commit?.sha, 'branch-head-sha')).toLowerCase();
const resolvedCommitSha = String(required(commit.sha, 'commit-sha')).toLowerCase();
const workflowSha = String(required(workflow.sha, 'workflow-sha')).toLowerCase();
const workflowApiPath = required(workflow.path, 'workflow-path');
const branchProtectedValue = required(branch.protected, 'branch-protected');
if (!Number.isSafeInteger(Number(repositoryId)) || Number(repositoryId) < 1) {
  process.stderr.write('invalid-repository-id\n');
  process.exit(2);
}
if (!Number.isSafeInteger(Number(environment.id)) || Number(environment.id) < 1) {
  process.stderr.write('invalid-environment-id\n');
  process.exit(2);
}
if (!/^[0-9a-f]{40}$/.test(branchHeadSha) || !/^[0-9a-f]{40}$/.test(resolvedCommitSha)) {
  process.stderr.write('invalid-commit-sha\n');
  process.exit(2);
}
if (!/^[0-9a-f]{40}$/.test(workflowSha)) {
  process.stderr.write('invalid-workflow-sha\n');
  process.exit(2);
}
const protectionRules = protection.required_status_checks;
const requiredChecks = uniqueSorted([
  ...(Array.isArray(protectionRules?.contexts) ? protectionRules.contexts : []),
  ...(Array.isArray(protectionRules?.checks) ? protectionRules.checks.map(check => check?.context) : []),
]);
const reviewCount = Number(protection.required_pull_request_reviews?.required_approving_review_count ?? 0);
const enforceAdmins = booleanValue(protection.enforce_admins?.enabled);
const branchProtected = booleanValue(branchProtectedValue);
const requiredStatusChecks = protectionRules !== null && protectionRules !== undefined;
const requiredPullRequestReviews = protection.required_pull_request_reviews !== null
  && protection.required_pull_request_reviews !== undefined;

const protectionRulesList = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
const reviewerRuleIds = protectionRulesList
  .filter(rule => rule?.type === 'required_reviewers')
  .map(rule => rule?.id)
  .filter(id => id !== undefined && id !== null)
  .map(String)
  .sort();
const reviewerIds = uniqueSorted(protectionRulesList
  .filter(rule => rule?.type === 'required_reviewers')
  .flatMap(rule => Array.isArray(rule.reviewers) ? rule.reviewers : [])
  .map(entry => entry?.reviewer?.id ?? entry?.id));
const environmentId = required(environment.id, 'environment-id');
const environmentName = required(environment.name, 'environment-name');
const environmentHasReviewers = reviewerIds.length > 0;
const refMatchesDefaultBranch = ref === `refs/heads/${branchName}`;
const currentCommitMatches = resolvedCommitSha === commitSha && branchHeadSha === commitSha;
const workflowPathMatches = workflowApiPath === workflowPathName;
const requiredCheckPresent = requiredChecks.some(check => {
  const normalized = check.toLowerCase();
  const expected = requiredCheckName.toLowerCase();
  return normalized === expected || normalized.endsWith(` / ${expected}`);
});

const ruleBooleans = {
  branchProtected,
  enforceAdmins,
  requiredStatusChecks,
  requiredPullRequestReviews,
  requiredCheckPresent,
  requiredEnvironmentReviewers: environmentHasReviewers,
  refMatchesDefaultBranch,
  currentCommitMatches,
  workflowPathMatches,
};
const matched = Object.values(ruleBooleans).every(Boolean) && reviewCount >= 1;
const queryTimestamps = JSON.parse(process.env.QUERY_TIMESTAMPS_JSON || '{}');
const apiEtags = JSON.parse(process.env.API_ETAGS_JSON || '{}');
const timestampValues = Object.values(queryTimestamps).filter(Boolean).sort();

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])]));
  }
  return value;
}

const evidence = {
  schemaVersion: 1,
  repositoryId: Number(repositoryId),
  repositoryName,
  ref,
  commitSha,
  defaultBranch: branchName,
  workflowPath: workflowPathName,
  workflowSha,
  branchHeadSha,
  ruleBooleans,
  requiredChecks,
  requiredCheckName,
  reviewCount,
  environmentId: Number(environmentId),
  environmentName,
  environmentProtectionRuleIds: reviewerRuleIds,
  environmentReviewerIds: reviewerIds,
  environmentReviewerCount: reviewerIds.length,
  apiEtags,
  queryTimestamps,
  queriedAt: timestampValues.at(-1) || null,
  verdict: matched ? 'MATCH' : 'MISMATCH',
};

process.stdout.write(JSON.stringify(sortObject(evidence)));
process.exit(matched ? 0 : 1);
NODE
}

build_json_map() {
  local kind="$1"
  local output
  if [[ "$kind" == etags ]]; then
    output="$(
      API_ETAG_REPOSITORY="${API_ETAG[repository]:-}" \
      API_ETAG_BRANCH="${API_ETAG[branch]:-}" \
      API_ETAG_COMMIT="${API_ETAG[commit]:-}" \
      API_ETAG_WORKFLOW="${API_ETAG[workflow]:-}" \
      API_ETAG_PROTECTION="${API_ETAG[protection]:-}" \
      API_ETAG_ENVIRONMENT="${API_ETAG[environment]:-}" \
      node <<'NODE'
const values = {
  branch: process.env.API_ETAG_BRANCH || null,
  commit: process.env.API_ETAG_COMMIT || null,
  environment: process.env.API_ETAG_ENVIRONMENT || null,
  protection: process.env.API_ETAG_PROTECTION || null,
  repository: process.env.API_ETAG_REPOSITORY || null,
  workflow: process.env.API_ETAG_WORKFLOW || null,
};
process.stdout.write(JSON.stringify(values));
NODE
    )"
  else
    output="$(
      API_TIME_REPOSITORY="${API_TIMESTAMP[repository]:-}" \
      API_TIME_BRANCH="${API_TIMESTAMP[branch]:-}" \
      API_TIME_COMMIT="${API_TIMESTAMP[commit]:-}" \
      API_TIME_WORKFLOW="${API_TIMESTAMP[workflow]:-}" \
      API_TIME_PROTECTION="${API_TIMESTAMP[protection]:-}" \
      API_TIME_ENVIRONMENT="${API_TIMESTAMP[environment]:-}" \
      node <<'NODE'
const values = {
  branch: process.env.API_TIME_BRANCH || null,
  commit: process.env.API_TIME_COMMIT || null,
  environment: process.env.API_TIME_ENVIRONMENT || null,
  protection: process.env.API_TIME_PROTECTION || null,
  repository: process.env.API_TIME_REPOSITORY || null,
  workflow: process.env.API_TIME_WORKFLOW || null,
};
process.stdout.write(JSON.stringify(values));
NODE
    )"
  fi
  printf '%s' "$output"
}

write_evidence() {
  local json_path="$1"
  local canonical_json
  local digest

  canonical_json="$(cat "$json_path")"
  digest="$(printf '%s' "$canonical_json" | sha256sum | awk '{ print $1 }')"
  if [[ -n "$EVIDENCE_PATH" ]]; then
    mkdir -p -- "$(dirname -- "$EVIDENCE_PATH")"
    printf '%s\n' "$canonical_json" > "$EVIDENCE_PATH"
    printf '%s\n' "$digest" > "$EVIDENCE_PATH.sha256"
  fi
  printf '%s\n' "$canonical_json"
  printf 'GITHUB_PROTECTION_SHA256 %s\n' "$digest"
  printf 'GITHUB_PROTECTION_EVIDENCE_OK path=%s\n' "${EVIDENCE_PATH:-stdout}"
  printf '%s' "$digest" > "$TEMP_DIR/evidence.sha256"
}

parse_arguments() {
  local repository_argument=""
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --evidence)
        [[ "$#" -ge 2 && -n "$2" ]] || { usage; exit 2; }
        EVIDENCE_PATH="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      --*)
        usage
        exit 2
        ;;
      *)
        [[ -z "$repository_argument" ]] || { usage; exit 2; }
        repository_argument="$1"
        shift
        ;;
    esac
  done
  resolve_repository "$repository_argument"
}

main() {
  local default_branch_encoded
  local workflow_content_endpoint
  local branch_endpoint
  local protection_endpoint
  local canonical_path
  local build_status
  local etags_json
  local timestamps_json

  parse_arguments "$@"
  require_command awk
  require_command date
  require_command git
  require_command gh
  require_command mkdir
  require_command node
  require_command rm
  require_command sha256sum
  require_command mktemp
  require_git_repository
  resolve_context
  check_authentication

  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/github-protection.XXXXXX")"
  canonical_path="$TEMP_DIR/canonical.json"
  write_response_parser
  write_evidence_builder

  api_call repository "/repos/$REPOSITORY"
  DEFAULT_BRANCH="$(json_field "${API_BODY_PATH[repository]}" default_branch)" \
    || environment_blocked 'default-branch-unavailable'
  [[ -n "$DEFAULT_BRANCH" ]] || environment_blocked 'default-branch-empty'
  default_branch_encoded="$(url_encode "$DEFAULT_BRANCH")"

  branch_endpoint="/repos/$REPOSITORY/branches/$default_branch_encoded"
  protection_endpoint="/repos/$REPOSITORY/branches/$default_branch_encoded/protection"
  workflow_content_endpoint="/repos/$REPOSITORY/contents/$WORKFLOW_PATH?ref=$COMMIT_SHA"

  api_call branch "$branch_endpoint"
  api_call commit "/repos/$REPOSITORY/commits/$COMMIT_SHA"
  api_call workflow "$workflow_content_endpoint"
  api_call protection "$protection_endpoint"
  api_call environment "/repos/$REPOSITORY/environments/$RELEASE_ENVIRONMENT"

  etags_json="$(build_json_map etags)"
  timestamps_json="$(build_json_map timestamps)"
  set +e
  env \
    "COMMIT_SHA=$COMMIT_SHA" \
    "REF_NAME=$REF_NAME" \
    "REQUIRED_CHECK_NAME=$REQUIRED_CHECK_NAME" \
    "WORKFLOW_PATH=$WORKFLOW_PATH" \
    "API_ETAGS_JSON=$etags_json" \
    "QUERY_TIMESTAMPS_JSON=$timestamps_json" \
    node "$TEMP_DIR/build-evidence.cjs" \
      "${API_BODY_PATH[repository]}" \
      "${API_BODY_PATH[branch]}" \
      "${API_BODY_PATH[commit]}" \
      "${API_BODY_PATH[workflow]}" \
      "${API_BODY_PATH[protection]}" \
      "${API_BODY_PATH[environment]}" > "$canonical_path" 2>"$TEMP_DIR/build-evidence.error"
  build_status=$?
  set -e
  if [[ "$build_status" -eq 2 ]]; then
    environment_blocked 'api-state-incomplete'
  fi
  [[ "$build_status" -eq 0 || "$build_status" -eq 1 ]] || environment_blocked 'canonicalization-failed'

  write_evidence "$canonical_path"
  if [[ "$build_status" -eq 1 ]]; then
    printf 'GITHUB_PROTECTION_MISMATCH reason=protection-policy\n' >&2
    exit 1
  fi
  printf 'GITHUB_PROTECTION_OK\n'
}

main "$@"
