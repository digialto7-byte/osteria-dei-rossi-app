-- M4 step 3: review helpers in schema app (plan §3.2): description_hash, parse_unit_raw,
-- line_checks, totals_gate, refresh_gate, line_corrected_fields, require_invoice_reviewer,
-- lock_review_invoice, recheck_duplicate.
--
-- The two "vectors" blocks below (marked begin/end) are read by
-- tests/parity/review-sql-parity.test.ts, which runs the same rows through the TypeScript
-- rules in src/server/extraction/checks.ts. Keep one row per line, names without apostrophes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(120);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin DigiAlto');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg'),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Vitello', 'kg');
insert into public.cost_centre (id, tenant_id, name) values
  ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'Pulizie');

-- Claims only (no role switch): the app.* helpers read the caller from request.jwt.claims.
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
-- A tenant A invoice with one line per amount in the space-separated list (qty 1).
create function pg_temp.mk_invoice(p_amounts text default '', p_vat numeric default null,
    p_gross numeric default null, p_status public.invoice_status default 'review',
    p_dup_of uuid default null, p_tenant uuid default '11111111-1111-4111-8111-111111111111')
  returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      vat_total, gross_total, duplicate_of)
    values (v_id, p_tenant, p_tenant || '/2026/' || v_id || '.pdf', 'application/pdf', 100,
      p_status, p_vat, p_gross, p_dup_of);
  insert into public.invoice_line (tenant_id, invoice_id, position, raw_description, qty,
      line_amount, field_confidence, extracted)
    select p_tenant, v_id, a.ord::smallint, 'Riga ' || a.ord, 1, a.amount::numeric, '{}', '{}'
      from unnest(string_to_array(p_amounts, ' ')) with ordinality as a(amount, ord)
     where a.amount <> '';
  return v_id;
end
$$;

-- description_hash.
select is(app.description_hash('  Fesa  di MANZO '), app.description_hash('fesa di manzo'),
  'case, outer and inner spaces do not change the hash');
select isnt(app.description_hash('fesa di manzo'), app.description_hash('fesa di manzo 2'),
  'a different description has a different hash');
select matches(app.description_hash('fesa di manzo'), '^[0-9a-f]{64}$', 'the hash is 64 hex digits');
select is(app.description_hash(null), null, 'null in, null out');
select is(app.description_hash(U&'Caff\00E8 nero'), app.description_hash(U&'Caffe\0300 nero'),
  'NFC and NFD forms of a letter hash alike');
select is(app.description_hash('ABC'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'the hash is SHA-256 of the normalised text (known vector for abc)');
select is(app.description_hash('a' || chr(9) || chr(10) || 'b'), app.description_hash('a b'),
  'tabs and newlines count as spaces');

-- parse_unit_raw: the whole initial list of the plan.
select is(app.parse_unit_raw(v.raw), v.expected, 'parse_unit_raw(' || coalesce(v.raw, 'null') || ')')
  from (values
    ('KG', 'kg'), ('Kg.', 'kg'), ('kgs', 'kg'), ('chilo', 'kg'), ('Chili', 'kg'),
    ('g', 'g'), ('GR', 'g'), ('Grammi', 'g'),
    ('l', 'l'), ('Lt', 'l'), ('litro', 'l'), ('Litri', 'l'),
    ('ml', 'ml'), ('M L', 'ml'),
    ('pz', 'pz'), ('Pz.', 'pz'), ('pezzo', 'pz'), ('pezzi', 'pz'), ('n', 'pz'), ('nr', 'pz'),
    ('NUM', 'pz'), ('cad', 'pz'), ('un', 'pz'),
    ('ct', 'conf'), ('CT', 'conf'), ('crt', 'conf'), ('cartone', 'conf'), ('cf', 'conf'),
    ('conf', 'conf'), ('Confezione', 'conf'), ('Cassa', 'conf'), ('collo', 'conf'), ('sc', 'conf'),
    ('scatola', 'conf'),
    ('boh', null), ('', null), (null, null)
  ) as v(raw, expected);

-- line_checks vectors (shared with the TypeScript parity test).
create temporary table line_check_vectors (name text, qty numeric, unit_price numeric,
  line_amount numeric, vat_rate numeric, expected text[]);
insert into line_check_vectors values
-- begin vectors: line_checks
('amount within tolerance', 2, 4.99, 9.99, 10, '{}'),
('amount off by 0.07', 2, 4.99, 10.05, 10, '{amount_mismatch}'),
('amount off by exactly 0.05', 2, 5, 10.05, 10, '{}'),
('amount off by 0.0501', 2, 5, 10.0501, 10, '{amount_mismatch}'),
('amount below by 0.06', 2, 5, 9.94, 10, '{amount_mismatch}'),
('no unit price skips the amount check', 2, null, 99, 10, '{}'),
('vat 7 is unexpected', 2, 5, 10, 7, '{vat_rate_unexpected}'),
('vat 22 is allowed', 2, 5, 10, 22, '{}'),
('vat 0 is allowed', 2, 5, 10, 0, '{}'),
('vat 4 is allowed', 2, 5, 10, 4, '{}'),
('vat 5 is allowed', 2, 5, 10, 5, '{}'),
('vat unknown is not checked', 2, 5, 10, null, '{}'),
('vat 10.5 is unexpected', 2, 5, 10, 10.5, '{vat_rate_unexpected}'),
('both checks fail', 2, 5, 20, 7, '{amount_mismatch,vat_rate_unexpected}'),
('zero quantity and amount', 0, 5, 0, 10, '{}'),
('four decimal price', 3, 0.3333, 1, 10, '{}')
-- end vectors: line_checks
;
select is(app.line_checks(v.qty, v.unit_price, v.line_amount, v.vat_rate), v.expected, v.name)
  from line_check_vectors v;
select is(app.allowed_vat_rates(), array[0, 4, 5, 10, 22]::numeric[], 'allowed VAT rates');
select is(app.total_tolerance_ten_thousandths(), 500, 'totals tolerance is 0.05 EUR');
select is(app.line_amount_tolerance_ten_thousandths(), 500, 'line tolerance is 0.05 EUR');

-- totals_gate vectors (shared with the TypeScript parity test).
create temporary table gate_vectors (name text, amounts text, vat_total numeric, gross_total numeric,
  flagged boolean, diff numeric);
insert into gate_vectors values
-- begin vectors: totals_gate
('exact total', '10.00 20.00', 3.00, 33.00, false, 0),
('under by 0.06', '10.00 20.00', 3.00, 33.06, true, -0.06),
('under by exactly 0.05', '10.00 20.00', 3.00, 33.05, false, -0.05),
('over by 0.06', '10.00 20.00', 3.00, 32.94, true, 0.06),
('over by exactly 0.05', '10.00 20.00', 3.00, 32.95, false, 0.05),
('gross missing', '10.00 20.00', 3.00, null, true, null),
('vat missing', '10.00 20.00', null, 33.00, true, null),
('both missing', '10.00', null, null, true, null),
('no lines and zero totals', '', 0, 0, false, 0),
('no lines but a total', '', 0, 5, true, -5),
('four decimals', '0.0001 0.0002', 0, 0.0003, false, 0),
('float trap 0.1 + 0.2', '0.10 0.20', 0, 0.30, false, 0),
('many small lines', '0.01 0.01 0.01 0.01 0.01 0.01 0.01 0.01 0.01 0.01', 0, 0.10, false, 0)
-- end vectors: totals_gate
;
create temporary table gate_results as
  select v.name, v.flagged as want_flagged, v.diff as want_diff, g.flagged, g.diff
    from gate_vectors v
   cross join lateral app.totals_gate(pg_temp.mk_invoice(v.amounts, v.vat_total, v.gross_total)) g;
select is(r.flagged, r.want_flagged, 'totals_gate flag: ' || r.name) from gate_results r;
select is(r.diff, r.want_diff, 'totals_gate diff: ' || r.name) from gate_results r;

-- totals_gate counts active lines only: split parents and superseded children are skipped.
create temporary table split_case as select pg_temp.mk_invoice('10.00 20.00', 3.00, 33.00) as id;
update public.invoice_line set split_at = now()
  where invoice_id = (select id from split_case) and position = 2;
insert into public.invoice_line (tenant_id, invoice_id, position, sub_position, parent_line_id,
    raw_description, qty, line_amount, field_confidence, extracted, superseded_at)
  select '11111111-1111-4111-8111-111111111111', p.invoice_id, 2, c.sub, p.id, 'Riga 2', 1, c.amount,
         '{}', '{}', c.superseded
    from public.invoice_line p
   cross join (values (1, 5::numeric, now()), (2, 15::numeric, now()),
                      (3, 8::numeric, null::timestamptz), (4, 12::numeric, null::timestamptz))
     as c(sub, amount, superseded)
   where p.invoice_id = (select id from split_case) and p.position = 2;
select is((select flagged from app.totals_gate((select id from split_case))), false,
  'a split line counts once: its active children, not the parent or superseded children');
select is((select diff from app.totals_gate((select id from split_case))), 0::numeric,
  'the split total is 10 + 8 + 12 + VAT 3 - gross 33');
select is((select count(*)::int from app.totals_gate(gen_random_uuid())), 0,
  'an unknown invoice has no gate row');

-- refresh_gate adds or removes only total_mismatch and writes totals_diff.
create temporary table gate_case as select pg_temp.mk_invoice('10.00 20.00', 3.00, 33.06) as id;
update public.invoice set gate_flags = '{low_confidence}' where id = (select id from gate_case);
select app.refresh_gate((select id from gate_case));
select is((select gate_flags from public.invoice where id = (select id from gate_case)),
  array['total_mismatch', 'low_confidence'], 'refresh_gate adds total_mismatch and keeps the rest');
select is((select totals_diff from public.invoice where id = (select id from gate_case)),
  -0.06::numeric, 'refresh_gate writes totals_diff');
update public.invoice set gross_total = 33.00 where id = (select id from gate_case);
select app.refresh_gate((select id from gate_case));
select is((select gate_flags from public.invoice where id = (select id from gate_case)),
  array['low_confidence'], 'refresh_gate removes total_mismatch and keeps low_confidence');
select app.refresh_gate((select id from gate_case));
select is((select gate_flags from public.invoice where id = (select id from gate_case)),
  array['low_confidence'], 'refresh_gate is idempotent');
update public.invoice set gross_total = null where id = (select id from gate_case);
select app.refresh_gate((select id from gate_case));
select is((select totals_diff from public.invoice where id = (select id from gate_case)), null,
  'a missing total gives a null totals_diff');
select is((select gate_flags from public.invoice where id = (select id from gate_case)),
  array['total_mismatch', 'low_confidence'], 'a missing total is flagged');

-- line_corrected_fields. Baseline line: everything equals what was extracted.
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903');
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty,
                                  pack_unit) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 'kg');
create temporary table cf_invoice as select pg_temp.mk_invoice() as id;
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, supplier_code,
    qty, unit_price, line_amount, vat_rate, lot_code, expiry, unit_raw, field_confidence, extracted)
  select v.id::uuid, '11111111-1111-4111-8111-111111111111', i.id, v.pos, 'Fesa', 'MAN-1', 2, 12.75,
         25.5, 10, v.lot, v.expiry::date, 'kg', '{}',
         jsonb_build_object('description', 'Fesa', 'supplier_code', 'MAN-1', 'qty', 2, 'unit', 'kg',
           'unit_price', 12.75, 'line_amount', 25.5, 'vat_rate', 10, 'lot_code', v.lot,
           'expiry', v.expiry)
    from cf_invoice i
   cross join (values
     ('a2000000-0000-4000-8000-0000000000a1', 1, 'L-1', '2026-12-01'),
     ('a2000000-0000-4000-8000-0000000000a2', 2, null, null)) as v(id, pos, lot, expiry);
create function pg_temp.cf(p_id uuid) returns text[] language sql as $$
  select app.line_corrected_fields(l) from public.invoice_line l where l.id = p_id $$;
create function pg_temp.l1() returns uuid language sql as $$
  select 'a2000000-0000-4000-8000-0000000000a1'::uuid $$;
create function pg_temp.l2() returns uuid language sql as $$
  select 'a2000000-0000-4000-8000-0000000000a2'::uuid $$;

select is(pg_temp.cf(pg_temp.l1()), '{}', 'an untouched line has no corrections');
update public.invoice_line set qty = 3 where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['qty'], 'a changed quantity is a correction');
update public.invoice_line set qty = 2 where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), '{}', 'changing the quantity back removes the correction');
update public.invoice_line set unit_price = 13 where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['unit_price'], 'a changed unit price is a correction');
update public.invoice_line set unit_price = 12.75, line_amount = 26 where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['line_amount'], 'a changed line amount is a correction');
update public.invoice_line set line_amount = 25.5, vat_rate = 22 where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['vat_rate'], 'a changed VAT rate is a correction');
update public.invoice_line set vat_rate = 10, supplier_code = 'MAN-2' where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['supplier_code'], 'a changed supplier code is a correction');
update public.invoice_line set supplier_code = null where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['supplier_code'], 'clearing an extracted code is a correction');
update public.invoice_line set supplier_code = 'MAN-1' where id = pg_temp.l1();

-- A value the model could not read (null) and the reviewer typed counts.
update public.invoice_line set extracted = extracted || '{"vat_rate": null, "unit_price": null}'
  where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['unit_price', 'vat_rate'],
  'filling a value the model could not read is a correction');
update public.invoice_line set extracted = extracted || '{"vat_rate": 10, "unit_price": 12.75}'
  where id = pg_temp.l1();

-- Lot and expiry: typing a missing one is not a correction; changing an extracted one is.
update public.invoice_line set lot_code = 'L-9', expiry = '2027-01-01' where id = pg_temp.l2();
select is(pg_temp.cf(pg_temp.l2()), '{}', 'filling a missing lot and expiry is not a correction');
update public.invoice_line set lot_code = 'L-2' where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['lot_code'], 'changing an extracted lot is a correction');
update public.invoice_line set lot_code = null where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['lot_code'], 'clearing an extracted lot is a correction');
update public.invoice_line set lot_code = 'L-1', expiry = '2026-12-02' where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['expiry'], 'changing an extracted expiry is a correction');
update public.invoice_line set expiry = '2026-12-01' where id = pg_temp.l1();

-- Unit: against the suggestion only.
update public.invoice_line set unit = 'g' where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), '{}', 'a unit with no suggestion is not a correction');
update public.invoice_line set suggested_unit = 'kg' where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['unit'], 'a unit different from the suggestion is a correction');
update public.invoice_line set unit = 'kg' where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), '{}', 'a unit equal to the suggestion is not');

-- Ingredient: against the suggestion only.
update public.invoice_line set ingredient_id = '1a000000-0000-4000-8000-00000000001a',
    mapping_source = 'manual' where id = pg_temp.l2();
select is(pg_temp.cf(pg_temp.l2()), '{}', 'a manual first mapping is not a correction');
update public.invoice_line set suggested_ingredient_id = '1a000000-0000-4000-8000-00000000001a',
    suggested_supplier_item_id = '51000000-0000-4000-8000-000000000051',
    ingredient_id = '1a000000-0000-4000-8000-00000000001a',
    supplier_item_id = '51000000-0000-4000-8000-000000000051', mapping_source = 'auto'
  where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), '{}', 'an auto mapping kept as is is not a correction');
update public.invoice_line set ingredient_id = '1c000000-0000-4000-8000-00000000001c',
    mapping_source = 'manual' where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['ingredient'], 'another ingredient than suggested is a correction');
update public.invoice_line set ingredient_id = null, supplier_item_id = null, mapping_source = null
  where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['ingredient'], 'unmapping an auto mapping is a correction');
update public.invoice_line set is_stock = false, cost_centre_id = 'c5000000-0000-4000-8000-0000000000c5'
  where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['ingredient'],
  'marking an auto-mapped line non-stock is a correction');
update public.invoice_line set ingredient_id = null, supplier_item_id = null, mapping_source = null,
    is_stock = false, cost_centre_id = 'c5000000-0000-4000-8000-0000000000c5'
  where id = pg_temp.l2();
select is(pg_temp.cf(pg_temp.l2()), '{}', 'marking an unmapped line non-stock is not a correction');
update public.invoice_line set is_stock = true, cost_centre_id = null where id in
  (pg_temp.l1(), pg_temp.l2());

-- Pack, and rows that are not corrections.
update public.invoice_line set ingredient_id = '1a000000-0000-4000-8000-00000000001a',
    supplier_item_id = '51000000-0000-4000-8000-000000000051', mapping_source = 'auto',
    pack_corrected = true, credit_qty = 1, reviewed_at = now(), reviewed_by = 'a1000000-0000-4000-8000-00000000000a'
  where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['pack'],
  'a corrected pack counts; a credit quantity and the checked mark do not');
update public.invoice_line set qty = 3 where id = pg_temp.l1();
select is(pg_temp.cf(pg_temp.l1()), array['qty', 'pack'], 'fields come out in the fixed order');
update public.invoice_line set qty = 2, pack_corrected = false where id = pg_temp.l1();

-- A split child is a new line without an extraction baseline: never a correction.
insert into public.invoice_line (id, tenant_id, invoice_id, position, sub_position, parent_line_id,
    raw_description, qty, line_amount, vat_rate, field_confidence, extracted)
  select 'a2000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', i.id, 1, 1,
         pg_temp.l1(), 'Fesa', 1, 12.75, 10, '{}', '{}'
    from cf_invoice i;
select is(pg_temp.cf('a2000000-0000-4000-8000-0000000000a3'), '{}',
  'a split child has no corrections');

-- require_invoice_reviewer.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select lives_ok($$ select app.require_invoice_reviewer() $$, 'the owner may review');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select lives_ok($$ select app.require_invoice_reviewer() $$, 'the admin may review');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select throws_ok($$ select app.require_invoice_reviewer() $$, '42501', null, 'the chef may not review');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select throws_ok($$ select app.require_invoice_reviewer() $$, '42501', null, 'the waiter may not review');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'owner');
select throws_ok($$ select app.require_invoice_reviewer() $$, '42501', null,
  'a stale owner claim on a waiter is refused (the role comes from the app_user row)');
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select app.require_invoice_reviewer() $$, '42501', null, 'no session is refused');

-- lock_review_invoice.
create temporary table lock_case as
  select pg_temp.mk_invoice('1.00', 0, 1.00, 'review') as review_id,
         pg_temp.mk_invoice('1.00', 0, 1.00, 'received') as received_id,
         pg_temp.mk_invoice('1.00', 0, 1.00, 'review', null, '22222222-2222-4222-8222-222222222222') as b_id;
create temporary table lock_dup as
  select pg_temp.mk_invoice('1.00', 0, 1.00, 'duplicate', (select review_id from lock_case)) as id;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select (app.lock_review_invoice((select review_id from lock_case))).id),
  (select review_id from lock_case), 'an invoice in review is locked and returned');
select is(pg_temp.err(format('select app.lock_review_invoice(%L)', (select id from lock_dup))),
  'P0001 invoice_not_in_review', 'a duplicate invoice is not in review');
select is(pg_temp.err(format('select app.lock_review_invoice(%L)', (select received_id from lock_case))),
  'P0001 invoice_not_in_review', 'a received invoice is not in review');
select is(pg_temp.err(format('select app.lock_review_invoice(%L)', (select b_id from lock_case))),
  'P0002 not_found', 'tenant B''s invoice is not found');
select is(pg_temp.err(format('select app.lock_review_invoice(%L)', gen_random_uuid())),
  'P0002 not_found', 'an unknown invoice is not found');

-- recheck_duplicate.
create function pg_temp.mk_dup(p_vat text, p_name text, p_number text, p_date date,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111', p_override boolean default false,
    p_status public.invoice_status default 'review', p_age interval default '0')
  returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  -- now() is fixed inside the transaction, so the age makes "the earlier invoice" unambiguous.
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      supplier_vat, supplier_name, number_raw, invoice_date, duplicate_override, created_at)
    values (v_id, p_tenant, p_tenant || '/2026/' || v_id || '.pdf', 'application/pdf', 100, p_status,
      p_vat, p_name, p_number, p_date, p_override, now() - p_age);
  return v_id;
end
$$;
create temporary table dup_case as select
  pg_temp.mk_dup('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026', '2026-10-15',
    p_age => '3 hours') as original_id,
  pg_temp.mk_dup('IT12345678903', 'Fornitore Demo Srl', 'ft 1/2026', '2026-10-15') as copy_id,
  pg_temp.mk_dup('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026', '2026-10-15',
    p_override => true, p_age => '2 hours') as override_id,
  pg_temp.mk_dup('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026', '2026-10-15',
    '22222222-2222-4222-8222-222222222222') as b_id,
  pg_temp.mk_dup('IT12345678903', 'Fornitore Demo Srl', 'FT 9/2026', '2026-10-15') as unique_id;
select app.recheck_duplicate((select copy_id from dup_case));
select is((select status from public.invoice where id = (select copy_id from dup_case)),
  'duplicate'::public.invoice_status, 'the same VAT, number and date moves the copy to duplicate');
select is((select duplicate_of from public.invoice where id = (select copy_id from dup_case)),
  (select original_id from dup_case), 'duplicate_of points at the earlier invoice');
-- The owner declared the override invoice not a duplicate of the original (and of that pair only).
update public.invoice set duplicate_override_of = (select original_id from dup_case)
 where id = (select override_id from dup_case);
select app.recheck_duplicate((select override_id from dup_case));
select is((select status from public.invoice where id = (select override_id from dup_case)),
  'review'::public.invoice_status, 'an invoice is not re-flagged against the invoice it was declared not a duplicate of');
select app.recheck_duplicate((select unique_id from dup_case));
select is((select status from public.invoice where id = (select unique_id from dup_case)),
  'review'::public.invoice_status, 'an invoice with its own number stays in review');
update public.invoice set number_raw = 'FT 1/2026' where id = (select unique_id from dup_case);
select app.recheck_duplicate((select unique_id from dup_case));
select is((select status from public.invoice where id = (select unique_id from dup_case)),
  'duplicate'::public.invoice_status, 'a corrected number that now matches flags the invoice');
-- Tenant B's identical invoice is never a match for tenant A, and B is not touched.
select app.recheck_duplicate((select b_id from dup_case));
select is((select duplicate_of from public.invoice where id = (select b_id from dup_case)), null,
  'tenant B''s invoice does not match tenant A''s');

-- Without a VAT number a name match only warns, and the warning goes when the name changes.
create temporary table warn_case as select
  pg_temp.mk_dup(null, 'Ditta Demo', 'N 5', '2026-10-16', p_age => '3 hours') as original_id,
  pg_temp.mk_dup(null, '  ditta   DEMO ', 'N 5', '2026-10-16') as copy_id;
select app.recheck_duplicate((select copy_id from warn_case));
select is((select duplicate_warning_of from public.invoice where id = (select copy_id from warn_case)),
  (select original_id from warn_case), 'a name match sets a warning');
select is((select status from public.invoice where id = (select copy_id from warn_case)),
  'review'::public.invoice_status, 'a name match does not change the status');
update public.invoice set supplier_name = 'Altra Ditta' where id = (select copy_id from warn_case);
select app.recheck_duplicate((select copy_id from warn_case));
select is((select duplicate_warning_of from public.invoice where id = (select copy_id from warn_case)),
  null, 'the warning is cleared when the name no longer matches');
update public.invoice set supplier_name = 'Ditta Demo' where id = (select copy_id from warn_case);
select app.recheck_duplicate((select copy_id from warn_case));
update public.invoice set number_raw = null where id = (select copy_id from warn_case);
select app.recheck_duplicate((select copy_id from warn_case));
select is((select duplicate_warning_of from public.invoice where id = (select copy_id from warn_case)),
  null, 'the warning is cleared when the key is incomplete');

-- Privileges: the helpers are not callable through the API roles.
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('description_hash', 'parse_unit_raw', 'line_checks', 'totals_gate',
          'refresh_gate', 'line_corrected_fields', 'require_invoice_reviewer', 'lock_review_invoice',
          'recheck_duplicate', 'allowed_vat_rates', 'total_tolerance_ten_thousandths',
          'line_amount_tolerance_ten_thousandths')
        and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')) $$,
  'no helper is executable by anon or authenticated');
select ok(has_function_privilege('service_role', 'app.description_hash(text)', 'execute')
      and has_function_privilege('service_role', 'app.parse_unit_raw(text)', 'execute'),
  'service_role can run the helpers extraction_complete will use');

select * from finish();
rollback;
