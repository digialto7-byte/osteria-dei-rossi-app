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
# Approval (M5, supabase/migrations/20261022140500_approve_invoice.sql):
#   double-approve:       two approvals of invoice 3; the second waits, then fails with
#                         invoice_already_approved; one payable, two lots.
#   double-approve-nokey: the same for invoice 5, which has no duplicate key, so only the invoice row
#                         lock stands between the two approvals.
#   edit-then-approve:    a credit edit of line 3a is uncommitted while invoice 3 is approved; the
#                         approval waits and posts the edited line (1,5 kg, credited 7,01).
#   approve-then-edit:    an approval is uncommitted while the same credit edit arrives; the edit waits
#                         and fails with invoice_not_in_review; the lot stays 2 kg, credited 0.
#   crossed-items:        invoices 3 and 4 share items X and Y, named in opposite order. A third
#                         session holds Y; invoice 3's approval and then invoice 4's queue behind it.
#                         Both must commit (no deadlock: items are locked in id order), and
#                         last_price follows the invoice date, not the commit order.
# Lock order between approval/review and extraction (review fix, migration 20261022140700):
#   approve-vs-extraction:      the extraction of a copy (inv7) holds the duplicate advisory lock; the
#                               approval of the original (inv6) takes the invoice row and waits for that
#                               lock; the extraction then updates duplicate_of, which needs a KEY SHARE
#                               lock on the original's row. The approval's row lock must not conflict
#                               with it (FOR NO KEY UPDATE, not FOR UPDATE), or the two deadlock.
#   set-supplier-vs-extraction: the same cycle through review_set_supplier (lock_review_invoice, then
#                               app.recheck_duplicate's advisory lock).
# Duplicate override pair (review fix round 2, migration 20261022140800):
#   clear-vs-clear:             inv8 and inv9 warn of each other. The owner clears inv8 (session s1, parked
#                               before commit: it holds inv8 and, through the foreign key of the pair row,
#                               a KEY SHARE lock on inv9); a second owner clears inv9 meanwhile. The same
#                               pair is declared from both sides, so the second waits on the unique pair
#                               index until the first commits (a wait, not a cycle); neither is chosen as
#                               a deadlock victim, both commit, the pair is stored once.
# Duplicate pairs (review fix round 3, migration 20261022140900):
#   clear-repoint:              inv10 (X), inv11 (Y), inv12 (W) share a key; Y and W warn of X. The owner
#                               clears Y (parked before commit: it holds Y and KEY SHARE on X and on W, the
#                               re-pointed warning); a second owner clears W meanwhile and must not wait
#                               (lock_timeout 3 s): FOR NO KEY UPDATE does not conflict with KEY SHARE,
#                               FOR UPDATE would. Then Y and W warn of each other and X is free.
# Duplicate partner (review fix round 4, migration 20261022141000):
#   clear-same-partner:         inv13 (X), inv14 (Y), inv15 (W) share a key; Y and W warn of X. Two sessions
#                               clear Y against X (a double tap, a second tab, a retry). The first is parked
#                               before commit and holds Y's row; the second waits for it, then finds the pair
#                               declared and does nothing. One pair row; the pair (Y, W) is never declared,
#                               Y still warns of W and W stays blocked. Without the fix the second request
#                               declared whichever look-alike came first when it ran, i.e. W.
# Alerts (M6, migrations 20261022150100 and 20261022150200 to 20261022150300):
#   raise-twice:                two sessions raise the same alert (same tenant, kind, entity, business date) at
#                               once. The first is parked before commit; the second waits on the dedup index
#                               alert_dedup_uq, then returns the first's id with inserted = false. One alert.
#   ack-twice:                  the owner acknowledges the kitchen test alert and is parked before commit; the
#                               chef acknowledges it meanwhile and waits for the row lock (FOR UPDATE), then
#                               returns the owner's acknowledgement instead of overwriting it.
# Recipes (M7, migrations 20261023100300 to 20261023100600):
#   version-twice:      the owner saves version 2 of the stew from base 1 and is parked before commit; the chef
#                       saves from base 1 too and waits for the recipe-graph lock; after the first commits the
#                       chef gets version_conflict (not a silent overwrite). Exactly versions 1 and 2.
#   cycle-crossed:      session 1 saves a version of Sub A that uses Sub B (parked); session 2 saves a version
#                       of Sub B that uses Sub A and waits for the graph lock; it then finds the loop and fails
#                       with recipe_cycle. The stored graph has A -> B only.
#   import-vs-version:  the admin's import changes the stew's shelf life (parked); the chef's version from base 1
#                       waits, then gets version_conflict. Versions 1 and 2 only; version 2 is the import's.
#   confirm-then-import: the owner confirms Pepe's allergens {glutine, latte} (parked); the admin's ingredient
#                       import with {uova} waits for the row; after both commit Pepe has the import's list and
#                       is NOT confirmed (the confirmation of the older list is cleared).
# Payables (M9, migration 20261024100000):
#   pay-twice:          the owner marks the payable paid with date d1 and is parked before commit; the admin marks
#                       it paid with d2 meanwhile and waits for the row lock; after the first commits the admin gets
#                       payable_paid_locked (not a silent overwrite). One status_changed audit row; paid_on = d1.
#                       The payable (100,00, supplier A, on a fake invoice) is inserted by the case itself, not by
#                       races_fixture.sql, because the M5 case crossed-items counts every payable of the tenant.
# Payable reminders (M9, migration 20261024100300; the rule reads payables with `for share skip locked`):
#   pay-vs-rules:       the owner marks a payable due 2026-12-10 paid and is parked before commit (it holds the row);
#                       the hourly rules run at 2026-12-03 (D-7) in session 2: they must NOT wait, and raise no
#                       reminder for that payable. After the owner commits, a second run raises none either (paid).
#   pay-rollback:       the same, but the owner rolls back: the next run raises the payable_due_7d reminder (the
#                       payable was skipped, not lost: catch-up). job_run records every run as ok.
#                       Each case inserts its payable itself, like pay-twice.
# Price variance (M8, migrations 20261023110000 and 20261023110600; approve_invoice takes one advisory lock per
# ingredient after the supplier item locks and the recipe graph lock in SHARED mode before the variance check):
#   variance-twice:        two approvals (inv20 on item MZD-1, inv21 on item MZD-2: one ingredient, two items, so only
#                          the ingredient cost lock links them), both at 11,20 against a baseline of 10,00. The owner
#                          parks before commit; the admin waits for the lock, then its baseline includes the owner's
#                          row (10,40), so +7,7 % raises nothing. Exactly ONE price_variance alert (inv20's).
#   approve-vs-version:    the chef saves a version of plate P that adds veal and parks (it holds the graph lock); the
#                          owner approves inv22 (veal +11 %) and waits for the shared graph lock; the alert lists P
#                          with its new margin (the version had committed when the check ran).
#   version-after-approve: the owner approves inv23 (lamb +11 %) and parks after its shared graph lock; the chef's
#                          version of plate Q that adds lamb waits for the approval, then commits; the alert does not
#                          list Q, and Q has versions 1 and 2.
# Raw stock (M12, migrations 20261026100400 and 20261026100500; every write takes the stock advisory lock of its
# ingredient, app.lock_ingredient_stock, before it reads a balance). Each case builds its own stock in its own
# database copy (a second location "Freezer", one ingredient, one lot of 2 kg at "Cella"), so the M5 cases that
# count lots globally are not touched:
#   fefo-same-lot:              the chef wastes 1,5 kg of the only lot and is parked before commit; the owner wastes
#                               1,5 kg too and waits for the stock lock. After both commit: the lot is 0, the unlotted
#                               bucket -1, the total -1, and exactly one negative_stock alert. (Without the lock both
#                               read 2 kg and the lot ends at -1: checked once with a mutated copy of the migrations.)
#   reverse-twice:              a waste is reversed by the chef (parked) and by the owner (waits for the stock lock);
#                               the owner gets already_reversed; one reversal operation, one reversal row.
#   reverse-vs-reverse:         a waste split over the lot and a shortfall row; two sessions reverse it through
#                               DIFFERENT rows; the second waits, then gets already_reversed; exactly two reversal rows
#                               (one operation); reversing the first reversal's row is movement_is_reversal.
#   transfer-vs-waste:          a transfer of the whole lot to Freezer is parked; a waste of 1 kg at Cella waits, then
#                               finds Cella empty: shortfall -1 and an alert; Freezer holds the 2 kg.
#   reverse-transfer-vs-consume: after a committed transfer to Freezer, a waste of 1,5 kg at Freezer is parked; the
#                               reversal of the transfer waits, then gets transfer_already_used; nothing is reversed.
# Counts (M13, migrations 20261027100200 and 20261027100700; count_record_lines takes the session row FOR SHARE then the
# stock lock, count_close and count_cancel take the session row FOR UPDATE then the stock locks). Each case builds its
# own stock: one critical ingredient with a lot of 5 kg at Cella (a second one for line-vs-line) and an open daily
# count at Cella, in its own database copy:
#   count-line-vs-waste:   the chef saves the line (counted 4,5; expected 5) and is parked; the owner wastes 1 kg and
#                          waits for the stock lock. After both commit expected_qty is 5; the close posts -0,5; the
#                          final total is 3,5 (the count and the waste each apply once).
#   waste-vs-count-line:   the owner's waste is parked; the chef's line save waits for the stock lock, then stores
#                          expected_qty 4 (the waste had committed). The close posts +0,5; the final total is 4,5.
#   close-vs-waste:        with the line entered (expected 5, counted 4,5), the close is parked holding the stock lock;
#                          a waste of 1 kg waits and lands on top. Final total 3,5; the count rows sum -0,5.
#   close-twice:           two closes; the second waits for the session row, then gets count_closed. One set of count
#                          rows and one count_session.closed audit event.
#   close-vs-line:         the close is parked; a line save waits for the session row (FOR SHARE against FOR UPDATE),
#                          then gets count_closed; the line keeps its earlier value.
#   line-vs-line:          two saves of different lines of one session at once (both FOR SHARE): the second must not
#                          wait for the first (lock_timeout 3 s); both commit.
#   invariants-vs-approve: an approve_invoice is parked after it inserted its lot and receipt; the nightly check in a
#                          second session does not wait and finds no drift (uncommitted rows are invisible, and the
#                          ledger checks are one statement); after the commit a second look finds none either.
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
INV3=00000000-0000-4000-8000-000000000003
INV4=00000000-0000-4000-8000-000000000004
INV5=00000000-0000-4000-8000-000000000005
INV6=00000000-0000-4000-8000-000000000006
INV7=00000000-0000-4000-8000-000000000007
INV8=00000000-0000-4000-8000-000000000008
INV9=00000000-0000-4000-8000-000000000009
INV10=00000000-0000-4000-8000-000000000010
INV11=00000000-0000-4000-8000-000000000011
INV12=00000000-0000-4000-8000-000000000012
INV13=00000000-0000-4000-8000-000000000013
INV14=00000000-0000-4000-8000-000000000014
INV15=00000000-0000-4000-8000-000000000015
ALERT_K=a1e00000-0000-4000-8000-0000000000a1
TENANT_A=11111111-1111-4111-8111-111111111111
OWNER_USER=a1000000-0000-4000-8000-00000000000a
CHEF_USER=c1000000-0000-4000-8000-00000000000c
SUPPLIER_A=5a000000-0000-4000-8000-00000000005a
L3A=a2000000-0000-4000-8000-0000000003a1
ITEM_Y=59000000-0000-4000-8000-000000000059
L1=a2000000-0000-4000-8000-000000000001
L2=a2000000-0000-4000-8000-000000000002
ITEM=54000000-0000-4000-8000-000000000054
SUPPLIER_B=5b000000-0000-4000-8000-00000000005b
ING='{"ingredient_id":"1a000000-0000-4000-8000-00000000001a"}'
STEW=ec000000-0000-4000-8000-000000000e01
SUBA=ec000000-0000-4000-8000-000000000e0a
SUBB=ec000000-0000-4000-8000-000000000e0b
PAY1=90000000-0000-4000-8000-000000000001
PEPE=1e000000-0000-4000-8000-00000000001e
BEEF=1a000000-0000-4000-8000-00000000001a
SEDANO=1d000000-0000-4000-8000-00000000001d
PRICE_ALERTS="select count(*) from public.alert where kind = 'price_variance'"
PLATE_P=ec000000-0000-4000-8000-000000000e11
PLATE_Q=ec000000-0000-4000-8000-000000000e12
VEAL_D=1f000000-0000-4000-8000-000000000b02
LAMB_D=1f000000-0000-4000-8000-000000000b03
OWNER="set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a',
  'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111',
  'app_role', 'owner')::text, true);"
CHEF="set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-4000-8000-00000000000c',
  'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111',
  'app_role', 'chef')::text, true);"
ADMIN="set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f0000000-0000-4000-8000-00000000000f',
  'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111',
  'app_role', 'admin')::text, true);"
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

# Session s1 runs $1 inside a transaction and parks before commit; session s2 then runs $2 in its own
# transaction; once s2 is waiting for a lock (or has finished) the gate opens. Sets rc1 and rc2.
two_sessions() {
  PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $OWNER $1 $WAIT_GATE commit;" \
    >"$WORK/s1.out" 2>&1 &
  local s1=$!
  parked s1 "$s1"
  PGAPPNAME=s2 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $OWNER $2 commit;" \
    >"$WORK/s2.out" 2>&1 &
  local s2=$!
  finished_or_blocked s2 "$s2"
  query "insert into race.gate values (true)" >/dev/null
  rc1=0 rc2=0
  wait "$s1" || rc1=$?
  wait "$s2" || rc2=$?
}
# Like two_sessions, but as the migration owner (no role switch): for app.* functions no API role can run.
two_sessions_plain() {
  PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $1 $WAIT_GATE commit;" >"$WORK/s1.out" 2>&1 &
  local s1=$!
  parked s1 "$s1"
  PGAPPNAME=s2 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $2 commit;" >"$WORK/s2.out" 2>&1 &
  local s2=$!
  finished_or_blocked s2 "$s2"
  query "insert into race.gate values (true)" >/dev/null
  rc1=0 rc2=0
  wait "$s1" || rc1=$?
  wait "$s2" || rc2=$?
}
failed_with() { # failed_with <file> <text>: the session exited with an error that names <text>
  if grep -q "$2" "$1"; then echo yes; else echo no; fi
}
approved_counts() { # approved_counts <invoice>: payables/lots/movements/prices of the invoice
  query "select (select count(*) from public.payable where invoice_id = '$1') || '/'
      || (select count(*) from public.raw_lot r join public.invoice_line l on l.id = r.invoice_line_id
           where l.invoice_id = '$1') || '/'
      || (select count(*) from public.stock_movement m join public.invoice_line l on l.id = m.ref_id
           where l.invoice_id = '$1') || '/'
      || (select count(*) from public.price_history p join public.invoice_line l on l.id = p.invoice_line_id
           where l.invoice_id = '$1')"
}
approve() { echo "select public.approve_invoice('$1');"; }
credit_edit() { echo "select public.review_update_line('$INV3', '$L3A', '{\"credit_qty\":0.5}');"; }

CASE=double-approve
fresh_db double_approve
two_sessions "$(approve $INV3)" "$(approve $INV3)"
[ "$rc1" = 0 ] || cat "$WORK/s1.out" >&2
check "double-approve: the first approval commits" "$rc1" 0
check "double-approve: the second approval fails" "$([ "$rc2" != 0 ] && echo failed || echo succeeded)" failed
check "double-approve: with invoice_already_approved" "$(failed_with "$WORK/s2.out" invoice_already_approved)" yes
check "double-approve: one payable, two lots, two movements, two prices (AT5)" "$(approved_counts $INV3)" 1/2/2/2
check "double-approve: one audit row" \
  "$(query "select count(*) from public.audit_event where entity_id = '$INV3'")" 1
drop_db

CASE=double-approve-nokey
fresh_db double_approve_nokey
two_sessions "$(approve $INV5)" "$(approve $INV5)"
[ "$rc1" = 0 ] || cat "$WORK/s1.out" >&2
check "double-approve-nokey: the first approval commits" "$rc1" 0
check "double-approve-nokey: the second approval fails" "$([ "$rc2" != 0 ] && echo failed || echo succeeded)" failed
check "double-approve-nokey: with invoice_already_approved" "$(failed_with "$WORK/s2.out" invoice_already_approved)" yes
check "double-approve-nokey: one payable, one lot, one movement, one price" "$(approved_counts $INV5)" 1/1/1/1
drop_db

CASE=edit-then-approve
fresh_db edit_then_approve
two_sessions "$(credit_edit)" "$(approve $INV3)"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "edit-then-approve: the edit commits" "$rc1" 0
check "edit-then-approve: the approval commits" "$rc2" 0
check "edit-then-approve: the lot of line 3a is 1,5 kg (the edited line)" \
  "$(query "select qty_received from public.raw_lot where invoice_line_id = '$L3A'")" 1.5000
check "edit-then-approve: the credited value is 7,01" \
  "$(query "select credited_amount from public.payable where invoice_id = '$INV3'")" 7.01
drop_db

CASE=approve-then-edit
fresh_db approve_then_edit
two_sessions "$(approve $INV3)" "$(credit_edit)"
[ "$rc1" = 0 ] || cat "$WORK/s1.out" >&2
check "approve-then-edit: the approval commits" "$rc1" 0
check "approve-then-edit: the edit fails" "$([ "$rc2" != 0 ] && echo failed || echo succeeded)" failed
check "approve-then-edit: with invoice_not_in_review" "$(failed_with "$WORK/s2.out" invoice_not_in_review)" yes
check "approve-then-edit: the lot of line 3a is 2 kg" \
  "$(query "select qty_received from public.raw_lot where invoice_line_id = '$L3A'")" 2.0000
check "approve-then-edit: the credited value is 0" \
  "$(query "select credited_amount from public.payable where invoice_id = '$INV3'")" 0.00
check "approve-then-edit: the line itself still has no credit" \
  "$(query "select credit_qty from public.invoice_line where id = '$L3A'")" 0.0000
drop_db

CASE=crossed-items
fresh_db crossed_items
# h holds item Y, so the first approval (invoice 3, which names Y first) waits for it while holding X
# when items are locked in id order, and holds nothing when they are locked in line order; invoice 4
# (X first) queues behind it. Without a lock order that is a deadlock as soon as h lets go.
PGAPPNAME=h psql -X -v ON_ERROR_STOP=1 -q -d "$DB" \
  -c "begin; select 1 from public.supplier_item where id = '$ITEM_Y' for update; $WAIT_GATE commit;" \
  >"$WORK/h.out" 2>&1 &
h=$!
parked h "$h"
PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $OWNER $(approve $INV3) commit;" \
  >"$WORK/s1.out" 2>&1 &
s1=$!
finished_or_blocked s1 "$s1"
PGAPPNAME=s2 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $OWNER $(approve $INV4) commit;" \
  >"$WORK/s2.out" 2>&1 &
s2=$!
finished_or_blocked s2 "$s2"
query "insert into race.gate values (true)" >/dev/null
rc_h=0 rc1=0 rc2=0
wait "$h" || rc_h=$?
wait "$s1" || rc1=$?
wait "$s2" || rc2=$?
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "crossed-items: the item holder commits" "$rc_h" 0
check "crossed-items: invoice 3's approval commits" "$rc1" 0
check "crossed-items: invoice 4's approval commits (no deadlock)" "$rc2" 0
check "crossed-items: two payables and four lots" \
  "$(query "select (select count(*) from public.payable) || '/' || (select count(*) from public.raw_lot)")" 2/4
check "crossed-items: X's last_price is invoice 3's (later invoice date), not invoice 4's" \
  "$(query "select last_price from public.supplier_item where supplier_code = 'VIT-1'")" 10.0000
check "crossed-items: Y's last_price is invoice 3's too" \
  "$(query "select last_price from public.supplier_item where supplier_code = 'SED-1'")" 12.7500
drop_db

# Session h plays the extraction of inv7 (a copy of inv6): it takes the duplicate advisory lock first and
# parks; session s1 then runs $1 on inv6 as the owner and waits for that lock; once it is waiting the gate
# opens and h runs the real extraction_complete, whose update of duplicate_of needs a KEY SHARE lock on
# inv6's row. Sets rc_h and rc1.
extraction_race() {
  local lock="select pg_advisory_xact_lock(app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111',
    'IT12345678903', 'Fornitore Demo Srl', 'FT 6', '2026-09-29'));"
  local result='{"header":{"supplier_vat":"IT12345678903","supplier_name":"Fornitore Demo Srl","number_raw":"FT 6","invoice_date":"2026-09-29","due_date":"2026-10-31","net_total":10,"vat_total":1,"gross_total":11},"lines":[],"gate_flags":[],"totals_diff":0,"field_confidence":{},"extraction_json":{}}'
  PGAPPNAME=h psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $lock $WAIT_GATE
    select public.extraction_complete('$INV7', '7c000000-0000-4000-8000-00000000007c', '$result'::jsonb, 'test-model');
    commit;" >"$WORK/h.out" 2>&1 &
  local h=$!
  parked h "$h"
  PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $OWNER $1 commit;" >"$WORK/s1.out" 2>&1 &
  local s1=$!
  finished_or_blocked s1 "$s1"
  query "insert into race.gate values (true)" >/dev/null
  rc_h=0 rc1=0
  wait "$h" || rc_h=$?
  wait "$s1" || rc1=$?
  [ "$rc_h$rc1" = 00 ] || cat "$WORK/h.out" "$WORK/s1.out" >&2
}
no_deadlock() { # no_deadlock: neither session was chosen as the deadlock victim
  if grep -qi "deadlock detected" "$WORK/h.out" "$WORK/s1.out"; then echo no; else echo yes; fi
}

CASE=approve-vs-extraction
fresh_db approve_vs_extraction
extraction_race "$(approve $INV6)"
check "approve-vs-extraction: no deadlock" "$(no_deadlock)" yes
check "approve-vs-extraction: the extraction commits" "$rc_h" 0
check "approve-vs-extraction: the approval commits" "$rc1" 0
check "approve-vs-extraction: the original is approved" \
  "$(query "select status from public.invoice where id = '$INV6'")" approved
check "approve-vs-extraction: the copy is a duplicate of it" \
  "$(query "select status || ' ' || duplicate_of from public.invoice where id = '$INV7'")" "duplicate $INV6"
drop_db

CASE=set-supplier-vs-extraction
fresh_db set_supplier_vs_extraction
extraction_race "select public.review_set_supplier('$INV6', '$SUPPLIER_A', null);"
check "set-supplier-vs-extraction: no deadlock" "$(no_deadlock)" yes
check "set-supplier-vs-extraction: the extraction commits" "$rc_h" 0
check "set-supplier-vs-extraction: the supplier change commits" "$rc1" 0
check "set-supplier-vs-extraction: the original stays in review" \
  "$(query "select status from public.invoice where id = '$INV6'")" review
check "set-supplier-vs-extraction: the copy is a duplicate of it" \
  "$(query "select status || ' ' || duplicate_of from public.invoice where id = '$INV7'")" "duplicate $INV6"
drop_db

CASE=clear-vs-clear
fresh_db clear_vs_clear
two_sessions "select public.review_clear_duplicate('$INV8', '$INV9');" "select public.review_clear_duplicate('$INV9', '$INV8');"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "clear-vs-clear: no deadlock" "$(no_deadlock)" yes
check "clear-vs-clear: the first clear commits" "$rc1" 0
check "clear-vs-clear: the second clear commits (after waiting for the pair the first declared)" "$rc2" 0
check "clear-vs-clear: each is cleared against the other" \
  "$(query "select string_agg(right(id::text, 1) || '>' || right(duplicate_override_of::text, 1), ' ' order by id)
              from public.invoice where id in ('$INV8', '$INV9')")" "8>9 9>8"
check "clear-vs-clear: both are in review, with no warning left" \
  "$(query "select count(*) from public.invoice where id in ('$INV8', '$INV9') and status = 'review' and duplicate_warning_of is null")" 2
check "clear-vs-clear: the pair is stored once" "$(query "select count(*) from public.invoice_duplicate_decision")" 1
drop_db

CASE=clear-repoint
fresh_db clear_repoint
# Y (inv11) is cleared against X and parked: it holds its own row, KEY SHARE on X and on W (the re-pointed
# warning). The owner clearing W (inv12) meanwhile needs its own row (FOR NO KEY UPDATE, which does not
# conflict with that KEY SHARE; FOR UPDATE would) and must not wait (lock_timeout 3 s makes a wait a failure).
PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" \
  -c "begin; $OWNER select public.review_clear_duplicate('$INV11', '$INV10'); $WAIT_GATE commit;" >"$WORK/s1.out" 2>&1 &
s1=$!
parked s1 "$s1"
rc2=0
PGAPPNAME=s2 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" \
  -c "begin; set local lock_timeout = '3s'; $OWNER select public.review_clear_duplicate('$INV12', '$INV10'); commit;" \
  >"$WORK/s2.out" 2>&1 || rc2=$?
query "insert into race.gate values (true)" >/dev/null
rc1=0
wait "$s1" || rc1=$?
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "clear-repoint: the second clear does not wait for the first" "$rc2" 0
check "clear-repoint: the first clear commits" "$rc1" 0
check "clear-repoint: each warns of the other (the pair Y/W is still to confirm)" \
  "$(query "select string_agg(right(id::text, 2) || '>' || right(duplicate_warning_of::text, 2), ' ' order by id)
              from public.invoice where id in ('$INV11', '$INV12')")" "11>12 12>11"
check "clear-repoint: both pairs against X are stored" \
  "$(query "select count(*) from public.invoice_duplicate_decision where other_id = '$INV10'")" 2
check "clear-repoint: X is free, Y and W are not" \
  "$(query "select string_agg(right(i.id::text, 2) || '=' || (app.undeclared_look_alike(i.id) is not null)::text, ' ' order by i.id)
              from public.invoice i where i.id in ('$INV10', '$INV11', '$INV12')")" "10=false 11=true 12=true"
drop_db

CASE=clear-same-partner
fresh_db clear_same_partner
two_sessions "select public.review_clear_duplicate('$INV14', '$INV13');" "select public.review_clear_duplicate('$INV14', '$INV13');"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "clear-same-partner: the first clear commits" "$rc1" 0
check "clear-same-partner: the second clear commits, as a no-op" "$rc2" 0
check "clear-same-partner: one pair row, Y against X"   "$(query "select count(*) || ' ' || coalesce(min(right(other_id::text, 2)), '-') from public.invoice_duplicate_decision where invoice_id = '$INV14'")" "1 13"
check "clear-same-partner: Y is never declared against W"   "$(query "select count(*) from public.invoice_duplicate_decision where '$INV15' in (invoice_id, other_id)")" 0
check "clear-same-partner: one audit row for Y"   "$(query "select count(*) from public.audit_event where entity_id = '$INV14'")" 1
check "clear-same-partner: Y still warns of W, and W is still blocked"   "$(query "select right(duplicate_warning_of::text, 2) || ' ' || (app.undeclared_look_alike('$INV15') is not null)::text
              from public.invoice where id = '$INV14'")" "15 true"
drop_db

CASE=raise-twice
fresh_db raise_twice
two_sessions_plain "insert into race.result select 's1', alert_id || '|' || inserted from app.raise_alert('$TENANT_A', 'test_alert', 'tenant', '$TENANT_A', '{}');" \
  "insert into race.result select 's2', alert_id || '|' || inserted from app.raise_alert('$TENANT_A', 'test_alert', 'tenant', '$TENANT_A', '{}');"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "raise-twice: both sessions commit" "$rc1$rc2" 00
check "raise-twice: exactly one alert (AT1)" \
  "$(query "select count(*) from public.alert where kind = 'test_alert' and entity_id = '$TENANT_A'")" 1
check "raise-twice: the first inserted it" \
  "$(query "select split_part(value, '|', 2) from race.result where label = 's1'")" true
check "raise-twice: the second inserted nothing" \
  "$(query "select split_part(value, '|', 2) from race.result where label = 's2'")" false
check "raise-twice: and got the first's id" \
  "$(query "select (select split_part(value, '|', 1) from race.result where label = 's2')
              = (select id::text from public.alert where kind = 'test_alert')")" t
drop_db

CASE=ack-twice
fresh_db ack_twice
PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" \
  -c "begin; $OWNER insert into race.result select 'owner', public.acknowledge_alert('$ALERT_K')::text; $WAIT_GATE commit;" \
  >"$WORK/s1.out" 2>&1 &
s1=$!
parked s1 "$s1"
PGAPPNAME=s2 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" \
  -c "begin; $CHEF insert into race.result select 'chef', public.acknowledge_alert('$ALERT_K')::text; commit;" \
  >"$WORK/s2.out" 2>&1 &
s2=$!
finished_or_blocked s2 "$s2"
query "insert into race.gate values (true)" >/dev/null
rc1=0 rc2=0
wait "$s1" || rc1=$?
wait "$s2" || rc2=$?
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "ack-twice: the owner's acknowledgement commits" "$rc1" 0
check "ack-twice: the chef's call commits, as a no-op" "$rc2" 0
check "ack-twice: the alert was acknowledged by the owner (AT4)" \
  "$(query "select acknowledged_by from public.alert where id = '$ALERT_K'")" "$OWNER_USER"
check "ack-twice: the chef's call returned the owner's acknowledgement" \
  "$(query "select (select value::jsonb ->> 'acknowledgedBy' from race.result where label = 'chef')
              = (select value::jsonb ->> 'acknowledgedBy' from race.result where label = 'owner')")" t
check "ack-twice: with the same time" \
  "$(query "select (select value::jsonb ->> 'acknowledgedAt' from race.result where label = 'chef')
              = (select value::jsonb ->> 'acknowledgedAt' from race.result where label = 'owner')")" t
drop_db


# Session s1 runs $2 as role prefix $1 and parks before commit; session s2 then runs $4 as role prefix $3;
# once s2 is waiting for a lock (or has finished) the gate opens. Sets rc1 and rc2.
two_sessions_as() {
  PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $1 $2 $WAIT_GATE commit;" >"$WORK/s1.out" 2>&1 &
  local s1=$!
  parked s1 "$s1"
  PGAPPNAME=s2 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $3 $4 commit;" >"$WORK/s2.out" 2>&1 &
  local s2=$!
  finished_or_blocked s2 "$s2"
  # 1 when s2 is waiting for a lock now (held by the parked s1), 0 when it has already finished.
  s2_blocked=$(query "select count(*) from pg_stat_activity where datname = '$DB' and application_name = 's2' and wait_event_type = 'Lock'")
  # 1 when what s2 waits for is an advisory lock (M12: the stock lock), not a row or a unique-index conflict.
  s2_advisory=$(query "select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.datname = '$DB' and a.application_name = 's2' and l.locktype = 'advisory' and not l.granted")
  query "insert into race.gate values (true)" >/dev/null
  rc1=0 rc2=0
  wait "$s1" || rc1=$?
  wait "$s2" || rc2=$?
}
stew_body() { # stew_body <shelf life hours>
  echo "{\"name\":\"Spezzatino (demo)\",\"outputQty\":6,\"outputUnit\":\"kg\",\"portionsPerBatch\":30,\"shelfLifeHours\":$1,\"prepTimeMin\":180,\"minPortions\":5,\"targetPortions\":30,\"lines\":[{\"ingredientId\":\"$BEEF\",\"qty\":5,\"unit\":\"kg\"}]}"
}
stew_version() { echo "select public.create_recipe_version('$STEW', 1, '$(stew_body "$1")'::jsonb);"; }
stew_versions() { query "select string_agg(version::text || ':' || shelf_life_hours, ',' order by version) from public.recipe where recipe_key = '$STEW'"; }
sub_body() { # sub_body <name> <the other sub's key>
  echo "{\"name\":\"$1\",\"outputQty\":1,\"outputUnit\":\"kg\",\"lines\":[{\"ingredientId\":\"$SEDANO\",\"qty\":1,\"unit\":\"kg\"},{\"recipeKey\":\"$2\",\"qty\":0.5,\"unit\":\"kg\"}]}"
}

CASE=version-twice
fresh_db version_twice
two_sessions_as "$OWNER" "$(stew_version 48)" "$CHEF" "$(stew_version 24)"
[ "$rc1" = 0 ] || cat "$WORK/s1.out" >&2
check "version-twice: the owner's version commits" "$rc1" 0
check "version-twice: the chef's version from the same base fails" "$([ "$rc2" != 0 ] && echo failed || echo succeeded)" failed
check "version-twice: with version_conflict" "$(failed_with "$WORK/s2.out" version_conflict)" yes
check "version-twice: exactly versions 1 and 2, and version 2 is the owner's (AT1)" "$(stew_versions)" "1:72,2:48"
check "version-twice: the key points at version 2" "$(query "select current_version from public.recipe_key where id = '$STEW'")" 2
drop_db

CASE=cycle-crossed
fresh_db cycle_crossed
two_sessions_as "$OWNER" "select public.create_recipe_version('$SUBA', 1, '$(sub_body 'Sub A (demo)' $SUBB)'::jsonb);" \
  "$OWNER" "select public.create_recipe_version('$SUBB', 1, '$(sub_body 'Sub B (demo)' $SUBA)'::jsonb);"
[ "$rc1" = 0 ] || cat "$WORK/s1.out" >&2
check "cycle-crossed: A -> B commits" "$rc1" 0
check "cycle-crossed: B -> A fails" "$([ "$rc2" != 0 ] && echo failed || echo succeeded)" failed
check "cycle-crossed: with recipe_cycle (AT2)" "$(failed_with "$WORK/s2.out" recipe_cycle)" yes
check "cycle-crossed: the stored graph has A -> B only" \
  "$(query "select string_agg(right(r.recipe_key::text, 1) || '>' || right(l.sub_recipe_key::text, 1), ' ') from public.recipe_line l join public.recipe r on r.id = l.recipe_id join public.recipe_key k on k.id = r.recipe_key and k.current_version = r.version where l.sub_recipe_key is not null")" "a>b"
check "cycle-crossed: B stays at version 1" "$(query "select current_version from public.recipe_key where id = '$SUBB'")" 1
drop_db

CASE=import-vs-version
fresh_db import_vs_version
IMPORT_ROW="[{\"name\":\"Spezzatino (demo)\",\"type\":\"batch\",\"outputQty\":6,\"outputUnit\":\"kg\",\"portionsPerBatch\":30,\"shelfLifeHours\":48,\"prepTimeMin\":180,\"minPortions\":5,\"targetPortions\":30,\"lines\":[{\"ingredient\":\"Manzo\",\"qty\":5,\"unit\":\"kg\"}]}]"
two_sessions_as "$ADMIN" "select public.import_recipes('$IMPORT_ROW'::jsonb, false);" "$CHEF" "$(stew_version 24)"
[ "$rc1" = 0 ] || cat "$WORK/s1.out" >&2
check "import-vs-version: the import commits" "$rc1" 0
check "import-vs-version: the chef's version from base 1 fails" "$([ "$rc2" != 0 ] && echo failed || echo succeeded)" failed
check "import-vs-version: with version_conflict" "$(failed_with "$WORK/s2.out" version_conflict)" yes
check "import-vs-version: versions 1 and 2 only, version 2 is the import's (AT1)" "$(stew_versions)" "1:72,2:48"
drop_db

CASE=confirm-then-import
fresh_db confirm_then_import
two_sessions_as "$OWNER" "select public.confirm_ingredient_allergens('$PEPE', '{glutine,latte}');" \
  "$ADMIN" "select public.import_ingredients('[{\"row\":2,\"name\":\"Pepe (demo)\",\"base_unit\":\"kg\",\"allergens\":[\"uova\"]}]'::jsonb);"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "confirm-then-import: the confirmation commits" "$rc1" 0
check "confirm-then-import: the import commits after waiting for the row" "$rc2" 0
check "confirm-then-import: Pepe has the import's list" "$(query "select allergens from public.ingredient where id = '$PEPE'")" "{uova}"
check "confirm-then-import: and is not confirmed (AT6)" \
  "$(query "select allergen_status || ' ' || (allergens_confirmed_at is null) || ' ' || (allergens_confirmed_by is null) from public.ingredient where id = '$PEPE'")" "declared true true"
drop_db

CASE=pay-twice
fresh_db pay_twice
query "insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, supplier_id, number_raw, invoice_date)
  values ('00000000-0000-4000-8000-000000000016', '$TENANT_A',
          '$TENANT_A/2026/00000000-0000-4000-8000-000000000016.pdf', 'application/pdf', 100, '$SUPPLIER_A', 'FT 16', '2026-11-10');
  insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date,
                              due_date_source, created_by)
  values ('$PAY1', '$TENANT_A', '00000000-0000-4000-8000-000000000016', '$SUPPLIER_A', 100, 0, 100, '2026-12-10',
          'invoice', '$OWNER_USER')" >/dev/null
D1=$(query "select (now() at time zone 'Europe/Rome')::date")
D2=$(query "select (now() at time zone 'Europe/Rome')::date - 1")
two_sessions_as "$OWNER" "select public.set_payable_status('$PAY1', 'paid', '$D1');" \
  "$ADMIN" "select public.set_payable_status('$PAY1', 'paid', '$D2');"
[ "$rc1" = 0 ] || cat "$WORK/s1.out" >&2
check "pay-twice: the owner's payment commits" "$rc1" 0
check "pay-twice: the admin's second payment fails" "$([ "$rc2" != 0 ] && echo failed || echo succeeded)" failed
check "pay-twice: with payable_paid_locked" "$(failed_with "$WORK/s2.out" payable_paid_locked)" yes
check "pay-twice: one status_changed audit row" \
  "$(query "select count(*) from public.audit_event where entity_id = '$PAY1' and action = 'payable.status_changed'")" 1
check "pay-twice: paid_on is the first date" "$(query "select paid_on from public.payable where id = '$PAY1'")" "$D1"
drop_db

# Payable reminders (M9): the hourly rules against a status change that holds the payable row.
add_payable() { # add_payable <n>: payable 9000...0<n> (100,00, due 2026-12-10, open) on a fake invoice
  query "insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, supplier_id, number_raw, invoice_date)
    values ('00000000-0000-4000-8000-0000000000$1', '$TENANT_A',
            '$TENANT_A/2026/00000000-0000-4000-8000-0000000000$1.pdf', 'application/pdf', 100, '$SUPPLIER_A', 'FT $1', '2026-11-10');
    insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date,
                                due_date_source, created_by)
    values ('90000000-0000-4000-8000-0000000000$1', '$TENANT_A', '00000000-0000-4000-8000-0000000000$1', '$SUPPLIER_A',
            100, 0, 100, '2026-12-10', 'invoice', '$OWNER_USER')" >/dev/null
}
reminders_of() { query "select count(*) from public.alert where entity_id = '90000000-0000-4000-8000-0000000000$1' and kind = 'payable_due_7d'"; }
# Like two_sessions_as, but session 1 rolls back instead of committing.
two_sessions_rollback() {
  PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $1 $2 $WAIT_GATE rollback;" >"$WORK/s1.out" 2>&1 &
  local s1=$!
  parked s1 "$s1"
  PGAPPNAME=s2 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $3 $4 commit;" >"$WORK/s2.out" 2>&1 &
  local s2=$!
  finished_or_blocked s2 "$s2"
  s2_blocked=$(query "select count(*) from pg_stat_activity where datname = '$DB' and application_name = 's2' and wait_event_type = 'Lock'")
  query "insert into race.gate values (true)" >/dev/null
  rc1=0 rc2=0
  wait "$s1" || rc1=$?
  wait "$s2" || rc2=$?
}
D7="2026-12-03T09:00Z"

CASE=pay-vs-rules
fresh_db pay_vs_rules
add_payable 17
two_sessions_as "$OWNER" "select public.set_payable_status('90000000-0000-4000-8000-000000000017', 'paid', (now() at time zone 'Europe/Rome')::date);" \
  "" "select app.run_alert_rules('$D7');"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "pay-vs-rules: the payment commits" "$rc1" 0
check "pay-vs-rules: the rules run commits" "$rc2" 0
check "pay-vs-rules: the rules did not wait for the locked payable (skip locked)" "$s2_blocked" 0
check "pay-vs-rules: and raised no reminder for it" "$(reminders_of 17)" 0
check "pay-vs-rules: the payable is paid" "$(query "select status from public.payable where id = '90000000-0000-4000-8000-000000000017'")" paid
query "select app.run_alert_rules('$D7')" >/dev/null
check "pay-vs-rules: a later run raises none either (AT1: paid)" "$(reminders_of 17)" 0
check "pay-vs-rules: every run is recorded ok" "$(query "select count(*) from app.job_run where job = 'alert-rules' and ok")" 2
drop_db

CASE=pay-rollback
fresh_db pay_rollback
add_payable 18
two_sessions_rollback "$OWNER" "select public.set_payable_status('90000000-0000-4000-8000-000000000018', 'paid', (now() at time zone 'Europe/Rome')::date);" \
  "" "select app.run_alert_rules('$D7');"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "pay-rollback: the rules run commits without waiting" "$rc2$s2_blocked" 00
check "pay-rollback: the payable is still open" "$(query "select status from public.payable where id = '90000000-0000-4000-8000-000000000018'")" open
check "pay-rollback: that run raised no reminder (the row was held)" "$(reminders_of 18)" 0
query "select app.run_alert_rules('$D7')" >/dev/null
check "pay-rollback: the next run raises the payable_due_7d reminder (catch-up)" "$(reminders_of 18)" 1
check "pay-rollback: dated D-7 (2026-12-03)" "$(query "select business_date from public.alert where kind = 'payable_due_7d'")" 2026-12-03
drop_db

# Price variance (M8). A plate version that adds an ingredient to a plate that does not use it yet.
plate_with() { # plate_with <plate key> <ingredient id>: version 2 of the plate, plus 0,2 kg of the ingredient
  echo "select public.create_recipe_version('$1', 1, '{\"name\":\"$2\",\"lines\":[{\"ingredientId\":\"1f000000-0000-4000-8000-000000000b04\",\"qty\":1,\"unit\":\"kg\"},{\"ingredientId\":\"$3\",\"qty\":0.2,\"unit\":\"kg\"}]}'::jsonb);"
}

CASE=variance-twice
fresh_db variance_twice
two_sessions_as "$OWNER" "$(approve 00000000-0000-4000-8000-000000000020)" \
  "$ADMIN" "$(approve 00000000-0000-4000-8000-000000000021)"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "variance-twice: the owner's approval commits" "$rc1" 0
check "variance-twice: the admin's approval commits" "$rc2" 0
check "variance-twice: the admin waited for the ingredient cost lock" "$s2_blocked" 1
check "variance-twice: both invoices are approved" \
  "$(query "select count(*) from public.invoice where id in ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000021') and status = 'approved'")" 2
check "variance-twice: exactly one price_variance alert (AT5)" "$(query "$PRICE_ALERTS")" 1
check "variance-twice: it is the first invoice's, +12 % against 10,00" \
  "$(query "select (payload ->> 'invoice_id') || ' ' || (payload ->> 'change_pct') from public.alert where kind = 'price_variance'")" \
  "00000000-0000-4000-8000-000000000020 12.0000"
check "variance-twice: the second invoice's baseline included the first (avg 10,40, +7,7 %)" \
  "$(query "select round(avg(unit_price), 4) from (select unit_price from public.price_history where ingredient_id = '1f000000-0000-4000-8000-000000000b01' and effective_on <= '2026-10-10' and invoice_line_id <> 'a2000000-0000-4000-8000-0000000021a1' order by effective_on desc, seq desc limit 3) x")" 10.4000
drop_db

CASE=approve-vs-version
fresh_db approve_vs_version
two_sessions_as "$CHEF" "$(plate_with $PLATE_P 'Piatto P (demo)' $VEAL_D)" \
  "$OWNER" "$(approve 00000000-0000-4000-8000-000000000022)"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "approve-vs-version: the chef's version commits" "$rc1" 0
check "approve-vs-version: the approval commits" "$rc2" 0
check "approve-vs-version: the approval waited for the recipe graph lock" "$s2_blocked" 1
check "approve-vs-version: plate P has versions 1 and 2" \
  "$(query "select string_agg(version::text, ',' order by version) from public.recipe where recipe_key = '$PLATE_P'")" "1,2"
check "approve-vs-version: one alert, +11 %" \
  "$(query "select count(*) || ' ' || min(payload ->> 'change_pct') from public.alert where kind = 'price_variance'")" "1 11.0000"
check "approve-vs-version: it lists plate P (T1)" \
  "$(query "select count(*) from public.alert a, jsonb_array_elements(a.payload -> 'recipes') e where a.kind = 'price_variance' and e ->> 'recipe_key' = '$PLATE_P'")" 1
check "approve-vs-version: with its new margin (read after the approval)" \
  "$(query "select (select (e ->> 'margin_eur')::numeric from public.alert a, jsonb_array_elements(a.payload -> 'recipes') e where a.kind = 'price_variance' and e ->> 'recipe_key' = '$PLATE_P')
              = (select round(p.gross_margin, 4) from app.plate_cost_rows('$TENANT_A', array['$PLATE_P']::uuid[], null, false) p)")" t
drop_db

CASE=version-after-approve
fresh_db version_after_approve
two_sessions_as "$OWNER" "$(approve 00000000-0000-4000-8000-000000000023)" \
  "$CHEF" "$(plate_with $PLATE_Q 'Piatto Q (demo)' $LAMB_D)"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "version-after-approve: the approval commits" "$rc1" 0
check "version-after-approve: the chef's version commits after waiting" "$rc2" 0
check "version-after-approve: the version waited for the approval's shared graph lock" "$s2_blocked" 1
check "version-after-approve: plate Q has versions 1 and 2" \
  "$(query "select string_agg(version::text, ',' order by version) from public.recipe where recipe_key = '$PLATE_Q'")" "1,2"
check "version-after-approve: one alert, +11 %" \
  "$(query "select count(*) || ' ' || min(payload ->> 'change_pct') from public.alert where kind = 'price_variance'")" "1 11.0000"
check "version-after-approve: it does not list plate Q" \
  "$(query "select count(*) from public.alert a, jsonb_array_elements(a.payload -> 'recipes') e where a.kind = 'price_variance' and e ->> 'recipe_key' = '$PLATE_Q'")" 0
check "version-after-approve: and lists no recipe at all" \
  "$(query "select payload ->> 'recipes_count' from public.alert where kind = 'price_variance'")" 0
drop_db

# Raw stock (M12). A stock fixture per case, inserted as the database owner into the case's own copy.
STK_ING=1a5a0000-0000-4000-8000-000000005a01
STK_LOT=10750000-0000-4000-8000-000000005a01
STK_LINE=a2500000-0000-4000-8000-000000005a01
STK_INV=e5000000-0000-4000-8000-000000005a01
CELLA=10000000-0000-4000-8000-0000000000a1
FREEZER=10000000-0000-4000-8000-0000000000a2
stock_setup() { # stock_setup <lot qty>: Freezer, the ingredient, and one lot (no expiry) with its receipt at Cella
  query "insert into public.location (id, tenant_id, name) values ('$FREEZER', '$TENANT_A', 'Freezer');
    insert into public.ingredient (id, tenant_id, name, base_unit) values ('$STK_ING', '$TENANT_A', 'Manzo muscolo (demo)', 'kg');
    insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
      values ('$STK_INV', '$TENANT_A', '$TENANT_A/2026/$STK_INV.pdf', 'application/pdf', 100, 'review', '$SUPPLIER_A');
    insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
      values ('$STK_LINE', '$TENANT_A', '$STK_INV', 1, 'Stock demo', 1, 10, 10, '{}', '{}');
    insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on,
        qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
      values ('$STK_LOT', '$TENANT_A', '$STK_ING', '$CELLA', '$SUPPLIER_A', '$STK_LINE', 'L-RACE', '2026-10-20', $1, 'kg', $1, 'kg', 1, '$OWNER_USER');
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
      values ('$TENANT_A', '$STK_ING', '$STK_LOT', '$CELLA', 'receipt', $1, 10, 'invoice_line', '$STK_LINE', '2026-10-20', '$OWNER_USER');" >/dev/null
}
as_run() { psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $1 $2 commit;" >/dev/null; }
waste_sql() { echo "select public.post_waste('$STK_ING', $1, 'kg', 'spoilage', '$2', null);"; }
bucket() { query "select coalesce(sum(qty), 0) from public.stock_movement where ingredient_id = '$STK_ING' and location_id = '$2' and raw_lot_id $1"; }
reversal_rows() { query "select count(*) from public.stock_movement where ingredient_id = '$STK_ING' and ref_type = 'reversal'"; }
reversal_ops() { query "select count(distinct ref_id) from public.stock_movement where ingredient_id = '$STK_ING' and ref_type = 'reversal'"; }
STK_ALERTS="select count(*) from public.alert where kind = 'negative_stock' and entity_id = '$STK_ING'"

CASE=fefo-same-lot
fresh_db fefo_same_lot
stock_setup 2
two_sessions_as "$CHEF" "$(waste_sql 1.5 $CELLA)" "$OWNER" "$(waste_sql 1.5 $CELLA)"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "fefo-same-lot: the chef's waste commits" "$rc1" 0
check "fefo-same-lot: the owner's waste commits" "$rc2" 0
check "fefo-same-lot: the owner waited for the stock lock" "$s2_blocked" 1
check "fefo-same-lot: the lot is 0, not -1" "$(bucket "= '$STK_LOT'" $CELLA)" 0.0000
check "fefo-same-lot: the missing 1 kg is one unlotted row" "$(bucket "is null" $CELLA)" -1.0000
check "fefo-same-lot: the total at Cella is -1" "$(bucket "is not distinct from raw_lot_id" $CELLA)" -1.0000
check "fefo-same-lot: exactly one negative_stock alert" "$(query "$STK_ALERTS")" 1
drop_db

CASE=reverse-twice
fresh_db reverse_twice
stock_setup 2
as_run "$CHEF" "$(waste_sql 1 $CELLA)"
W_ROW=$(query "select id from public.stock_movement where ingredient_id = '$STK_ING' and type = 'waste'")
two_sessions_as "$CHEF" "select public.reverse_movement('$W_ROW');" "$OWNER" "select public.reverse_movement('$W_ROW');"
check "reverse-twice: the chef's reversal commits" "$rc1" 0
check "reverse-twice: the owner waited for the stock lock" "$s2_blocked" 1
check "reverse-twice: on the advisory lock, not on the unique index backstop" "$s2_advisory" 1
check "reverse-twice: the owner's reversal fails" "$([ "$rc2" != 0 ] && echo failed || echo committed)" failed
check "reverse-twice: with already_reversed" "$(failed_with "$WORK/s2.out" already_reversed)" yes
check "reverse-twice: one reversal operation" "$(reversal_ops)" 1
check "reverse-twice: one reversal row" "$(reversal_rows)" 1
check "reverse-twice: the lot is back to 2" "$(bucket "= '$STK_LOT'" $CELLA)" 2.0000
drop_db

CASE=reverse-vs-reverse
fresh_db reverse_vs_reverse
stock_setup 1
as_run "$CHEF" "$(waste_sql 2 $CELLA)"
ROW_LOT=$(query "select id from public.stock_movement where ingredient_id = '$STK_ING' and type = 'waste' and raw_lot_id is not null")
ROW_SHORT=$(query "select id from public.stock_movement where ingredient_id = '$STK_ING' and type = 'waste' and raw_lot_id is null")
two_sessions_as "$CHEF" "select public.reverse_movement('$ROW_LOT');" "$OWNER" "select public.reverse_movement('$ROW_SHORT');"
check "reverse-vs-reverse: the first reversal commits" "$rc1" 0
check "reverse-vs-reverse: the second waited for the stock lock" "$s2_blocked" 1
check "reverse-vs-reverse: on the advisory lock, not on the unique index backstop" "$s2_advisory" 1
check "reverse-vs-reverse: the second fails with already_reversed" "$([ "$rc2" != 0 ] && failed_with "$WORK/s2.out" already_reversed)" yes
check "reverse-vs-reverse: exactly two reversal rows" "$(reversal_rows)" 2
check "reverse-vs-reverse: of one operation" "$(reversal_ops)" 1
REV_ROW=$(query "select id from public.stock_movement where ingredient_id = '$STK_ING' and ref_type = 'reversal' limit 1")
rc=0; as_run "$OWNER" "select public.reverse_movement('$REV_ROW');" 2>"$WORK/s3.out" || rc=$?
check "reverse-vs-reverse: reversing a reversal row fails" "$([ "$rc" != 0 ] && echo failed || echo committed)" failed
check "reverse-vs-reverse: with movement_is_reversal" "$(failed_with "$WORK/s3.out" movement_is_reversal)" yes
drop_db

CASE=transfer-vs-waste
fresh_db transfer_vs_waste
stock_setup 2
two_sessions_as "$CHEF" "select public.post_transfer('$STK_ING', 2, 'kg', '$CELLA', '$FREEZER', null);" "$OWNER" "$(waste_sql 1 $CELLA)"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "transfer-vs-waste: the transfer commits" "$rc1" 0
check "transfer-vs-waste: the waste commits" "$rc2" 0
check "transfer-vs-waste: the waste waited for the stock lock" "$s2_blocked" 1
check "transfer-vs-waste: Freezer holds the 2 kg of the lot" "$(bucket "= '$STK_LOT'" $FREEZER)" 2.0000
check "transfer-vs-waste: Cella is at -1 (the waste found it empty)" "$(bucket "is not distinct from raw_lot_id" $CELLA)" -1.0000
check "transfer-vs-waste: as an unlotted shortfall row" "$(bucket "is null" $CELLA)" -1.0000
check "transfer-vs-waste: and one alert" "$(query "$STK_ALERTS")" 1
drop_db

CASE=reverse-transfer-vs-consume
fresh_db reverse_transfer_vs_consume
stock_setup 2
as_run "$CHEF" "select public.post_transfer('$STK_ING', 2, 'kg', '$CELLA', '$FREEZER', null);"
T_ROW=$(query "select id from public.stock_movement where ingredient_id = '$STK_ING' and type = 'transfer' limit 1")
two_sessions_as "$CHEF" "$(waste_sql 1.5 $FREEZER)" "$OWNER" "select public.reverse_movement('$T_ROW');"
check "reverse-transfer-vs-consume: the waste at Freezer commits" "$rc1" 0
check "reverse-transfer-vs-consume: the reversal waited for the stock lock" "$s2_blocked" 1
check "reverse-transfer-vs-consume: the reversal fails with transfer_already_used" "$([ "$rc2" != 0 ] && failed_with "$WORK/s2.out" transfer_already_used)" yes
check "reverse-transfer-vs-consume: nothing was reversed" "$(reversal_rows)" 0
check "reverse-transfer-vs-consume: Freezer holds 0,5 kg" "$(bucket "= '$STK_LOT'" $FREEZER)" 0.5000
drop_db

# Counts (M13). A count fixture per case, inserted as the database owner into the case's own copy: the stock of
# stock_setup (lot of 5 kg at Cella), flagged critical, and an open daily count at Cella started by the chef.
STK_ING2=1a5a0000-0000-4000-8000-000000005a02
STK_LOT2=10750000-0000-4000-8000-000000005a02
STK_LINE2=a2500000-0000-4000-8000-000000005a02
count_setup() { # count_setup [second]: critical ingredient(s) with 5 kg at Cella and an open daily count
  stock_setup 5
  query "update public.ingredient set is_critical = true where id = '$STK_ING';" >/dev/null
  if [ "${1:-}" = second ]; then
    query "insert into public.ingredient (id, tenant_id, name, base_unit, is_critical) values ('$STK_ING2', '$TENANT_A', 'Farina di mais (demo)', 'kg', true);
      insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
        values ('$STK_LINE2', '$TENANT_A', '$STK_INV', 2, 'Stock demo 2', 1, 10, 10, '{}', '{}');
      insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on,
          qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
        values ('$STK_LOT2', '$TENANT_A', '$STK_ING2', '$CELLA', '$SUPPLIER_A', '$STK_LINE2', 'L-RACE2', '2026-10-20', 5, 'kg', 5, 'kg', 1, '$OWNER_USER');
      insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
        values ('$TENANT_A', '$STK_ING2', '$STK_LOT2', '$CELLA', 'receipt', 5, 10, 'invoice_line', '$STK_LINE2', '2026-10-20', '$OWNER_USER');" >/dev/null
  fi
  as_run "$CHEF" "select public.count_start('daily', '$CELLA');"
  SID=$(query "select id from public.count_session where status = 'open'")
}
count_line_sql() { echo "select public.count_record_lines('$SID', '[{\"ingredient_id\":\"$1\",\"qty\":$2,\"unit\":\"kg\"}]'::jsonb);"; }
count_close_sql() { echo "select public.count_close('$SID');"; }
count_row_sum() { query "select coalesce(sum(qty), 0) from public.stock_movement where ref_type = 'count_session' and ref_id = '$SID' and ingredient_id = '$STK_ING'"; }
line_expected() { query "select expected_qty from public.count_line where session_id = '$SID' and ingredient_id = '$STK_ING'"; }
on_hand() { query "select coalesce(sum(qty), 0) from public.stock_movement where ingredient_id = '$1' and location_id = '$CELLA'"; }

CASE=count-line-vs-waste
fresh_db count_line_vs_waste
count_setup
two_sessions_as "$CHEF" "$(count_line_sql $STK_ING 4.5)" "$OWNER" "$(waste_sql 1 $CELLA)"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "count-line-vs-waste: the line save commits" "$rc1" 0
check "count-line-vs-waste: the waste commits" "$rc2" 0
check "count-line-vs-waste: the waste waited for the stock lock" "$s2_advisory" 1
check "count-line-vs-waste: expected_qty is 5 (the line was entered first)" "$(line_expected)" 5.0000
as_run "$CHEF" "$(count_close_sql)"
check "count-line-vs-waste: the close posts -0,5" "$(count_row_sum)" -0.5000
check "count-line-vs-waste: the final total is 3,5" "$(on_hand $STK_ING)" 3.5000
drop_db

CASE=waste-vs-count-line
fresh_db waste_vs_count_line
count_setup
two_sessions_as "$OWNER" "$(waste_sql 1 $CELLA)" "$CHEF" "$(count_line_sql $STK_ING 4.5)"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "waste-vs-count-line: the waste commits" "$rc1" 0
check "waste-vs-count-line: the line save commits" "$rc2" 0
check "waste-vs-count-line: the line save waited for the stock lock" "$s2_advisory" 1
check "waste-vs-count-line: expected_qty is 4 (the waste had committed)" "$(line_expected)" 4.0000
as_run "$CHEF" "$(count_close_sql)"
check "waste-vs-count-line: the close posts +0,5" "$(count_row_sum)" 0.5000
check "waste-vs-count-line: the final total is 4,5" "$(on_hand $STK_ING)" 4.5000
drop_db

CASE=close-vs-waste
fresh_db close_vs_waste
count_setup
as_run "$CHEF" "$(count_line_sql $STK_ING 4.5)"
two_sessions_as "$CHEF" "$(count_close_sql)" "$OWNER" "$(waste_sql 1 $CELLA)"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "close-vs-waste: the close commits" "$rc1" 0
check "close-vs-waste: the waste commits" "$rc2" 0
check "close-vs-waste: the waste waited for the stock lock" "$s2_advisory" 1
check "close-vs-waste: the count rows sum -0,5" "$(count_row_sum)" -0.5000
check "close-vs-waste: the waste landed on top: final total 3,5" "$(on_hand $STK_ING)" 3.5000
drop_db

CASE=close-twice
fresh_db close_twice
count_setup
as_run "$CHEF" "$(count_line_sql $STK_ING 4.5)"
two_sessions_as "$CHEF" "$(count_close_sql)" "$OWNER" "$(count_close_sql)"
check "close-twice: the first close commits" "$rc1" 0
check "close-twice: the second waited for the session row" "$s2_blocked" 1
check "close-twice: the second close fails" "$([ "$rc2" != 0 ] && echo failed || echo committed)" failed
check "close-twice: with count_closed" "$(failed_with "$WORK/s2.out" count_closed)" yes
check "close-twice: one count row" "$(query "select count(*) from public.stock_movement where ref_type = 'count_session' and ref_id = '$SID'")" 1
check "close-twice: one count_session.closed audit event" \
  "$(query "select count(*) from public.audit_event where action = 'count_session.closed' and entity_id = '$SID'")" 1
drop_db

CASE=close-vs-line
fresh_db close_vs_line
count_setup
as_run "$CHEF" "$(count_line_sql $STK_ING 4.5)"
two_sessions_as "$CHEF" "$(count_close_sql)" "$CHEF" "$(count_line_sql $STK_ING 3)"
check "close-vs-line: the close commits" "$rc1" 0
check "close-vs-line: the line save waited for the session row" "$s2_blocked" 1
check "close-vs-line: and not for the stock lock" "$s2_advisory" 0
check "close-vs-line: the line save fails" "$([ "$rc2" != 0 ] && echo failed || echo committed)" failed
check "close-vs-line: with count_closed" "$(failed_with "$WORK/s2.out" count_closed)" yes
check "close-vs-line: the line keeps its earlier value" \
  "$(query "select counted_qty from public.count_line where session_id = '$SID' and ingredient_id = '$STK_ING'")" 4.5000
drop_db

CASE=line-vs-line
fresh_db line_vs_line
count_setup second
two_sessions_as "$CHEF" "$(count_line_sql $STK_ING 4.5)" "$CHEF" "set local lock_timeout = '3s'; $(count_line_sql $STK_ING2 4)"
[ "$rc1$rc2" = 00 ] || cat "$WORK/s1.out" "$WORK/s2.out" >&2
check "line-vs-line: the first save commits" "$rc1" 0
check "line-vs-line: the second save commits" "$rc2" 0
check "line-vs-line: the second did not wait for the first" "$s2_blocked" 0
check "line-vs-line: both lines are entered" \
  "$(query "select count(*) from public.count_line where session_id = '$SID' and counted_qty is not null")" 2
drop_db

CASE=invariants-vs-approve
fresh_db invariants_vs_approve
before_keys=$(query "select coalesce(string_agg(check_key, ','), '-') from app.ledger_checks_body('$TENANT_A', now())")
PGAPPNAME=s1 psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -c "begin; $OWNER $(approve $INV3) $WAIT_GATE commit;" >"$WORK/s1.out" 2>&1 &
s1=$!
parked s1 "$s1"
PGAPPNAME=s2 psql -X -At -v ON_ERROR_STOP=1 -q -d "$DB" \
  -c "select app.run_ledger_invariants(); select coalesce(string_agg(check_key, ','), '-') from app.ledger_checks_body('$TENANT_A', now());" \
  >"$WORK/s2.out" 2>&1 &
s2=$!
finished_or_blocked s2 "$s2"
s2_blocked=$(query "select count(*) from pg_stat_activity where datname = '$DB' and application_name = 's2' and wait_event_type = 'Lock'")
wait "$s2" || rc2=$?
during_keys=$(tail -n 1 "$WORK/s2.out")
query "insert into race.gate values (true)" >/dev/null
rc1=0
wait "$s1" || rc1=$?
check "invariants-vs-approve: the approval commits" "$rc1" 0
check "invariants-vs-approve: the check did not wait for the parked approval" "$s2_blocked" 0
check "invariants-vs-approve: it finished" "${rc2:-0}" 0
check "invariants-vs-approve: the lots and receipts of the parked approval are invisible: nothing new is reported" \
  "$during_keys" "$before_keys"
check "invariants-vs-approve: the approval committed its lots" "$(approved_counts $INV3)" 1/2/2/2
check "invariants-vs-approve: after the commit the check finds the same as before (no drift)" \
  "$(query "select coalesce(string_agg(check_key, ','), '-') from app.ledger_checks_body('$TENANT_A', now())")" "$before_keys"
drop_db

"${PSQL[@]}" -d postgres -c "drop database if exists $TEMPLATE" >/dev/null
if [ "$failures" -gt 0 ]; then
  echo "$failures race check(s) failed" >&2
  exit 1
fi
echo "all race checks passed"
