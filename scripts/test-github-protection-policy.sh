#!/usr/bin/env bash
# Deterministic, offline regression suite for scripts/verify-github-protection.sh.
#
# The real verifier is executed end to end against a fake `gh` executable that
# replays static JSON fixtures, so the production evidence builder, response
# parser and exit-code contract are exercised without ever contacting GitHub and
# without any credential being required.
set -euo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly PROTECTION_SCRIPT="$SCRIPT_DIR/verify-github-protection.sh"

readonly FIXTURE_REPOSITORY='example-org/example-repo'
readonly FIXTURE_REF='refs/heads/main'
readonly FIXTURE_COMMIT_SHA='1111111111111111111111111111111111111111'
readonly FIXTURE_WORKFLOW_SHA='2222222222222222222222222222222222222222'
readonly FIXTURE_WORKFLOW_PATH='.github/workflows/ci.yml'
# Non-credential placeholder: the fake `gh` never reads it. Asserted absent from
# every artifact so a future change cannot start leaking a real token.
readonly FIXTURE_TOKEN_SENTINEL='fake-token-not-a-credential'

TEST_TMPDIR=''
FAILURES=0

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$TEST_TMPDIR" && -d "$TEST_TMPDIR" ]]; then
    rm -rf -- "$TEST_TMPDIR"
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM

fail() {
  printf 'PROTECTION_POLICY_TEST_FAILED code=%s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

blocked() {
  printf 'ENVIRONMENT_BLOCKED component=github-protection-test reason=%s\n' "$1" >&2
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || blocked "command-unavailable-$1"
}

write_fake_gh() {
  local bin_dir="$TEST_TMPDIR/bin"
  mkdir -p -- "$bin_dir"
  cat > "$bin_dir/gh" <<'FAKE_GH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == 'auth' ]]; then
  exit 0
fi

endpoint=''
for argument in "$@"; do
  endpoint="$argument"
done

fixture=''
case "$endpoint" in
  */protection) fixture='protection' ;;
  */contents/*) fixture='workflow' ;;
  */commits/*) fixture='commit' ;;
  */environments/*) fixture='environment' ;;
  */branches/*) fixture='branch' ;;
  /repos/*/*) fixture='repository' ;;
esac

if [[ -z "$fixture" ]]; then
  printf 'fake-gh: unmapped endpoint %s\n' "$endpoint" >&2
  exit 1
fi

body_path="${PROTECTION_FIXTURE_DIR:?}/$fixture.json"
if [[ ! -f "$body_path" ]]; then
  printf 'fake-gh: missing fixture %s\n' "$body_path" >&2
  exit 1
fi

scenario="${PROTECTION_FIXTURE_SCENARIO:-match}"
status=200
if [[ "$scenario" == 'non-2xx' && "$fixture" == 'protection' ]]; then status=403; fi
printf 'HTTP/2.0 %s FIXTURE\r\n' "$status"
printf 'content-type: application/json\r\n'
if [[ "$scenario" != 'missing-etag' || "$fixture" != 'protection' ]]; then
  printf 'etag: W/"fixture-%s"\r\n' "$fixture"
fi
printf '\r\n'
if [[ "$scenario" == 'invalid-json' && "$fixture" == 'protection' ]]; then
  printf '{invalid-json'
else
  cat -- "$body_path"
fi
FAKE_GH
  chmod 0755 -- "$bin_dir/gh"

  cat > "$bin_dir/date" <<'FAKE_DATE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${PROTECTION_FIXTURE_SCENARIO:-match}" == 'stale' ]]; then
  printf '2000-01-01T00:00:00Z\n'
else
  /usr/bin/date "$@"
fi
FAKE_DATE
  chmod 0755 -- "$bin_dir/date"
}

write_fixture_generator() {
  cat > "$TEST_TMPDIR/make-fixtures.cjs" <<'NODE'
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [scenario, outputDir] = process.argv.slice(2);
const repository = process.env.FIXTURE_REPOSITORY;
const commitSha = process.env.FIXTURE_COMMIT_SHA;
const workflowSha = process.env.FIXTURE_WORKFLOW_SHA;
const workflowPath = process.env.FIXTURE_WORKFLOW_PATH;

const fixtures = {
  repository: {
    id: 12345,
    full_name: repository,
    default_branch: 'main',
  },
  branch: {
    name: 'main',
    protected: true,
    commit: { sha: commitSha },
  },
  commit: { sha: commitSha },
  workflow: { path: workflowPath, sha: workflowSha, type: 'file' },
  protection: {
    required_status_checks: {
      strict: true,
      contexts: ['release-gate'],
      checks: [{ context: 'release-gate', app_id: 15368 }],
    },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      dismiss_stale_reviews: true,
      require_last_push_approval: true,
      require_code_owner_reviews: false,
    },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    required_conversation_resolution: { enabled: true },
    required_linear_history: { enabled: false },
  },
  environment: {
    id: 777,
    name: 'release',
    protection_rules: [
      {
        id: 901,
        type: 'required_reviewers',
        reviewers: [{ type: 'User', reviewer: { id: 555, login: 'release-approver' } }],
      },
      { id: 902, type: 'wait_timer', wait_timer: 0 },
    ],
  },
};

const protectionRules = fixtures.protection.required_status_checks;
const reviewRules = fixtures.protection.required_pull_request_reviews;

const mutations = {
  match() {},
  'strict-false'() {
    protectionRules.strict = false;
  },
  'force-push-enabled'() {
    fixtures.protection.allow_force_pushes.enabled = true;
  },
  'deletion-enabled'() {
    fixtures.protection.allow_deletions.enabled = true;
  },
  'stale-dismissal-false'() {
    reviewRules.dismiss_stale_reviews = false;
  },
  'last-push-approval-false'() {
    reviewRules.require_last_push_approval = false;
  },
  'required-check-absent'() {
    protectionRules.contexts = ['build'];
    protectionRules.checks = [{ context: 'build', app_id: 15368 }];
  },
  'review-count-zero'() {
    reviewRules.required_approving_review_count = 0;
  },
  'enforce-admins-false'() {
    fixtures.protection.enforce_admins.enabled = false;
  },
  'branch-unprotected'() {
    fixtures.branch.protected = false;
  },
  'environment-reviewers-absent'() {
    fixtures.environment.protection_rules = [{ id: 902, type: 'wait_timer', wait_timer: 0 }];
  },
  'force-push-field-missing'() {
    delete fixtures.protection.allow_force_pushes;
  },
  'deletion-field-missing'() {
    delete fixtures.protection.allow_deletions;
  },
  'strict-field-missing'() {
    delete protectionRules.strict;
  },
  'stale-dismissal-field-missing'() {
    delete reviewRules.dismiss_stale_reviews;
  },
  'last-push-approval-field-missing'() {
    delete reviewRules.require_last_push_approval;
  },
  'repository-mismatch'() {
    fixtures.repository.full_name = 'other-org/other-repo';
  },
  'commit-mismatch'() {
    fixtures.commit.sha = '3'.repeat(40);
  },
  'workflow-mismatch'() {
    fixtures.workflow.path = '.github/workflows/other.yml';
  },
  'invalid-type'() {
    fixtures.branch.protected = 'true';
  },
  'non-2xx'() {},
  'invalid-json'() {},
  'missing-etag'() {},
  'stale'() {},
};

const mutate = mutations[scenario];
if (typeof mutate !== 'function') {
  process.stderr.write(`unknown-scenario-${scenario}\n`);
  process.exit(2);
}
mutate();

fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
for (const [name, value] of Object.entries(fixtures)) {
  fs.writeFileSync(path.join(outputDir, `${name}.json`), `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}
NODE
}

write_evidence_asserter() {
  cat > "$TEST_TMPDIR/assert-evidence.cjs" <<'NODE'
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const [evidencePath, expectedVerdict, expectedFalseKey, forbiddenValue,
  expectedRepository, expectedRef, expectedCommit, expectedWorkflowSha, expectedWorkflowPath] = process.argv.slice(2);

const REQUIRED_RULE_KEYS = [
  'branchDeletionDisabled',
  'branchProtected',
  'currentCommitMatches',
  'dismissStaleReviews',
  'enforceAdmins',
  'forcePushDisabled',
  'refMatchesDefaultBranch',
  'requireLastPushApproval',
  'requiredCheckPresent',
  'requiredEnvironmentReviewers',
  'requiredPullRequestReviews',
  'requiredStatusChecks',
  'strictStatusChecks',
  'workflowPathMatches',
];

const problems = [];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

const text = fs.readFileSync(evidencePath, 'utf8').trim();
const evidence = JSON.parse(text);

if (JSON.stringify(canonical(evidence)) !== text) problems.push('evidence-not-canonical');
if (evidence.schemaVersion !== 2) problems.push(`schema-version-${evidence.schemaVersion}`);
if (evidence.verdict !== expectedVerdict) problems.push(`verdict-${evidence.verdict}`);
if (evidence.repositoryName !== expectedRepository) problems.push('repository-name-mismatch');
if (evidence.ref !== expectedRef) problems.push('ref-mismatch');
if (evidence.commitSha !== expectedCommit) problems.push('commit-mismatch');
if (evidence.branchHeadSha !== expectedCommit) problems.push('branch-head-mismatch');
if (evidence.defaultBranch !== 'main') problems.push('default-branch-mismatch');
if (evidence.workflowSha !== expectedWorkflowSha) problems.push('workflow-sha-mismatch');
if (evidence.workflowPath !== expectedWorkflowPath) problems.push('workflow-path-mismatch');

const apiKeys = ['branch', 'commit', 'environment', 'protection', 'repository', 'workflow'];
if (JSON.stringify(Object.keys(evidence.apiEtags || {}).sort()) !== JSON.stringify(apiKeys)) {
  problems.push('api-etag-keys-mismatch');
}
if (JSON.stringify(Object.keys(evidence.queryTimestamps || {}).sort()) !== JSON.stringify(apiKeys)) {
  problems.push('query-timestamp-keys-mismatch');
}
for (const key of apiKeys) {
  if (evidence.apiEtags?.[key] !== `W/"fixture-${key}"`) problems.push(`api-etag-${key}`);
  const timestamp = evidence.queryTimestamps?.[key];
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp)) {
    problems.push(`query-timestamp-${key}`);
  } else if (Math.abs(Date.now() - Date.parse(timestamp)) > 300_000) {
    problems.push(`query-timestamp-stale-${key}`);
  }
}

const digestPath = `${evidencePath}.sha256`;
const digest = fs.readFileSync(digestPath, 'utf8').trim();
if (digest !== crypto.createHash('sha256').update(text, 'utf8').digest('hex')) {
  problems.push('digest-mismatch');
}

const rules = evidence.ruleBooleans || {};
const ruleKeys = Object.keys(rules).sort();
for (const key of REQUIRED_RULE_KEYS) {
  if (!ruleKeys.includes(key)) problems.push(`rule-key-absent-${key}`);
}
for (const key of ruleKeys) {
  if (typeof rules[key] !== 'boolean') problems.push(`rule-not-boolean-${key}`);
}

if (expectedVerdict === 'MATCH') {
  for (const key of ruleKeys) {
    if (rules[key] !== true) problems.push(`rule-false-${key}`);
  }
  if (!(Number(evidence.reviewCount) >= 1)) problems.push('review-count-below-one');
} else if (expectedFalseKey === 'reviewCount') {
  if (Number(evidence.reviewCount) >= 1) problems.push('review-count-not-drifted');
} else if (expectedFalseKey) {
  if (rules[expectedFalseKey] !== false) problems.push(`rule-not-false-${expectedFalseKey}`);
}

if (forbiddenValue && text.includes(forbiddenValue)) problems.push('secret-leaked-into-evidence');

if (problems.length > 0) {
  process.stdout.write(problems.join(','));
  process.exit(1);
}
process.exit(0);
NODE
}

write_projection_comparer() {
  cat > "$TEST_TMPDIR/compare-projection.cjs" <<'NODE'
'use strict';

const fs = require('node:fs');

// Approximates the projection that scripts/verify-final.sh applies before its
// exact canonical evidence recheck. Timestamps, verdict and etags are dropped
// here so a drift can only be reported when a real policy field changed, which
// is a strictly stronger claim than the verify-final.sh comparison makes.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function projection(path) {
  const evidence = JSON.parse(fs.readFileSync(path, 'utf8'));
  delete evidence.queryTimestamps;
  delete evidence.queriedAt;
  delete evidence.verdict;
  delete evidence.apiEtags;
  return JSON.stringify(canonical(evidence));
}

const [baselinePath, driftedPath] = process.argv.slice(2);
process.exit(projection(baselinePath) === projection(driftedPath) ? 1 : 0);
NODE
}

run_case() {
  local scenario="$1"
  local expected_status="$2"
  local expected_false_key="$3"
  local case_dir="$TEST_TMPDIR/cases/$scenario"
  local evidence_path="$case_dir/evidence.json"
  local output_path="$case_dir/output.log"
  local status
  local expected_verdict='MISMATCH'
  local problems

  mkdir -p -- "$case_dir"
  env \
    "FIXTURE_REPOSITORY=$FIXTURE_REPOSITORY" \
    "FIXTURE_COMMIT_SHA=$FIXTURE_COMMIT_SHA" \
    "FIXTURE_WORKFLOW_SHA=$FIXTURE_WORKFLOW_SHA" \
    "FIXTURE_WORKFLOW_PATH=$FIXTURE_WORKFLOW_PATH" \
    node "$TEST_TMPDIR/make-fixtures.cjs" "$scenario" "$case_dir/fixtures" \
    || blocked "fixture-generation-failed-$scenario"

  set +e
  env \
    -u GITHUB_TOKEN \
    -u GITHUB_WORKFLOW_REF \
    -u PROTECTION_WORKFLOW_PATH \
    -u RELEASE_GATE_CHECK_NAME \
    -u OWNER \
    -u REPO \
    "PATH=$TEST_TMPDIR/bin:$PATH" \
    "HOME=${HOME:-/root}" \
    "TMPDIR=$TEST_TMPDIR" \
    "PROTECTION_FIXTURE_DIR=$case_dir/fixtures" \
    "PROTECTION_FIXTURE_SCENARIO=$scenario" \
    "GITHUB_REPOSITORY=$FIXTURE_REPOSITORY" \
    "GITHUB_REF=$FIXTURE_REF" \
    "GITHUB_SHA=$FIXTURE_COMMIT_SHA" \
    "GH_TOKEN=$FIXTURE_TOKEN_SENTINEL" \
    bash "$PROTECTION_SCRIPT" --evidence "$evidence_path" >"$output_path" 2>&1
  status=$?
  set -e

  if [[ "$status" -ne "$expected_status" ]]; then
    fail "$scenario-status-$status-expected-$expected_status"
    return 0
  fi

  if grep -q -- "$FIXTURE_TOKEN_SENTINEL" "$output_path"; then
    fail "$scenario-token-in-output"
  fi

  if [[ "$expected_status" -eq 2 ]]; then
    local blocked_reason='api-state-incomplete'
    case "$scenario" in
      non-2xx) blocked_reason='api-protection-status-403' ;;
      invalid-json) blocked_reason='api-protection-invalid' ;;
      missing-etag) blocked_reason='api-protection-etag-invalid' ;;
    esac
    grep -q "ENVIRONMENT_BLOCKED component=github-protection reason=$blocked_reason" "$output_path" \
      || fail "$scenario-missing-blocked-marker"
    [[ ! -e "$evidence_path" ]] || fail "$scenario-evidence-written-while-blocked"
    return 0
  fi

  if [[ "$expected_status" -eq 1 ]]; then
    grep -q 'GITHUB_PROTECTION_MISMATCH reason=protection-policy' "$output_path" \
      || fail "$scenario-missing-mismatch-marker"
  else
    expected_verdict='MATCH'
    grep -q 'GITHUB_PROTECTION_OK' "$output_path" || fail "$scenario-missing-ok-marker"
  fi

  [[ -f "$evidence_path" ]] || { fail "$scenario-evidence-absent"; return 0; }

  set +e
  problems="$(node "$TEST_TMPDIR/assert-evidence.cjs" \
    "$evidence_path" "$expected_verdict" "$expected_false_key" "$FIXTURE_TOKEN_SENTINEL" \
    "$FIXTURE_REPOSITORY" "$FIXTURE_REF" "$FIXTURE_COMMIT_SHA" "$FIXTURE_WORKFLOW_SHA" \
    "$FIXTURE_WORKFLOW_PATH")"
  status=$?
  set -e
  [[ "$status" -eq 0 ]] || fail "$scenario-evidence-$problems"

  if [[ "$expected_verdict" == 'MISMATCH' ]]; then
    node "$TEST_TMPDIR/compare-projection.cjs" \
      "$TEST_TMPDIR/cases/match/evidence.json" "$evidence_path" \
      || fail "$scenario-projection-not-drifted"
  fi
}

main() {
  require_command bash
  require_command git
  require_command grep
  require_command mktemp
  require_command node

  [[ -f "$PROTECTION_SCRIPT" ]] || blocked 'protection-script-absent'

  TEST_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/github-protection-test.XXXXXX")"
  write_fake_gh
  write_fixture_generator
  write_evidence_asserter
  write_projection_comparer

  # The matching baseline runs first: drift cases compare their canonical
  # projection against it to prove verify-final.sh's recheck would catch them.
  run_case match 0 ''
  run_case strict-false 1 strictStatusChecks
  run_case force-push-enabled 1 forcePushDisabled
  run_case deletion-enabled 1 branchDeletionDisabled
  run_case stale-dismissal-false 1 dismissStaleReviews
  run_case last-push-approval-false 1 requireLastPushApproval
  run_case required-check-absent 1 requiredCheckPresent
  run_case review-count-zero 1 reviewCount
  run_case enforce-admins-false 1 enforceAdmins
  run_case branch-unprotected 1 branchProtected
  run_case environment-reviewers-absent 1 requiredEnvironmentReviewers
  run_case force-push-field-missing 2 ''
  run_case deletion-field-missing 2 ''
  run_case strict-field-missing 2 ''
  run_case stale-dismissal-field-missing 2 ''
  run_case last-push-approval-field-missing 2 ''
  run_case repository-mismatch 2 ''
  run_case commit-mismatch 1 currentCommitMatches
  run_case workflow-mismatch 1 workflowPathMatches
  run_case invalid-type 2 ''
  run_case non-2xx 2 ''
  run_case invalid-json 2 ''
  run_case missing-etag 2 ''
  run_case stale 2 ''

  if [[ "$FAILURES" -ne 0 ]]; then
    printf 'GITHUB_PROTECTION_POLICY_TESTS_FAILED count=%s\n' "$FAILURES" >&2
    exit 1
  fi
  printf 'GITHUB_PROTECTION_POLICY_TESTS_OK cases=24\n'
}

main "$@"
