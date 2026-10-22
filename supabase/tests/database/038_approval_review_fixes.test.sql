-- M5 code-review fixes (migration 20261022140700_approval_review_fixes.sql). One section per fix.
-- Acts as owner A unless stated.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

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
select is(pg_temp.codes(8), '[]'::jsonb, 'D: the cleared copy is not blocked (its own override)');

-- The finder extraction uses is unchanged: a cleared invoice is still a live match for a new copy.
reset role;
select is(app.find_duplicate_invoice_in('11111111-1111-4111-8111-111111111111', 'IT12345678903', 'FT 7',
    '2026-09-29', pg_temp.iid(7)), pg_temp.iid(8),
  'the extraction finder still returns the cleared copy as a match (override is not excluded there)');
select is(app.find_duplicate_invoice_in('11111111-1111-4111-8111-111111111111', 'IT12345678903', 'FT 7',
    '2026-09-29', pg_temp.iid(99)), pg_temp.iid(7),
  'and a new copy is matched against the oldest live invoice, the original');

select * from finish();
rollback;
