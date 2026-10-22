-- M5 code-review fix, round 2 (migration 20261022140800_duplicate_override_pair.sql): "Non è un
-- doppione" releases only the pair it was given for. Acts as owner A.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

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
-- An approvable invoice n with document number 'FT <num>' (same number = same document), one 2 kg line of
-- 10,00 and consistent totals. p_vat null makes it a no-VAT invoice (name key); p_dup_of makes it status
-- duplicate, p_warn_of gives it a name-match warning. created_at follows n, so a lower n is "older".
create function pg_temp.mk(n int, num int, p_vat text default 'IT12345678903', p_dup_of int default null,
    p_warn_of int default null) returns void language plpgsql as $$
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total,
      gross_total, supplier_id, duplicate_of, duplicate_warning_of, created_at)
  values (pg_temp.iid(n), '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.iid(n) || '.pdf', 'application/pdf', 100,
      case when p_dup_of is null then 'review' else 'duplicate' end::public.invoice_status,
      p_vat, 'Fornitore Demo Srl', 'FT ' || num, '2026-09-29', '2026-10-31', 10, 1, 11,
      '5a000000-0000-4000-8000-00000000005a'::uuid,
      case when p_dup_of is not null then pg_temp.iid(p_dup_of) end,
      case when p_warn_of is not null then pg_temp.iid(p_warn_of) end,
      now() - interval '1 day' + n * interval '1 second');
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
-- The partner the screen would send: the first duplicate blocker's partnerId in the approval preview. A caller
-- the preview refuses (chef, waiter, another tenant) sends none, so the procedure's own answer is tested.
create function pg_temp.partner(n int) returns uuid language sql as $$
  select (public.invoice_approval_preview(pg_temp.iid(n)) -> 'blockers' -> 0 ->> 'partnerId')::uuid $$;
create function pg_temp.clear_with(n int, p_partner uuid) returns text language sql as $$
  select pg_temp.err(format('select public.review_clear_duplicate(%L, %L)', pg_temp.iid(n), p_partner)) $$;
create function pg_temp.clear(n int) returns text language plpgsql as $$
declare
  v_partner uuid;
begin
  begin
    v_partner := pg_temp.partner(n);
  exception when others then
    v_partner := null;
  end;
  return pg_temp.clear_with(n, v_partner);
end
$$;
create function pg_temp.header(n int, patch text) returns text language sql as $$
  select pg_temp.err(format('select public.review_update_header(%L, %L::jsonb)', pg_temp.iid(n), patch)) $$;
create function pg_temp.codes(n int) returns jsonb language sql as $$
  select jsonb_path_query_array(public.invoice_approval_preview(pg_temp.iid(n)) -> 'blockers', '$[*].code') $$;
create function pg_temp.status(n int) returns text language sql as $$
  select status::text from public.invoice where id = pg_temp.iid(n) $$;
create function pg_temp.inv(n int) returns public.invoice language sql as $$
  select i from public.invoice i where i.id = pg_temp.iid(n) $$;

-- Fixtures. Repro 1 (VAT): X = 1 (FT 30), Z = 2 (FT 99), Y = 3 is a copy of X misread as FT 99, so it is
-- flagged a duplicate of Z.
select pg_temp.mk(1, 30);
select pg_temp.mk(2, 99);
select pg_temp.mk(3, 99, p_dup_of => 2);
-- Repro 2 (name warning, then the VAT filled in): X2 = 11 (VAT, FT 40); W = 12 and Y = 13 have no VAT and
-- the same name and number, Y warns of W.
select pg_temp.mk(11, 40);
select pg_temp.mk(12, 40, p_vat => null);
select pg_temp.mk(13, 40, p_vat => null, p_warn_of => 12);
-- Name warning re-keyed: W = 16 (FT 50), Y = 15 (FT 50, warns of 16), W2 = 14 (FT 51), all without VAT.
select pg_temp.mk(14, 51, p_vat => null);
select pg_temp.mk(16, 50, p_vat => null);
select pg_temp.mk(15, 50, p_vat => null, p_warn_of => 16);
-- Round trip: original O = 21 (FT 60), copy C = 22 flagged a duplicate of O.
select pg_temp.mk(21, 60);
select pg_temp.mk(22, 60, p_dup_of => 21);
-- A bare override flag: P = 31 and Q = 32 share a key; Q carries the flag but no partner; R = 33 is unrelated.
select pg_temp.mk(31, 70);
select pg_temp.mk(32, 70);
select pg_temp.mk(33, 71);
update public.invoice set duplicate_override = true where id = pg_temp.iid(32);
select pg_temp.mk(34, 72);
select pg_temp.mk(35, 72);
update public.invoice set duplicate_override = true, duplicate_override_of = pg_temp.iid(33)
 where id = pg_temp.iid(35);
-- A stored name warning is released only by an override of that very invoice.
select pg_temp.mk(41, 80, p_vat => null);
select pg_temp.mk(42, 80, p_vat => null, p_warn_of => 41);
select pg_temp.mk(43, 81, p_vat => null);
update public.invoice set duplicate_override = true, duplicate_override_of = pg_temp.iid(43)
 where id = pg_temp.iid(42);

-- Schema.
select has_column('public', 'invoice', 'duplicate_override_of', 'invoice.duplicate_override_of exists');
select col_type_is('public', 'invoice', 'duplicate_override_of', 'uuid', 'it is a uuid');
select col_is_null('public', 'invoice', 'duplicate_override_of', 'and nullable');
select fk_ok('public', 'invoice', array['tenant_id', 'duplicate_override_of'], 'public', 'invoice',
  array['tenant_id', 'id'], 'it is a composite foreign key to invoice (tenant_id, id)');
select throws_ok($$ update public.invoice set duplicate_override_of = id where id = '00000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an invoice cannot be declared a duplicate of itself');

-- Extraction never sees an invoice with a declared pair: the status guard has no way back to extracting.
select throws_ok(format('update public.invoice set status = %L where id = %L', 'extracting', pg_temp.iid(35)),
  'P0001', 'invalid_status_transition', 'extraction: a review invoice cannot go back to extracting');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

select throws_ok($$ update public.invoice set duplicate_override_of = null $$, '42501', null,
  'authenticated has no UPDATE grant on duplicate_override_of');

-- Repro 1: the misread copy is cleared against Z, then corrected to the number of X.
select is(pg_temp.clear(3), 'ok', 'repro 1: Y (a duplicate of Z) is declared not a duplicate of Z');
select is((pg_temp.inv(3)).duplicate_override_of, pg_temp.iid(2), 'repro 1: the declaration names Z');
select is((pg_temp.inv(3)).duplicate_override, true, 'repro 1: the flag and its record are kept');
select is(pg_temp.codes(3), '[]'::jsonb, 'repro 1: Y has no blocker against Z');
select is(pg_temp.header(3, '{"number_raw": "FT 30"}'), 'ok', 'repro 1: the owner corrects Y to FT 30');
select is(pg_temp.status(3), 'duplicate', 'repro 1: Y is flagged again, now against X');
select is((pg_temp.inv(3)).duplicate_of, pg_temp.iid(1), 'repro 1: as a duplicate of X');
select is(pg_temp.approve(3), 'P0001 duplicate_invoice', 'repro 1: Y cannot be approved');
select is(pg_temp.codes(1), '[]'::jsonb, 'repro 1: X is approvable');
select is(pg_temp.approve(1), 'ok', 'repro 1: X is approved');
select is((select count(*)::int from public.payable where invoice_id in (pg_temp.iid(1), pg_temp.iid(3))), 1,
  'repro 1: one payable for the one document');
select is(pg_temp.approve(2), 'ok', 'repro 1: Z (a different document) is approved');
select is(pg_temp.clear(3), 'ok', 'repro 1: a new decision on Y can be made');
select is((pg_temp.inv(3)).duplicate_override_of, pg_temp.iid(1), 'repro 1: and replaces the declared partner with X');

-- Repro 2: a name warning cleared against W, then the VAT filled in by choosing the supplier.
select is(pg_temp.clear(13), 'ok', 'repro 2: Y (warns of W) is declared not a duplicate of W');
select is((pg_temp.inv(13)).duplicate_override_of, pg_temp.iid(12), 'repro 2: the declaration names W');
select is((pg_temp.inv(13)).duplicate_warning_of, null, 'repro 2: the warning is gone');
select is(pg_temp.codes(13), '[]'::jsonb, 'repro 2: Y has no blocker');
select is(pg_temp.err(format('select public.review_set_supplier(%L, %L, null)', pg_temp.iid(13),
    '5a000000-0000-4000-8000-00000000005a'::uuid)), 'ok', 'repro 2: the owner picks the supplier (VAT filled in)');
select is(pg_temp.status(13), 'duplicate', 'repro 2: Y is flagged, a duplicate of X2 (same VAT, number, date)');
select is((pg_temp.inv(13)).duplicate_of, pg_temp.iid(11), 'repro 2: of X2');
select is(pg_temp.approve(13), 'P0001 duplicate_invoice', 'repro 2: Y cannot be approved');
select is(pg_temp.codes(11), '[]'::jsonb, 'repro 2: X2 is approvable');
select is(pg_temp.approve(11), 'ok', 'repro 2: X2 is approved');
select is((select count(*)::int from public.payable where invoice_id in (pg_temp.iid(11), pg_temp.iid(13))), 1,
  'repro 2: one payable');

-- A name warning cleared against W16 and then re-keyed onto another invoice is warned again; back on the
-- declared partner it is quiet.
select is(pg_temp.clear(15), 'ok', 'warning: Y15 is declared not a duplicate of W16');
select is(pg_temp.header(15, '{"number_raw": "FT 51"}'), 'ok', 'warning: Y15 is re-keyed onto FT 51 (W14)');
select is((pg_temp.inv(15)).duplicate_warning_of, pg_temp.iid(14), 'warning: it warns of W14');
select is(pg_temp.codes(15), '["duplicate_warning"]'::jsonb, 'warning: and is blocked');
select is(pg_temp.header(15, '{"number_raw": "FT 50"}'), 'ok', 'warning: Y15 is put back on FT 50 (W16, the declared partner)');
select is(pg_temp.codes(15), '[]'::jsonb, 'warning: the declared pair stays released');
select is((pg_temp.inv(15)).status, 'review', 'warning: and Y15 is still in review');

-- Round trip: O and a cleared copy C, a date edit and back.
select is(pg_temp.clear(22), 'ok', 'round trip: the copy is declared not a duplicate');
select is(pg_temp.header(21, '{"invoice_date": "2026-09-30"}'), 'ok', 'round trip: the original''s date is edited');
select is(pg_temp.header(21, '{"invoice_date": "2026-09-29"}'), 'ok', 'round trip: and set back');
select is(pg_temp.status(21), 'review', 'round trip: the original stays in review (was flipped to duplicate of the copy)');
select is((pg_temp.inv(21)).duplicate_of, null, 'round trip: with no duplicate link');
select is(pg_temp.header(22, '{"invoice_date": "2026-09-30"}') || pg_temp.header(22, '{"invoice_date": "2026-09-29"}'),
  'okok', 'round trip: the copy gets the same edit and back');
select is(pg_temp.status(22), 'review', 'round trip: and stays in review too');
select is(pg_temp.codes(21) || pg_temp.codes(22), '[]'::jsonb, 'round trip: neither has a blocker');
select is(pg_temp.approve(21) || ' ' || pg_temp.approve(22), 'ok ok', 'round trip: both are approved (the owner decided they are two documents)');

-- A bare override flag releases nothing.
select is(pg_temp.codes(31), '["duplicate_invoice"]'::jsonb, 'bare flag: P is blocked by Q');
select is(pg_temp.codes(32), '["duplicate_invoice"]'::jsonb, 'bare flag: Q is blocked by P, its flag names no pair');
select is(pg_temp.codes(35), '["duplicate_invoice"]'::jsonb,
  'bare flag: an override that names an unrelated invoice releases nothing either');
select is(pg_temp.codes(34), '["duplicate_invoice"]'::jsonb, 'bare flag: and does not release its look-alike');
select is(pg_temp.header(32, '{"number_raw": "FT 73"}') || pg_temp.header(32, '{"number_raw": "FT 70"}'), 'okok',
  'bare flag: Q is re-keyed away and back');
select is(pg_temp.status(32) || ' ' || (pg_temp.inv(32)).duplicate_of::text, 'duplicate ' || pg_temp.iid(31)::text,
  'bare flag: the recheck runs for an overridden invoice and flags it against P');

-- A stored warning is released only by the override of its own partner.
select is(pg_temp.codes(42), '["duplicate_warning"]'::jsonb,
  'warning gate: a warning against W41 is not released by an override against 43');

select * from finish();
rollback;
