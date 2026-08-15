#!/usr/bin/env bash
# Retired: production schema changes belong to scripts/start-prod.sh.
set -euo pipefail

printf '%s\n' \
  'backend/migrate.sh is retired and cannot apply schema changes.' \
  'Production startup runs scripts/start-prod.sh, which invokes npm run db:deploy.' \
  'For local development, create a named migration with npm run db:migrate.' >&2
exit 1
