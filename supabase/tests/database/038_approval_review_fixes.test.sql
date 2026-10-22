-- M5 code-review fixes (migration 20261022140700_approval_review_fixes.sql). One section per fix.
-- Acts as owner A unless stated.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number, payment_terms_days) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903', 30);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count,
    pack_qty, pack_unit, invoice_unit) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 1, 'kg', 'kg');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella');

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$
  select ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- An approvable invoice n with document number 'FT <num>' (same number = same document), one 2 kg line
-- of 10,00 and consistent totals. dup_of set means status duplicate, pointing at that invoice.
create function pg_temp.mk(n int, num int, dup_of int default null) returns void language plpgsql as $$
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total,
      gross_total, supplier_id, duplicate_of)
  values (pg_temp.iid(n), '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.iid(n) || '.pdf', 'application/pdf', 100,
      case when dup_of is null then 'review' else 'duplicate' end::public.invoice_status,
      'IT12345678903', 'Fornitore Demo Srl', 'FT ' || num, '2026-09-29', '2026-10-31', 10, 1, 11,
      '5a000000-0000-4000-8000-00000000005a',
      case when dup_of is not null then pg_temp.iid(dup_of) end);
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty,
      line_amount, vat_rate, unit, ingredient_id, supplier_item_id, mapping_source, is_stock,
      field_confidence, extracted)
  values (pg_temp.lid(n), '11111111-1111-4111-8111-111111111111', pg_temp.iid(n), 1, 'Manzo', 2, 10, 10,
      'kg', '1a000000-0000-4000-8000-00000000001a', '51000000-0000-4000-8000-000000000051', 'manual',
      true, '{}', '{}');
end
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.approve(n int) returns text language sql as $$
  select pg_temp.err(format('select public.approve_invoice(%L)', pg_temp.iid(n))) $$;
create function pg_temp.clear(n int) returns text language sql as $$
  select pg_temp.err(format('select public.review_clear_duplicate(%L)', pg_temp.iid(n))) $$;
create function pg_temp.codes(n int) returns jsonb language sql as $$
  select jsonb_path_query_array(public.invoice_approval_preview(pg_temp.iid(n)) -> 'blockers', '$[*].code') $$;
create function pg_temp.status(n int) returns text language sql as $$
  select status::text from public.invoice where id = pg_temp.iid(n) $$;

-- Fix 1: after "Non è un doppione" on a copy, the original stays approvable.
-- Group A: O = 1 (review), copy C = 2 (duplicate of 1). Group B: the same, approved in the other order
-- (O = 3, C = 4). Group C: a genuine pair with no decision (5, 6). Group D: O = 7, cleared copy C = 8,
-- and a third copy D = 9 that nobody cleared.
select pg_temp.mk(1, 1);
select pg_temp.mk(2, 1, 1);
select pg_temp.mk(3, 3);
select pg_temp.mk(4, 3, 3);
select pg_temp.mk(5, 5);
select pg_temp.mk(6, 5);
select pg_temp.mk(7, 7);
select pg_temp.mk(8, 7, 7);
select pg_temp.mk(9, 7);
-- Fix 4 fixture: invoice 20 receives 244 packs of 1,2345 x 3,3333 g of Manzo (a kg ingredient): the base
-- factor is 0.00411495885 (11 decimals) and 244 x factor rounds to 1.0040 kg; the factor rounded to 8
-- decimals (0.00411496) would give 1.0041 kg and break raw_lot_qty_ck.
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count,
    pack_qty, pack_unit, invoice_unit) values
  ('52000000-0000-4000-8000-000000000052', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'ODD-1', 1.2345,
   3.3333, 'g', 'conf');
select pg_temp.mk(20, 20);
update public.invoice_line
   set unit = 'conf', qty = 244, line_amount = 100, supplier_item_id = '52000000-0000-4000-8000-000000000052'
 where id = pg_temp.lid(20);
update public.invoice set net_total = 100, vat_total = 10, gross_total = 110 where id = pg_temp.iid(20);

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

select is(pg_temp.codes(1), '[]'::jsonb, 'A: the original has no blocker while the copy is flagged duplicate');
select is(pg_temp.approve(2), 'P0001 duplicate_invoice', 'A: the flagged copy cannot be approved');
select is(pg_temp.clear(2), 'ok', 'A: the owner declares the copy not a duplicate');
select is(pg_temp.status(2), 'review', 'A: the copy is in review');
select is(pg_temp.codes(1), '[]'::jsonb, 'A: the original is still not blocked (was duplicate_invoice)');
select is(pg_temp.codes(2), '[]'::jsonb, 'A: and neither is the cleared copy');
select is(pg_temp.approve(1), 'ok', 'A: the original is approved');
select is(pg_temp.approve(2), 'ok', 'A: the cleared copy is approved too');
select is(pg_temp.status(1) || '/' || pg_temp.status(2), 'approved/approved', 'A: both are approved');

select is(pg_temp.clear(4), 'ok', 'B: the copy is cleared');
select is(pg_temp.approve(4), 'ok', 'B: the cleared copy is approved first');
select is(pg_temp.codes(3), '[]'::jsonb, 'B: the original shows no blocker after the copy is approved');
select is(pg_temp.approve(3), 'ok', 'B: and is approved after it');

select is(pg_temp.codes(5), '["duplicate_invoice"]'::jsonb, 'C: a live copy nobody cleared blocks the first');
select is(pg_temp.codes(6), '["duplicate_invoice"]'::jsonb, 'C: and the second');
select is(pg_temp.approve(5), 'P0001 duplicate_invoice', 'C: approve raises duplicate_invoice');
select is(pg_temp.status(5), 'review', 'C: and writes nothing');

select is(pg_temp.clear(8), 'ok', 'D: the copy is cleared');
select is(pg_temp.codes(7), '["duplicate_invoice"]'::jsonb,
  'D: the original is still blocked by the third copy nobody cleared');
select is(pg_temp.approve(7), 'P0001 duplicate_invoice', 'D: approve of the original raises duplicate_invoice');
-- Round 2: the override of 8 was given for the pair (7, 8) only, so the uncleared third copy 9 blocks it too.
-- Round 3: clearing 8 against 7 re-points it to the next undeclared look-alike, the third copy 9, so 8 is
-- now a duplicate of 9 (status duplicate, which the preview reports with no blocker list) and cannot be approved.
select is(pg_temp.status(8), 'duplicate',
  'D: the cleared copy is re-pointed to the third copy: a duplicate of 9 (its declaration covers the original only)');
select is(pg_temp.approve(8), 'P0001 duplicate_invoice', 'D: and cannot be approved');

-- The finder extraction uses is unchanged: a cleared invoice is still a live match for a new copy.
reset role;
-- (Group A: the copy 2 was cleared against 1, stays in review and was approved; it is still a match.)
select is(app.find_duplicate_invoice_in('11111111-1111-4111-8111-111111111111', 'IT12345678903', 'FT 1',
    '2026-09-29', pg_temp.iid(1)), pg_temp.iid(2),
  'the extraction finder still returns the cleared copy as a match (a declared pair is not excluded there)');
select is(app.find_duplicate_invoice_in('11111111-1111-4111-8111-111111111111', 'IT12345678903', 'FT 7',
    '2026-09-29', pg_temp.iid(99)), pg_temp.iid(7),
  'and a new copy is matched against the oldest live invoice, the original');

-- Fix 3: the ledgers give service_role (and every API role) SELECT and nothing else: no TRIGGER, no
-- REFERENCES, no write of any kind.
create function pg_temp.privs(p_role text, p_table text) returns text[] language sql as $$
  select coalesce(array_agg(p order by p) filter (where has_table_privilege(p_role, p_table, p)), '{}')
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p $$;
select is(pg_temp.privs('service_role', t), '{SELECT}'::text[], t || ': service_role has SELECT only')
  from unnest(array['public.audit_event', 'public.raw_lot', 'public.stock_movement', 'public.price_history',
                    'public.payable']) t;
select is(pg_temp.privs('authenticated', t), '{SELECT}'::text[], t || ': authenticated has SELECT only')
  from unnest(array['public.audit_event', 'public.raw_lot', 'public.stock_movement', 'public.price_history',
                    'public.payable']) t;
select is((select array_agg(t) from unnest(array['public.audit_event', 'public.raw_lot',
    'public.stock_movement', 'public.price_history', 'public.payable']) t
    where pg_temp.privs('anon', t) <> '{}'), null, 'anon has no privilege on any of the five');

-- Fix 4: raw_lot keeps the exact factor, so received = round(source_qty x base_factor, 4) always holds.
select is(pg_temp.codes(20), '[]'::jsonb, 'odd pack: the invoice has no blocker');
select is(pg_temp.approve(20), 'ok', 'odd pack: 244 packs of 1,2345 x 3,3333 g are approved (no raw_lot_qty_ck violation)');
select is((select base_factor from public.raw_lot where invoice_line_id = pg_temp.lid(20)),
  0.00411495885::numeric, 'odd pack: the lot stores the exact factor, 11 decimals');
select is((select qty_received from public.raw_lot where invoice_line_id = pg_temp.lid(20)),
  1.0040::numeric, 'odd pack: and the received quantity is round(244 x factor, 4) = 1,0040 kg');

select * from finish();
rollback;
