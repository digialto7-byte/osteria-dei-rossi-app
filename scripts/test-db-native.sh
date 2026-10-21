#!/usr/bin/env bash
# Runs the pgTAP suite against a plain Postgres (16+) with pgTAP installed, for machines where the
# Supabase Docker stack cannot run. A stand-in for Supabase's auth schema and roles is loaded first
# (supabase/tests-native/auth_shim.sql), so results can differ from real Supabase: CI's
# `supabase test db` is the gate. Uses the standard PGHOST/PGPORT/PGUSER variables.
#   PGHOST=/tmp PGPORT=5432 PGUSER=postgres scripts/test-db-native.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DB=${TEST_DB_NAME:-osteria_native_test}
PSQL=(psql -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" \
  -c "alter database $DB set search_path = \"\$user\", public, extensions" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests-native/auth_shim.sql" >/dev/null
for migration in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$migration" >/dev/null
done
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/seed.sql" >/dev/null
pg_prove -d "$DB" "$ROOT"/supabase/tests/database/*.test.sql
