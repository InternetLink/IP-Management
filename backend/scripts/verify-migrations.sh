#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly SCHEMA_PATH="$BACKEND_DIR/prisma/schema.prisma"
readonly MIGRATIONS_DIR="$BACKEND_DIR/prisma/migrations"
readonly CONTRACT_MIGRATIONS_DIR="$BACKEND_DIR/prisma/contract-migrations"
readonly EXPECTED_TABLE_COUNT=7

MODE="${1:-all}"
TEMP_ROOT=""
TEMP_BASE="${TMPDIR:-/tmp}"
MYSQL_USER=""
MYSQL_PASSWORD=""
MYSQL_HOST=""
MYSQL_PORT=""
INPUT_DATABASE=""
NAMESPACE=""
BASELINE_NAME=""
BASELINE_SQL=""
FROM_DATASOURCE_SCHEMA=""
TO_DATASOURCE_SCHEMA=""
DUMP_BIN=""
declare -a OWNED_DATABASES=()

fail() {
  local message="$1"
  local code="${2:-1}"
  printf 'ERROR: %s\n' "$message" >&2
  exit "$code"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is unavailable: $1" 2
}

discover_baseline() {
  local -a baseline_dirs=()

  shopt -s nullglob
  baseline_dirs=("$MIGRATIONS_DIR"/*_baseline)
  shopt -u nullglob

  if (( ${#baseline_dirs[@]} != 1 )); then
    fail "Expected exactly one baseline migration directory" 2
  fi

  BASELINE_NAME="$(basename "${baseline_dirs[0]}")"
  BASELINE_SQL="${baseline_dirs[0]}/migration.sql"
  [[ "$BASELINE_NAME" =~ ^[0-9]{14}_baseline$ ]] || fail "Baseline migration name is unsafe" 2
  [[ -f "$BASELINE_SQL" ]] || fail "Baseline migration SQL is missing" 2
}

print_usage() {
  cat <<'EOF'
Usage: bash scripts/verify-migrations.sh [empty|existing|drift|forward-failure|capacity-stages|all]

Required environment:
  TEST_DATABASE_URL  MySQL URL whose database component ends in _test.

Remote CI service contract:
  Set CI=true (or GITHUB_ACTIONS=true) and CI_MYSQL_HOST to the exact isolated
  MySQL service hostname. Use a dedicated account with CREATE/DROP capability
  on that isolated service and migration privileges scoped to ipam\_%\_test.*.

Existing database baseline runbook:
  1. Schedule a maintenance window and restore a recent backup into an isolated
     rehearsal environment.
  2. Create a separate reference database by applying only the immutable
     baseline migration.sql.
  3. Run `prisma migrate diff --exit-code` from the live database to that
     reference. Continue only after exit 0 and an empty diff provide zero-drift
     evidence. This verifier maps a non-empty diff to exit 3 and DRIFT_BLOCKED.
  4. Take a full backup with routines, triggers, and events, then verify that the
     backup is readable and retained under the operator's recovery policy.
  5. Run `DATABASE_URL='<existing-url>' npx prisma migrate resolve --applied
     '<timestamp>_baseline'` only against the zero-drift database.
  6. Run `npx prisma migrate deploy`, `npx prisma migrate status`, and a final
     live-to-current-schema diff before restoring application traffic.

Failed forward migration recovery:
  1. Back up the failed database and inspect `_prisma_migrations.logs` plus any
     partially committed DDL.
  2. Revert partial DDL, then use `prisma migrate resolve --rolled-back` before
     redeploying the corrected migration; or complete the migration manually and
     use `--applied` only after a zero-drift comparison proves completion.
EOF
  printf '\nCurrent baseline migration: %s\n' "$BASELINE_NAME"
}

decode_base64() {
  printf '%s' "$1" | base64 --decode
}

parse_test_database_url() {
  local parsed
  local -a fields=()

  if ! parsed="$(TEST_URL="$TEST_DATABASE_URL" node <<'NODE'
try {
  const url = new URL(process.env.TEST_URL);
  if (url.protocol !== 'mysql:') {
    process.exit(2);
  }

  const values = [
    decodeURIComponent(url.username),
    decodeURIComponent(url.password),
    url.hostname.replace(/^\[|\]$/g, ''),
    url.port || '3306',
    decodeURIComponent(url.pathname.replace(/^\//, '')),
  ];

  for (const value of values) {
    process.stdout.write(`${Buffer.from(value).toString('base64')}\n`);
  }
} catch {
  process.exit(2);
}
NODE
  )"; then
    fail "TEST_DATABASE_URL must be a valid mysql:// URL" 2
  fi

  mapfile -t fields <<<"$parsed"
  (( ${#fields[@]} == 5 )) || fail "TEST_DATABASE_URL could not be parsed safely" 2

  MYSQL_USER="$(decode_base64 "${fields[0]}")"
  MYSQL_PASSWORD="$(decode_base64 "${fields[1]}")"
  MYSQL_HOST="$(decode_base64 "${fields[2]}")"
  MYSQL_PORT="$(decode_base64 "${fields[3]}")"
  INPUT_DATABASE="$(decode_base64 "${fields[4]}")"

  [[ -n "$MYSQL_USER" ]] || fail "TEST_DATABASE_URL requires a username" 2
  [[ -n "$MYSQL_HOST" ]] || fail "TEST_DATABASE_URL requires a host" 2
  [[ "$MYSQL_PORT" =~ ^[0-9]+$ ]] || fail "TEST_DATABASE_URL port is invalid" 2
  (( MYSQL_PORT >= 1 && MYSQL_PORT <= 65535 )) || fail "TEST_DATABASE_URL port is invalid" 2
  [[ "$INPUT_DATABASE" =~ ^[A-Za-z0-9_]+_test$ ]] || fail "TEST_DATABASE_URL database must end in _test" 2
}

validate_host() {
  local designated_host="${CI_MYSQL_HOST:-}"
  designated_host="${designated_host#[}"
  designated_host="${designated_host%]}"

  case "$MYSQL_HOST" in
    127.0.0.1|localhost|::1)
      ;;
    *)
      if [[ "${CI:-}" != "true" && "${GITHUB_ACTIONS:-}" != "true" ]]; then
        fail "Remote TEST_DATABASE_URL hosts require an isolated CI environment" 2
      fi
      [[ -n "$designated_host" && "$MYSQL_HOST" == "$designated_host" ]] || \
        fail "TEST_DATABASE_URL host does not match CI_MYSQL_HOST" 2
      [[ "$MYSQL_USER" != "root" ]] || fail "Remote CI verification requires a dedicated database user" 2
      ;;
  esac
}

derive_namespace() {
  local raw run_component unique_component

  unique_component="${BASHPID}_${RANDOM}${RANDOM}"
  if [[ -n "${GITHUB_RUN_ID:-}" && -n "${GITHUB_RUN_ATTEMPT:-}" ]]; then
    run_component="$(printf '%s_%s' "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" | \
      tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | cut -c1-12)"
    raw="${run_component}_${unique_component}"
  else
    raw="$unique_component"
  fi

  NAMESPACE="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | cut -c1-32)"
  NAMESPACE="${NAMESPACE#_}"
  NAMESPACE="${NAMESPACE%_}"
  [[ "$NAMESPACE" =~ ^[a-z0-9][a-z0-9_]{3,31}$ ]] || fail "Could not derive a safe fixture namespace" 2
}

fixture_name() {
  local component="${1//-/_}"
  local name

  [[ "$component" =~ ^[a-z0-9_]+$ ]] || fail "Unsafe fixture mode component: $1" 2
  name="ipam_${NAMESPACE}_${component}_test"
  (( ${#name} <= 64 )) || fail "Generated fixture database name is too long" 2
  printf '%s' "$name"
}

is_owned_fixture_name() {
  local name="$1"
  [[ "$name" == ipam_"${NAMESPACE}"_*_test && "$name" =~ ^[a-z0-9_]+_test$ ]]
}

redact_stream() {
  REDACT_URL="$TEST_DATABASE_URL" REDACT_PASSWORD="$MYSQL_PASSWORD" node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const secrets = [
        process.env.REDACT_URL,
        process.env.REDACT_PASSWORD,
        process.env.REDACT_PASSWORD ? encodeURIComponent(process.env.REDACT_PASSWORD) : "",
      ].filter(Boolean).sort((left, right) => right.length - left.length);

      for (const secret of secrets) {
        input = input.split(secret).join("[REDACTED]");
      }
      process.stdout.write(input);
    });
  '
}

run_redacted() {
  "$@" 2>&1 | redact_stream
}

capture_redacted() {
  local output_file="$1"
  shift

  "$@" 2>&1 | redact_stream >"$output_file"
  return "${PIPESTATUS[0]}"
}

mysql_admin() {
  MYSQL_PWD="$MYSQL_PASSWORD" command mysql \
    --protocol=TCP \
    --host="$MYSQL_HOST" \
    --port="$MYSQL_PORT" \
    --user="$MYSQL_USER" \
    "$@"
}

mysql_database() {
  local database="$1"
  shift

  MYSQL_PWD="$MYSQL_PASSWORD" command mysql \
    --protocol=TCP \
    --host="$MYSQL_HOST" \
    --port="$MYSQL_PORT" \
    --user="$MYSQL_USER" \
    "$database" \
    "$@"
}

mysql_scalar() {
  mysql_admin --batch --skip-column-names --execute="$1" 2> >(redact_stream >&2)
}

database_url_for() {
  DATABASE_NAME="$1" BASE_URL="$TEST_DATABASE_URL" node <<'NODE'
const url = new URL(process.env.BASE_URL);
url.pathname = `/${process.env.DATABASE_NAME}`;
process.stdout.write(url.toString());
NODE
}

create_database() {
  local database="$1"

  is_owned_fixture_name "$database" || fail "Refusing to create an unowned database name" 2
  run_redacted mysql_admin --execute="CREATE DATABASE \`$database\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
  OWNED_DATABASES+=("$database")
  printf 'FIXTURE_CREATED %s\n' "$database"
}

cleanup() {
  local original_status=$?
  local cleanup_failed=0
  local index database

  trap - EXIT
  set +e

  for (( index=${#OWNED_DATABASES[@]} - 1; index >= 0; index-- )); do
    database="${OWNED_DATABASES[$index]}"
    if is_owned_fixture_name "$database" && \
      mysql_admin --execute="DROP DATABASE IF EXISTS \`$database\`" >/dev/null 2>&1; then
      printf 'FIXTURE_DROPPED %s\n' "$database"
    else
      printf 'CLEANUP_FAILED %s\n' "$database" >&2
      cleanup_failed=1
    fi
  done

  if [[ -n "$TEMP_ROOT" && "$TEMP_ROOT" == "${TEMP_BASE%/}"/ipam-migration-verify.* ]]; then
    rm -rf "$TEMP_ROOT"
  else
    printf 'CLEANUP_FAILED unsafe temporary path\n' >&2
    cleanup_failed=1
  fi

  if (( original_status == 0 && cleanup_failed != 0 )); then
    original_status=1
  fi
  exit "$original_status"
}

initialize_temp_root() {
  TEMP_BASE="${TEMP_BASE%/}"
  [[ -n "$TEMP_BASE" ]] || TEMP_BASE="/"
  TEMP_ROOT="$(mktemp -d "$TEMP_BASE/ipam-migration-verify.XXXXXX")"
  FROM_DATASOURCE_SCHEMA="$TEMP_ROOT/from.prisma"
  TO_DATASOURCE_SCHEMA="$TEMP_ROOT/to.prisma"

  cat >"$FROM_DATASOURCE_SCHEMA" <<'EOF'
datasource db {
  provider = "mysql"
  url      = env("VERIFY_FROM_URL")
}
EOF

  cat >"$TO_DATASOURCE_SCHEMA" <<'EOF'
datasource db {
  provider = "mysql"
  url      = env("VERIFY_TO_URL")
}
EOF

  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

select_dump_binary() {
  if command -v mariadb-dump >/dev/null 2>&1; then
    DUMP_BIN="$(command -v mariadb-dump)"
  elif command -v mysqldump >/dev/null 2>&1; then
    DUMP_BIN="$(command -v mysqldump)"
  else
    fail "Existing mode requires mariadb-dump or mysqldump" 2
  fi
}

assert_mapped_tables() {
  local database="$1"
  local table_count

  table_count="$(mysql_scalar "
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = '$database'
      AND table_type = 'BASE TABLE'
      AND table_name IN (
        'users',
        'prefixes',
        'allocations',
        'geofeed_entries',
         'audit_logs',
         'app_settings',
         'migration_states'
      );
  ")"

  [[ "$table_count" == "$EXPECTED_TABLE_COUNT" ]] || \
    fail "Expected all seven mapped tables in $database; found $table_count"
}

assert_baseline_mapped_tables() {
  local database="$1"
  local table_count

  table_count="$(mysql_scalar "
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = '$database'
      AND table_type = 'BASE TABLE'
      AND table_name IN (
        'users',
        'prefixes',
        'allocations',
        'geofeed_entries',
        'audit_logs',
        'app_settings'
      );
  ")"

  [[ "$table_count" == "6" ]] || \
    fail "Expected all six baseline mapped tables in $database; found $table_count"
}

assert_baseline_applied() {
  local database="$1"
  local applied_count

  applied_count="$(mysql_scalar "
    SELECT COUNT(*)
    FROM \`$database\`.\`_prisma_migrations\`
    WHERE migration_name = '$BASELINE_NAME'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL;
  ")"

  [[ "$applied_count" == "1" ]] || fail "Baseline is not recorded as applied in $database"
}

assert_current_schema_matches() {
  local database="$1"
  local database_url="$2"
  local output_file="$TEMP_ROOT/current-schema-${database}.log"
  local status

  export VERIFY_FROM_URL="$database_url"
  if DATABASE_URL="$database_url" capture_redacted "$output_file" \
    npx prisma migrate diff \
      --from-schema-datasource "$FROM_DATASOURCE_SCHEMA" \
      --to-schema-datamodel "$SCHEMA_PATH" \
      --exit-code; then
    status=0
  else
    status=$?
  fi
  unset VERIFY_FROM_URL

  if (( status != 0 )); then
    command cat "$output_file" >&2
    fail "Live schema does not match the current Prisma schema for $database"
  fi

  rm -f "$output_file"
  printf 'CURRENT_SCHEMA_MATCH %s\n' "$database"
}

preflight_against_baseline() {
  local database="$1"
  local live_url="$2"
  local reference_url="$3"
  local output_file="$TEMP_ROOT/baseline-preflight-${database}.log"
  local status

  export VERIFY_FROM_URL="$live_url"
  export VERIFY_TO_URL="$reference_url"
  if capture_redacted "$output_file" \
    npx prisma migrate diff \
      --from-schema-datasource "$FROM_DATASOURCE_SCHEMA" \
      --to-schema-datasource "$TO_DATASOURCE_SCHEMA" \
      --exit-code; then
    status=0
  else
    status=$?
  fi
  unset VERIFY_FROM_URL VERIFY_TO_URL

  case "$status" in
    0)
      rm -f "$output_file"
      printf 'PREFLIGHT_ZERO_DRIFT %s\n' "$database"
      return 0
      ;;
    2)
      rm -f "$output_file"
      printf 'DRIFT_BLOCKED database=%s baseline=%s\n' "$database" "$BASELINE_NAME"
      return 3
      ;;
    *)
      command cat "$output_file" >&2
      rm -f "$output_file"
      printf 'PREFLIGHT_ERROR database=%s prisma_exit=%s\n' "$database" "$status" >&2
      return 1
      ;;
  esac
}

backup_database() {
  local database="$1"
  local backup_path="$TEMP_ROOT/${database}.sql"

  if MYSQL_PWD="$MYSQL_PASSWORD" "$DUMP_BIN" \
    --protocol=TCP \
    --host="$MYSQL_HOST" \
    --port="$MYSQL_PORT" \
    --user="$MYSQL_USER" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --databases "$database" \
    2>&1 >"$backup_path" | redact_stream; then
    :
  else
    fail "Could not create the existing-database rehearsal backup"
  fi

  [[ -s "$backup_path" ]] || fail "Existing-database rehearsal backup is empty"
  printf 'BACKUP_OK %s\n' "$database"
}

run_empty_mode() {
  local database database_url

  database="$(fixture_name empty)"
  create_database "$database"
  database_url="$(database_url_for "$database")"

  DATABASE_URL="$database_url" run_redacted \
    npx prisma migrate deploy --schema "$SCHEMA_PATH"
  assert_mapped_tables "$database"
  assert_baseline_applied "$database"
  assert_current_schema_matches "$database" "$database_url"
  printf 'EMPTY_OK %s\n' "$database"
}

run_existing_mode() {
  local database reference_database database_url reference_url

  database="$(fixture_name existing)"
  reference_database="$(fixture_name existing_reference)"
  create_database "$database"
  create_database "$reference_database"
  database_url="$(database_url_for "$database")"
  reference_url="$(database_url_for "$reference_database")"

  run_redacted mysql_database "$database" <"$BASELINE_SQL"
  run_redacted mysql_database "$reference_database" <"$BASELINE_SQL"
  assert_baseline_mapped_tables "$database"
  preflight_against_baseline "$database" "$database_url" "$reference_url"
  backup_database "$database"

  DATABASE_URL="$database_url" run_redacted \
    npx prisma migrate resolve --applied "$BASELINE_NAME" --schema "$SCHEMA_PATH"
  DATABASE_URL="$database_url" run_redacted \
    npx prisma migrate deploy --schema "$SCHEMA_PATH"
  DATABASE_URL="$database_url" run_redacted \
    npx prisma migrate status --schema "$SCHEMA_PATH"

  assert_baseline_applied "$database"
  assert_current_schema_matches "$database" "$database_url"
  printf 'EXISTING_OK %s\n' "$database"
}

run_drift_mode() {
  local database reference_database database_url reference_url
  local preflight_status migration_table_count baseline_row_count fixture_column_count

  database="$(fixture_name drift)"
  reference_database="$(fixture_name drift_reference)"
  create_database "$database"
  create_database "$reference_database"
  database_url="$(database_url_for "$database")"
  reference_url="$(database_url_for "$reference_database")"

  run_redacted mysql_database "$database" <"$BASELINE_SQL"
  run_redacted mysql_database "$reference_database" <"$BASELINE_SQL"
  run_redacted mysql_database "$database" \
    --execute="ALTER TABLE \`app_settings\` ADD COLUMN \`verify_drift_fixture\` VARCHAR(32) NULL"

  if preflight_against_baseline "$database" "$database_url" "$reference_url"; then
    preflight_status=0
  else
    preflight_status=$?
  fi
  [[ "$preflight_status" == "3" ]] || fail "Drift preflight did not return the required exit code 3"

  fixture_column_count="$(mysql_scalar "
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = '$database'
      AND table_name = 'app_settings'
      AND column_name = 'verify_drift_fixture';
  ")"
  [[ "$fixture_column_count" == "1" ]] || fail "Drift fixture was not preserved for inspection"

  migration_table_count="$(mysql_scalar "
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = '$database'
      AND table_name = '_prisma_migrations';
  ")"
  baseline_row_count=0
  if [[ "$migration_table_count" == "1" ]]; then
    baseline_row_count="$(mysql_scalar "
      SELECT COUNT(*)
      FROM \`$database\`.\`_prisma_migrations\`
      WHERE migration_name = '$BASELINE_NAME'
        AND finished_at IS NOT NULL;
    ")"
  fi
  [[ "$baseline_row_count" == "0" ]] || fail "Drifted database was incorrectly marked as baselined"

  printf 'DRIFT_FIXTURE_CONFIRMED %s\n' "$database"
  printf 'DRIFT_OK %s preflight_exit=3\n' "$database"
}

run_forward_failure_mode() {
  local database database_url temp_project failure_dir
  local first_output second_output first_status second_status
  local failed_count applied_count side_effect_count
  local failure_name="99999999999999_verify_forward_failure"

  database="$(fixture_name forward_failure)"
  create_database "$database"
  database_url="$(database_url_for "$database")"

  DATABASE_URL="$database_url" run_redacted \
    npx prisma migrate deploy --schema "$SCHEMA_PATH"
  assert_mapped_tables "$database"

  temp_project="$TEMP_ROOT/forward-failure-project"
  failure_dir="$temp_project/migrations/$failure_name"
  mkdir -p "$temp_project/migrations" "$failure_dir"
  cp "$SCHEMA_PATH" "$temp_project/schema.prisma"
  cp -R "$MIGRATIONS_DIR/." "$temp_project/migrations/"

  cat >"$failure_dir/migration.sql" <<'EOF'
-- CreateTable
CREATE TABLE `verify_forward_failure_fixture` (
    `id` INTEGER NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Deliberately fail after MySQL commits the first DDL statement.
CREATE TABLE `verify_forward_failure_fixture` (
    `id` INTEGER NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EOF

  first_output="$TEMP_ROOT/forward-failure-first.log"
  export DATABASE_URL="$database_url"
  if capture_redacted "$first_output" \
    npx prisma migrate deploy --schema "$temp_project/schema.prisma"; then
    first_status=0
  else
    first_status=$?
  fi
  (( first_status != 0 )) || fail "Deliberately broken forward migration unexpectedly succeeded"

  failed_count="$(mysql_scalar "
    SELECT COUNT(*)
    FROM \`$database\`.\`_prisma_migrations\`
    WHERE migration_name = '$failure_name'
      AND finished_at IS NULL
      AND rolled_back_at IS NULL
      AND logs IS NOT NULL
      AND logs <> '';
  ")"
  applied_count="$(mysql_scalar "
    SELECT COUNT(*)
    FROM \`$database\`.\`_prisma_migrations\`
    WHERE migration_name = '$failure_name'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL;
  ")"
  side_effect_count="$(mysql_scalar "
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = '$database'
      AND table_name = 'verify_forward_failure_fixture';
  ")"
  [[ "$failed_count" == "1" && "$applied_count" == "0" ]] || \
    fail "Forward migration failure state was not recorded correctly"
  [[ "$side_effect_count" == "1" ]] || fail "Forward failure did not preserve the partial DDL fixture"
  printf 'FORWARD_MIGRATION_FAILED %s prisma_exit=%s\n' "$database" "$first_status"

  second_output="$TEMP_ROOT/forward-failure-second.log"
  if capture_redacted "$second_output" \
    npx prisma migrate deploy --schema "$temp_project/schema.prisma"; then
    second_status=0
  else
    second_status=$?
  fi
  unset DATABASE_URL

  (( second_status != 0 )) || fail "Deploy was not blocked by the unresolved failed migration"
  if [[ "$(<"$second_output")" != *P3009* ]]; then
    command cat "$second_output" >&2
    fail "Subsequent deploy did not report Prisma P3009"
  fi

  failed_count="$(mysql_scalar "
    SELECT COUNT(*)
    FROM \`$database\`.\`_prisma_migrations\`
    WHERE migration_name = '$failure_name'
      AND finished_at IS NULL
      AND rolled_back_at IS NULL;
  ")"
  [[ "$failed_count" == "1" ]] || fail "Failed migration state changed before recovery"

  printf 'FORWARD_DEPLOY_BLOCKED %s prisma_exit=%s recovery=migrate-resolve\n' \
    "$database" "$second_status"
  printf 'FORWARD_FAILURE_OK %s\n' "$database"
}

run_capacity_stages_mode() {
  local e_database e_database_url contract_database contract_database_url
  local temp_project contract_dir contract_name contract_target failure_output
  local old_probe exact_probe state_stage failed_count legacy_count nullable_count
  local first_status contracted_count
  local -a contract_dirs=()

  shopt -s nullglob
  contract_dirs=("$CONTRACT_MIGRATIONS_DIR"/*_capacity_exact_contract)
  shopt -u nullglob
  (( ${#contract_dirs[@]} == 1 )) || fail "Expected exactly one capacity contract migration" 2
  contract_dir="${contract_dirs[0]}"
  contract_name="$(basename "$contract_dir")"
  [[ "$contract_name" =~ ^[0-9]{14}_capacity_exact_contract$ ]] || \
    fail "Capacity contract migration name is unsafe" 2

  temp_project="$TEMP_ROOT/capacity-stage-project"
  mkdir -p "$temp_project/migrations"
  cp "$SCHEMA_PATH" "$temp_project/schema.prisma"
  cp -R "$MIGRATIONS_DIR/." "$temp_project/migrations/"

  e_database="$(fixture_name capacity_e_only)"
  create_database "$e_database"
  e_database_url="$(database_url_for "$e_database")"
  DATABASE_URL="$e_database_url" run_redacted \
    npx prisma migrate deploy --schema "$temp_project/schema.prisma"
  assert_mapped_tables "$e_database"

  legacy_count="$(mysql_scalar "
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = '$e_database'
      AND table_name = 'prefixes'
      AND column_name IN ('totalIPs', 'usedIPs');
  ")"
  nullable_count="$(mysql_scalar "
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = '$e_database'
      AND table_name = 'prefixes'
      AND column_name IN ('totalIPsExact', 'usedIPsExact')
      AND is_nullable = 'YES';
  ")"
  [[ "$legacy_count" == "2" && "$nullable_count" == "2" ]] || \
    fail "Release E did not preserve legacy columns and nullable exact columns"

  run_redacted mysql_database "$e_database" --execute="
    INSERT INTO prefixes
      (id, cidr, version, totalIPs, usedIPs, updatedAt)
    VALUES
      ('capacity-old-app', '192.0.2.0/24', 4, 256, 0, CURRENT_TIMESTAMP(3));
  "
  old_probe="$(mysql_scalar "
    SELECT COUNT(*) FROM \`$e_database\`.prefixes
    WHERE id = 'capacity-old-app'
      AND totalIPs = 256
      AND totalIPsExact IS NULL
      AND usedIPsExact IS NULL;
  ")"
  [[ "$old_probe" == "1" ]] || fail "Release E old-application compatibility probe failed"
  printf 'CAPACITY_E_OLD_APP_OK %s legacy_columns=2 exact_nullable=2\n' "$e_database"

  DATABASE_URL="$e_database_url" CAPACITY_BACKFILL_OWNER="verify-e-worker" \
    run_redacted npm run capacity:backfill -- run
  state_stage="$(mysql_scalar "
    SELECT stage FROM \`$e_database\`.migration_states WHERE id = 'capacity-v1';
  ")"
  exact_probe="$(mysql_scalar "
    SELECT CAST(totalIPsExact AS CHAR) FROM \`$e_database\`.prefixes
    WHERE id = 'capacity-old-app';
  ")"
  [[ "$state_stage" == "BACKFILLED" && "$exact_probe" == "256" ]] || \
    fail "Release D backfill or Release X readiness probe failed"
  printf 'CAPACITY_D_BACKFILL_OK %s stage=%s exact=%s\n' \
    "$e_database" "$state_stage" "$exact_probe"
  printf 'CAPACITY_X_READY_OK %s stage=%s legacy_columns=2\n' "$e_database" "$state_stage"

  contract_database="$(fixture_name capacity_contract)"
  create_database "$contract_database"
  contract_database_url="$(database_url_for "$contract_database")"
  DATABASE_URL="$contract_database_url" run_redacted \
    npx prisma migrate deploy --schema "$temp_project/schema.prisma"
  run_redacted mysql_database "$contract_database" --execute="
    INSERT INTO prefixes
      (id, cidr, version, totalIPs, usedIPs, updatedAt)
    VALUES
      ('capacity-contract-prefix', '2001:db8::/64', 6, 9007199254740991, 0, CURRENT_TIMESTAMP(3));
  "

  contract_target="$temp_project/migrations/$contract_name"
  mkdir -p "$contract_target"
  cp "$contract_dir/migration.sql" "$contract_target/migration.sql"
  failure_output="$TEMP_ROOT/capacity-contract-before-backfill.log"
  export DATABASE_URL="$contract_database_url"
  if capture_redacted "$failure_output" \
    npx prisma migrate deploy --schema "$temp_project/schema.prisma"; then
    first_status=0
  else
    first_status=$?
  fi
  unset DATABASE_URL
  (( first_status != 0 )) || fail "Release C unexpectedly applied before backfill"

  failed_count="$(mysql_scalar "
    SELECT COUNT(*) FROM \`$contract_database\`._prisma_migrations
    WHERE migration_name = '$contract_name'
      AND finished_at IS NULL
      AND rolled_back_at IS NULL
      AND logs IS NOT NULL;
  ")"
  legacy_count="$(mysql_scalar "
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = '$contract_database'
      AND table_name = 'prefixes'
      AND column_name IN ('totalIPs', 'usedIPs');
  ")"
  [[ "$failed_count" == "1" && "$legacy_count" == "2" ]] || \
    fail "Release C guard did not preserve the E schema"
  printf 'CAPACITY_C_GUARD_OK %s prisma_exit=%s legacy_columns=%s\n' \
    "$contract_database" "$first_status" "$legacy_count"

  DATABASE_URL="$contract_database_url" run_redacted \
    npx prisma migrate resolve --rolled-back "$contract_name" --schema "$temp_project/schema.prisma"
  DATABASE_URL="$contract_database_url" CAPACITY_BACKFILL_OWNER="verify-contract-worker" \
    run_redacted npm run capacity:backfill -- run
  state_stage="$(mysql_scalar "
    SELECT stage FROM \`$contract_database\`.migration_states WHERE id = 'capacity-v1';
  ")"
  exact_probe="$(mysql_scalar "
    SELECT CAST(totalIPsExact AS CHAR) FROM \`$contract_database\`.prefixes
    WHERE id = 'capacity-contract-prefix';
  ")"
  [[ "$state_stage" == "BACKFILLED" && "$exact_probe" == "18446744073709551616" ]] || \
    fail "Backfilled contract fixture did not reach exact-only readiness"

  DATABASE_URL="$contract_database_url" run_redacted \
    npx prisma migrate deploy --schema "$temp_project/schema.prisma"
  legacy_count="$(mysql_scalar "
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = '$contract_database'
      AND table_name = 'prefixes'
      AND column_name IN ('totalIPs', 'usedIPs');
  ")"
  contracted_count="$(mysql_scalar "
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = '$contract_database'
      AND table_name = 'prefixes'
      AND column_name IN ('totalIPsExact', 'usedIPsExact')
      AND is_nullable = 'NO';
  ")"
  state_stage="$(mysql_scalar "
    SELECT stage FROM \`$contract_database\`.migration_states WHERE id = 'capacity-v1';
  ")"
  [[ "$legacy_count" == "0" && "$contracted_count" == "2" && "$state_stage" == "CONTRACTED" ]] || \
    fail "Release C contract schema verification failed"
  printf 'CAPACITY_C_OK %s stage=%s exact_not_null=%s legacy_columns=%s\n' \
    "$contract_database" "$state_stage" "$contracted_count" "$legacy_count"
}

main() {
  (( $# <= 1 )) || fail "Expected at most one verification mode" 2
  cd "$BACKEND_DIR"
  discover_baseline

  case "$MODE" in
    -h|--help|help)
      print_usage
      return 0
      ;;
    empty|existing|drift|forward-failure|capacity-stages|all)
      ;;
    *)
      print_usage >&2
      fail "Unknown verification mode: $MODE" 2
      ;;
  esac

  require_command base64
  require_command cut
  require_command mktemp
  require_command mysql
  require_command node
  require_command npx
  require_command tr
  [[ -n "${TEST_DATABASE_URL:-}" ]] || fail "TEST_DATABASE_URL is required" 2

  parse_test_database_url
  validate_host
  derive_namespace
  if [[ "$MODE" == "existing" || "$MODE" == "all" ]]; then
    select_dump_binary
  fi
  initialize_temp_root

  printf 'SAFETY_OK host=%s template=%s namespace=%s\n' \
    "$MYSQL_HOST" "$INPUT_DATABASE" "$NAMESPACE"

  case "$MODE" in
    empty)
      run_empty_mode
      ;;
    existing)
      run_existing_mode
      ;;
    drift)
      run_drift_mode
      ;;
    forward-failure)
      run_forward_failure_mode
      ;;
    capacity-stages)
      run_capacity_stages_mode
      ;;
    all)
      run_empty_mode
      run_existing_mode
      run_drift_mode
      run_forward_failure_mode
      run_capacity_stages_mode
      printf 'ALL_OK namespace=%s\n' "$NAMESPACE"
      ;;
  esac
}

main "$@"
