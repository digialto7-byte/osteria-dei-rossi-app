#!/usr/bin/env bash
# Two-session tests for the invoice lock in app.automap_lines (migration 20261022131000). pgTAP
# runs in one session, so it cannot show these races; this script opens two real sessions on a
# scratch database built like scripts/test-db-native.sh (shims, migrations, seed) plus
# supabase/tests-native/races_fixture.sql. Each case gets a fresh copy of that database.
#   relink:   a reviewer moves invoice 2 to supplier B while supplier A's item propagates;
#             invoice 2's line must stay unmapped (invoice 1's line is mapped).
#   code:     a reviewer changes invoice 2's line code to ZZ-404 while MAN-1 propagates;
#             that line must stay unmapped.
#   deadlock: owner B holds invoice 2 and then maps its line while owner A maps invoice 1's line
#             (which propagates to invoice 2); neither may fail and both lines end up mapped.
# The order of the two sessions is fixed by race.gate and pg_stat_activity, not by sleeps.
# Needs only plain Postgres 16+ (no pgTAP). Uses the standard PGHOST/PGPORT/PGUSER variables.
# MIGRATIONS_DIR overrides the migrations folder (used to check that the cases fail without the fix).
#   PGHOST=/tmp PGPORT=5432 PGUSER=postgres scripts/test-db-races.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATIONS_DIR=${MIGRATIONS_DIR:-$ROOT/supabase/migrations}
TEMPLATE=${TEST_DB_NAME:-osteria_race}_tpl
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)
WORK=$(mktemp -d)
DB=
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    # On a timeout or error: show what the sessions printed, stop any parked one, drop the copies.
    cat "$WORK"/*.out >&2 2>/dev/null || true
    jobs -p | xargs -r kill 2>/dev/null || true
    for db in "$DB" "$TEMPLATE"; do
      [ -n "$db" ] && psql -X -q -d postgres -c "drop database if exists $db with (force)" >/dev/null 2>&1
    done
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

INV1=00000000-0000-4000-8000-000000000001
INV2=00000000-0000-4000-8000-000000000002
L1=a2000000-0000-4000-8000-000000000001
L2=a2000000-0000-4000-8000-000000000002
ITEM=54000000-0000-4000-8000-000000000054
SUPPLIER_B=5b000000-0000-4000-8000-00000000005b
ING='{"ingredient_id":"1a000000-0000-4000-8000-00000000001a"}'
OWNER="set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a',
  'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111',
  'app_role', 'owner')::text, true);"
# Keeps the transaction open until the script opens the gate.
WAIT_GATE="do \$\$ begin
  while not exists (select 1 from race.gate) loop perform pg_sleep(0.02); end loop;
end \$\$;"

"${PSQL[@]}" -d postgres -c "drop database if exists $TEMPLATE" -c "create database $TEMPLATE" \
  -c "alter database $TEMPLATE set search_path = \"\$user\", public, extensions" >/dev/null
for shim in auth_shim storage_shim platform_shim; do
  "${PSQL[@]}" -d "$TEMPLATE" -f "$ROOT/supabase/tests-native/$shim.sql" >/dev/null
done
for migration in "$MIGRATIONS_DIR"/*.sql; do
  "${PSQL[@]}" -d "$TEMPLATE" -f "$migration" >/dev/null
done
"${PSQL[@]}" -d "$TEMPLATE" -f "$ROOT/supabase/seed.sql" >/dev/null
"${PSQL[@]}" -d "$TEMPLATE" -f "$ROOT/supabase/tests-native/races_fixture.sql" >/dev/null

failures=0
fresh_db() {
  DB=${TEMPLATE%_tpl}_$1
  "${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB template $TEMPLATE" >/dev/null
}
drop_db() { "${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null; }
query() { psql -X -At -d "$DB" -c "$1"; }

# wait_until <sql returning a row when ready> [pid that may exit instead]
wait_until() {
  for _ in $(seq 1 500); do
    [ -n "$(query "$1")" ] && return 0
    if [ -n "${2:-}" ] && ! kill -0 "$2" 2>/dev/null; then return 0; fi
    sleep 0.02
  done
  echo "timed out waiting for: $1" >&2
  return 1
}
# Session $1 is inside its transaction and parked on the gate (or has already exited with an error,
# which the exit-code checks then report).
parked() { wait_until "select 1 from pg_stat_activity where datname = '$DB' and application_name = '$1' and wait_event = 'PgSleep'" "$2"; }
# Session $1 has finished, or is waiting for a lock (it may be waiting for the parked session).
finished_or_blocked() {
  wait_until "select 1 from pg_stat_activity where datname = '$DB' and application_name = '$1' and wait_event_type = 'Lock'" "$2"
}
check() { # check <name> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (got '$2', expected '$3')"; failures=$((failures + 1)); fi
}
# Runs the reviewer's action in session s1, parked before commit, then propagation in session s2.
propagate_during() {
  PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $OWNER $1 $WAIT_GATE commit;" \
    >"$WORK/s1.out" 2>&1 &
  local s1=$!
  parked s1 "$s1"
  PGAPPNAME=s2 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "select app.propagate_mapping('$ITEM');" \
    >"$WORK/s2.out" 2>&1 &
  local s2=$!
  finished_or_blocked s2 "$s2"
  query "insert into race.gate values (true)" >/dev/null
  local rc1=0 rc2=0
  wait "$s1" || rc1=$?
  wait "$s2" || rc2=$?
  [ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
  check "$CASE: the reviewer's transaction commits" "$rc1" 0
  check "$CASE: propagation commits" "$rc2" 0
}

CASE=relink
fresh_db relink
propagate_during "select public.review_set_supplier('$INV2', '$SUPPLIER_B', null);"
check "relink: invoice 2 has supplier B" "$(query "select supplier_id from public.invoice where id = '$INV2'")" "$SUPPLIER_B"
check "relink: invoice 2's line is not mapped to supplier A's item" \
  "$(query "select coalesce(supplier_item_id::text, 'unmapped') from public.invoice_line where id = '$L2'")" unmapped
check "relink: propagation still mapped invoice 1's line" \
  "$(query "select supplier_item_id from public.invoice_line where id = '$L1'")" "$ITEM"
drop_db

CASE=code
fresh_db code
propagate_during "select public.review_update_line('$INV2', '$L2', '{\"supplier_code\":\"ZZ-404\"}');"
check "code: invoice 2's line has code ZZ-404" "$(query "select supplier_code from public.invoice_line where id = '$L2'")" ZZ-404
check "code: and is not mapped to the MAN-1 item" \
  "$(query "select coalesce(supplier_item_id::text, 'unmapped') from public.invoice_line where id = '$L2'")" unmapped
check "code: propagation still mapped invoice 1's line" \
  "$(query "select supplier_item_id from public.invoice_line where id = '$L1'")" "$ITEM"
drop_db

CASE=deadlock
fresh_db deadlock
# Owner B: takes invoice 2 (a "line checked" action), parks, then maps invoice 2's line.
PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $OWNER
  select public.review_update_line('$INV2', '$L2', '{\"reviewed\":true}');
  $WAIT_GATE
  select public.review_update_line('$INV2', '$L2', '$ING');
  commit;" >"$WORK/s1.out" 2>&1 &
b=$!
parked s1 "$b"
# Owner A: maps invoice 1's line, which takes the item and propagates to invoice 2.
PGAPPNAME=s2 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $OWNER
  select public.review_update_line('$INV1', '$L1', '$ING');
  commit;" >"$WORK/s2.out" 2>&1 &
a=$!
finished_or_blocked s2 "$a"
query "insert into race.gate values (true)" >/dev/null
rc_b=0 rc_a=0
wait "$b" || rc_b=$?
wait "$a" || rc_a=$?
check "deadlock: owner A's mapping commits" "$rc_a" 0
check "deadlock: owner B's mapping commits" "$rc_b" 0
[ "$rc_a$rc_b" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "deadlock: both lines are mapped" \
  "$(query "select count(*) from public.invoice_line where id in ('$L1', '$L2') and ingredient_id is not null")" 2
drop_db

"${PSQL[@]}" -d postgres -c "drop database if exists $TEMPLATE" >/dev/null
if [ "$failures" -gt 0 ]; then
  echo "$failures race check(s) failed" >&2
  exit 1
fi
echo "all race checks passed"
