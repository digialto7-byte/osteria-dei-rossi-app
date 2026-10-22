-- M4 step 5: public.review_update_line (plan §3.2). Acts as owner A unless stated. Covers AT2 (DB)
-- mapping memory and propagation, AT4 (DB) non-stock and credit rules, one transaction per call,
-- role and tenant access, and that nothing outside invoice, invoice_line and supplier_item is written.
begin;
create extension if not exists pgtap with schema extensions;
select plan(165);

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
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Vitello', 'kg'),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Olio', 'l'),
  ('1d000000-0000-4000-8000-00000000001d', '11111111-1111-4111-8111-111111111111', 'Uova', 'pz'),
  ('1e000000-0000-4000-8000-00000000001e', '22222222-2222-4222-8222-222222222222', 'Manzo B', 'kg');
insert into public.cost_centre (id, tenant_id, name, is_active) values
  ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'Pulizie', true),
  ('c7000000-0000-4000-8000-0000000000c7', '11111111-1111-4111-8111-111111111111', 'Spento', false),
  ('c6000000-0000-4000-8000-0000000000c6', '22222222-2222-4222-8222-222222222222', 'Gas B', true);
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '11111111-1111-4111-8111-111111111111',
   'Altro Fornitore', 'IT00000000000'),
  ('5c000000-0000-4000-8000-00000000005c', '22222222-2222-4222-8222-222222222222',
   'Fornitore Demo Srl', 'IT12345678903');
-- The article of line 5: already remembered, with a price that review must never touch.
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty,
    pack_unit, invoice_unit, last_price) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 'kg',
   'kg', 12.5);

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$
  select ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.mk_invoice(n int, p_status public.invoice_status default 'review',
    p_supplier uuid default null, p_tenant uuid default '11111111-1111-4111-8111-111111111111',
    p_vat numeric default null, p_gross numeric default null, p_flags text[] default '{}',
    p_dup_of uuid default null) returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id,
      vat_total, gross_total, gate_flags, duplicate_of)
  values (pg_temp.iid(n), p_tenant, p_tenant || '/2026/' || pg_temp.iid(n) || '.pdf',
      'application/pdf', 100, p_status, p_supplier, p_vat, p_gross, p_flags, p_dup_of)
$$;
-- A line whose extraction baseline equals its values, so it starts uncorrected.
create function pg_temp.mk_line(n int, inv int, pos int, p_code text, p_desc text, p_unit text,
    p_qty numeric default 2, p_price numeric default 12.75, p_amount numeric default 25.5,
    p_extra text default '', p_vals text default '',
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
begin
  execute format($q$
    insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, supplier_code,
        qty, unit_raw, unit_price, line_amount, vat_rate, unit, suggested_unit, field_confidence,
        extracted %s)
    values (%L, %L, %L, %s, %L, %L, %s, %L, %s, %s, 10, %L, %L, '{}',
        jsonb_build_object('qty', %s, 'unit_price', %s, 'line_amount', %s, 'vat_rate', 10,
          'supplier_code', %L::text, 'lot_code', null, 'expiry', null) %s)$q$,
    case when p_extra = '' then '' else ', ' || p_extra end,
    pg_temp.lid(n), p_tenant, pg_temp.iid(inv), pos, p_desc, p_code, p_qty, p_unit, p_price, p_amount,
    p_unit, p_unit, p_qty, p_price, p_amount, p_code,
    case when p_vals = '' then '' else ', ' || p_vals end);
end
$$;

select pg_temp.mk_invoice(1, 'review', '5a000000-0000-4000-8000-00000000005a');
select pg_temp.mk_invoice(2, 'review', '5a000000-0000-4000-8000-00000000005a');
select pg_temp.mk_invoice(3, 'approved', '5a000000-0000-4000-8000-00000000005a');
select pg_temp.mk_invoice(4, 'review', '5b000000-0000-4000-8000-00000000005b');
select pg_temp.mk_invoice(5, 'duplicate', '5a000000-0000-4000-8000-00000000005a',
  p_dup_of => pg_temp.iid(1));
select pg_temp.mk_invoice(6, 'review');
select pg_temp.mk_invoice(7, 'review', '5a000000-0000-4000-8000-00000000005a', p_vat => 3.00,
  p_gross => 33.06, p_flags => '{total_mismatch,low_confidence}');
select pg_temp.mk_invoice(8, 'review', '5c000000-0000-4000-8000-00000000005c',
  '22222222-2222-4222-8222-222222222222');

select pg_temp.mk_line(1, 1, 1, 'MAN-9', 'Manzo fesa', 'kg');
select pg_temp.mk_line(2, 1, 2, null, 'Fesa di manzo', 'kg');
select pg_temp.mk_line(3, 1, 3, 'CONF-1', 'Cassa pomodori', 'conf');
select pg_temp.mk_line(4, 1, 4, 'PZ-1', 'Uova fresche', 'pz');
select pg_temp.mk_line(5, 1, 5, 'MAN-1', 'Manzo macinato', 'kg', p_extra =>
  'ingredient_id, supplier_item_id, suggested_ingredient_id, suggested_supplier_item_id, mapping_source',
  p_vals => $$'1a000000-0000-4000-8000-00000000001a', '51000000-0000-4000-8000-000000000051',
    '1a000000-0000-4000-8000-00000000001a', '51000000-0000-4000-8000-000000000051', 'auto'$$);
select pg_temp.mk_line(6, 1, 6, 'OLIO-1', 'Olio extra vergine', null);
select pg_temp.mk_line(7, 1, 7, 'X-7', 'Prodotto diviso', 'kg', 3, 10, 30, 'split_at', 'now()');
select pg_temp.mk_line(8, 1, 7, 'X-7', 'Prodotto diviso', 'kg', 1, 10, 10,
  'sub_position, parent_line_id', format('1, %L', pg_temp.lid(7)));
select pg_temp.mk_line(9, 1, 7, 'X-7', 'Prodotto diviso', 'kg', 2, 10, 20,
  'sub_position, parent_line_id, superseded_at', format('2, %L, now()', pg_temp.lid(7)));
select pg_temp.mk_line(10, 2, 1, 'MAN-9', 'Manzo fesa', 'kg');
select pg_temp.mk_line(11, 2, 2, 'MAN-9', 'Manzo fesa', 'kg', p_extra => 'is_stock, cost_centre_id',
  p_vals => $$false, 'c5000000-0000-4000-8000-0000000000c5'$$);
select pg_temp.mk_line(12, 3, 1, 'MAN-9', 'Manzo fesa', 'kg');
select pg_temp.mk_line(13, 4, 1, 'MAN-9', 'Manzo fesa', 'kg');
select pg_temp.mk_line(14, 5, 1, 'MAN-9', 'Manzo fesa', 'kg');
select pg_temp.mk_line(15, 6, 1, 'MAN-9', 'Manzo fesa', 'kg');
select pg_temp.mk_line(16, 7, 1, null, 'Riga uno', 'kg', 1, 10, 10);
select pg_temp.mk_line(17, 7, 2, null, 'Riga due', 'kg', 1, 20, 20);
select pg_temp.mk_line(18, 8, 1, 'MAN-9', 'Manzo B', 'kg', p_tenant => '22222222-2222-4222-8222-222222222222');
-- Pairs of lines for the "never touch what the reviewer edited" cases: line 19/20 (ZZ-1), 21/22
-- (ZY-1) and 23/24 (ZX-1), the first of each pair in invoice 1, the second in invoice 2.
select pg_temp.mk_line(19, 1, 20, 'ZZ-1', 'Zeta uno', 'kg');
select pg_temp.mk_line(20, 2, 20, 'ZZ-1', 'Zeta uno', 'kg');
select pg_temp.mk_line(21, 1, 21, 'ZY-1', 'Zeta due', 'kg');
select pg_temp.mk_line(22, 2, 21, 'ZY-1', 'Zeta due', 'kg');
select pg_temp.mk_line(23, 1, 22, 'ZX-1', 'Zeta tre', 'kg');
select pg_temp.mk_line(24, 2, 22, 'ZX-1', 'Zeta tre', 'kg');
-- Pairs for the value-only edits, which must not stop a mapping from reaching the line (round 2):
-- 25/26 (ZW-1, qty), 30/31 (ZV-1, credit, lot, checked, price and amount), 32/33 (ZU-1, unit).
select pg_temp.mk_line(25, 1, 23, 'ZW-1', 'Zeta quattro', 'kg');
select pg_temp.mk_line(26, 2, 23, 'ZW-1', 'Zeta quattro', 'kg');
select pg_temp.mk_line(30, 1, 24, 'ZV-1', 'Zeta cinque', 'kg');
select pg_temp.mk_line(31, 2, 24, 'ZV-1', 'Zeta cinque', 'kg');
select pg_temp.mk_line(32, 1, 25, 'ZU-1', 'Zeta sei', 'kg');
select pg_temp.mk_line(33, 2, 25, 'ZU-1', 'Zeta sei', 'kg');
-- Invoice 9 has no supplier yet; every line carries the code of the article supplier A remembers.
select pg_temp.mk_invoice(9, 'review');
select pg_temp.mk_line(27, 9, 1, 'MAN-1', 'Manzo macinato', 'kg');
select pg_temp.mk_line(28, 9, 2, 'MAN-1', 'Manzo macinato', 'kg');
select pg_temp.mk_line(29, 9, 3, 'MAN-1', 'Manzo macinato', 'kg');
select pg_temp.mk_line(34, 9, 4, 'MAN-1', 'Manzo macinato', 'kg');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- Calls the procedure and reports 'ok' or '<sqlstate> <message>' (a failed call rolls back to here).
create function pg_temp.upd(p_line int, p_patch text, p_inv int default 1) returns text
  language plpgsql as $$
declare
  state text;
  msg text;
begin
  perform public.review_update_line(pg_temp.iid(p_inv), pg_temp.lid(p_line), p_patch::jsonb);
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
-- Links a supplier to an invoice and reports 'ok' or '<sqlstate> <message>'.
create function pg_temp.link(p_inv int, p_supplier uuid) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  perform public.review_set_supplier(pg_temp.iid(p_inv), p_supplier, null);
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.line(n int) returns public.invoice_line language sql as $$
  select l from public.invoice_line l where l.id = pg_temp.lid(n) $$;
-- Tables written since the snapshot, in the public schema.
create temporary table xact_snapshot as
  select relname::text as relname, n_tup_ins + n_tup_upd + n_tup_del as writes
    from pg_stat_xact_user_tables where schemaname = 'public';
create function pg_temp.written_since_snapshot() returns text[] language sql as $$
  select coalesce(array_agg(t.relname::text order by t.relname), '{}')
    from pg_stat_xact_user_tables t
    left join xact_snapshot s on s.relname = t.relname::text
   where t.schemaname = 'public' and t.n_tup_ins + t.n_tup_upd + t.n_tup_del > coalesce(s.writes, 0) $$;
create function pg_temp.snapshot() returns void language sql as $$
  with gone as (delete from xact_snapshot)
  insert into xact_snapshot
    select relname::text, n_tup_ins + n_tup_upd + n_tup_del
      from pg_stat_xact_user_tables where schemaname = 'public' $$;
grant select, insert, delete on xact_snapshot to authenticated;
grant execute on function pg_temp.iid(int), pg_temp.lid(int), pg_temp.act_as(uuid, uuid, text),
  pg_temp.upd(int, text, int), pg_temp.link(int, uuid), pg_temp.line(int), pg_temp.written_since_snapshot(),
  pg_temp.snapshot() to authenticated;

-- The helpers in schema app are not callable by authenticated, so compute what the test compares to.
create temporary table expected_hash as select app.description_hash('Fesa di manzo') as fesa;
grant select on expected_hash to authenticated;

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

-- Privileges.
select ok(has_function_privilege('authenticated', 'public.review_update_line(uuid, uuid, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.review_update_line(uuid, uuid, jsonb)', 'execute')
      and not has_function_privilege('service_role', 'public.review_update_line(uuid, uuid, jsonb)', 'execute'),
  'only authenticated can call review_update_line');

-- Mapping a coded line creates a remembered article keyed by the code. No ledger is written.
select pg_temp.snapshot();
select is(pg_temp.upd(1, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  'an unmapped coded line is mapped to an ingredient');
select is(pg_temp.written_since_snapshot(), array['invoice', 'invoice_line', 'supplier_item'],
  'a mapping writes only invoice, invoice_line and supplier_item (no ledger, no approval)');
select is((select status from public.invoice where id = pg_temp.iid(1)), 'review'::public.invoice_status,
  'the invoice is still in review');
select is((select last_price from public.supplier_item where id = '51000000-0000-4000-8000-000000000051'),
  12.5::numeric, 'last_price is untouched');
select is((select supplier_code || '/' || coalesce(description_hash, 'none') || '/' || pack_count
             || 'x' || pack_qty || pack_unit || '/' || invoice_unit || '/' || is_active
             from public.supplier_item where id = (pg_temp.line(1)).supplier_item_id),
  'MAN-9/none/1.0000x1.0000kg/kg/true', 'a new article keyed by code, default pack 1 x 1 kg, unit kept');
select is((select created_by from public.supplier_item where id = (pg_temp.line(1)).supplier_item_id),
  'a1000000-0000-4000-8000-00000000000a'::uuid, 'the article records who created it');
select is((pg_temp.line(1)).mapping_source, 'manual', 'a first mapping is manual');
select is((pg_temp.line(1)).corrected_fields, '{}', 'a first mapping is not a correction');
select is((pg_temp.line(1)).reviewed_by, 'a1000000-0000-4000-8000-00000000000a'::uuid,
  'the line records who reviewed it');
select is((pg_temp.line(1)).reviewed_at, now(), 'and when');

-- An uncoded line is keyed by the description hash.
select is(pg_temp.upd(2, '{"ingredient_id": "1b000000-0000-4000-8000-00000000001b"}'), 'ok',
  'an uncoded line is mapped');
select is((select description_hash || '/' || coalesce(supplier_code, 'none') from public.supplier_item
            where id = (pg_temp.line(2)).supplier_item_id),
  (select fesa from expected_hash) || '/none', 'a new article keyed by description');

-- Propagation (AT2): the same supplier's other invoices in review get the mapping.
select is((pg_temp.line(10)).mapping_source, 'auto', 'an unmapped line of the same code in another review invoice is auto-mapped');
select is((pg_temp.line(10)).suggested_ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  'with the suggestion set');
select is((pg_temp.line(10)).corrected, false, 'and not corrected');
select is((pg_temp.line(11)).ingredient_id, null, 'a non-stock line is not mapped');
select is((pg_temp.line(12)).ingredient_id, null, 'a line of an approved invoice is untouched');
select is((pg_temp.line(13)).ingredient_id, null, 'a line of another supplier''s invoice is untouched');
select is((pg_temp.line(14)).ingredient_id, null, 'a line of a duplicate invoice is untouched');
select is((pg_temp.line(15)).ingredient_id, null, 'a line of an invoice with no supplier is untouched');

-- Re-mapping an article that has an item updates the item (AT2).
select is((select count(*)::int from public.supplier_item where supplier_id = '5a000000-0000-4000-8000-00000000005a'),
  3, 'three articles so far (one existing, two created)');
select is(pg_temp.upd(5, '{"ingredient_id": "1b000000-0000-4000-8000-00000000001b"}'), 'ok',
  'an auto-mapped line is mapped to another ingredient');
select is((select count(*)::int from public.supplier_item where supplier_id = '5a000000-0000-4000-8000-00000000005a'),
  3, 'the article is updated, not duplicated');
select is((select ingredient_id from public.supplier_item where id = '51000000-0000-4000-8000-000000000051'),
  '1b000000-0000-4000-8000-00000000001b'::uuid, 'the article now points at the new ingredient');
select is((pg_temp.line(5)).mapping_source, 'manual', 'the source becomes manual');
select is((pg_temp.line(5)).corrected_fields, array['ingredient'],
  'changing an auto suggestion is a correction');
select is(pg_temp.upd(5, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  'mapping back to the suggestion');
select is((pg_temp.line(5)).mapping_source, 'auto', 'restores the auto source');
select is((pg_temp.line(5)).corrected_fields, '{}', 'and removes the correction');

-- Packs.
select is(pg_temp.upd(3, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'P0001 pack_required',
  'a conf line without a pack needs one');
select is((select count(*)::int from public.supplier_item where supplier_code = 'CONF-1'), 0,
  'and creates no article');
select is(pg_temp.upd(3, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a",
  "pack": {"count": 6, "size": 1, "unit": "kg", "label": "cassa"}}'), 'ok', 'with a pack it is mapped');
select is((select pack_count || 'x' || pack_qty || pack_unit || '/' || pack_label || '/' || invoice_unit
             from public.supplier_item where id = (pg_temp.line(3)).supplier_item_id),
  '6.0000x1.0000kg/cassa/conf', 'the pack is stored on the article');
select is(pg_temp.upd(4, '{"ingredient_id": "1d000000-0000-4000-8000-00000000001d",
  "pack": {"count": 6, "size": 1, "unit": "kg"}}'), '22023 incompatible_units',
  'a kg pack on a piece ingredient is refused');
select is((select count(*)::int from public.supplier_item where supplier_code = 'PZ-1'), 0,
  'and creates no article');
select is(pg_temp.upd(6, '{"ingredient_id": "1c000000-0000-4000-8000-00000000001c"}'), 'P0001 pack_required',
  'a line with no unit needs a pack');
select is(pg_temp.upd(4, '{"pack": {"count": 1, "size": 1, "unit": "pz"}}'), 'P0001 not_mapped',
  'a pack on an unmapped line is refused');
select is(pg_temp.upd(5, '{"pack": {"count": 2, "size": 5, "unit": "kg"}}'), 'ok',
  'the pack of an auto-mapped line is changed');
select is((pg_temp.line(5)).corrected_fields, array['pack'], 'which is a correction');
select is((pg_temp.line(5)).pack_corrected, true, 'recorded as pack_corrected');
select is((select pack_count || 'x' || pack_qty from public.supplier_item
            where id = '51000000-0000-4000-8000-000000000051'), '2.0000x5.0000', 'the article has the new pack');
select is(pg_temp.upd(5, '{"pack": {"count": 2, "size": 5, "unit": "kg"}}'), 'ok', 'the same pack again');
select is(pg_temp.upd(5, '{"pack": {"count": 0, "size": 5, "unit": "kg"}}'), '23514 ' ||
  'new row for relation "supplier_item" violates check constraint "supplier_item_pack_count_check"',
  'a zero pack count is refused by the table check');
select is(pg_temp.upd(5, '{"pack": {"count": 1, "size": 1, "unit": "conf"}}'), 'P0001 invalid_request',
  'conf is not a pack unit');

-- Unmapping keeps the remembered article.
select is(pg_temp.upd(2, '{"ingredient_id": null}'), 'ok', 'a line is unmapped');
select is((pg_temp.line(2)).ingredient_id is null and (pg_temp.line(2)).supplier_item_id is null
          and (pg_temp.line(2)).mapping_source is null, true, 'its mapping fields are cleared');
select is((select count(*)::int from public.supplier_item
            where description_hash = (select fesa from expected_hash)), 1, 'the article stays');

-- A supplier is needed to map (AT: supplier_required).
select is(pg_temp.upd(15, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}', 6), 'P0001 supplier_required',
  'mapping needs a linked supplier');

-- Non-stock (AT4 DB).
select is(pg_temp.upd(6, '{"is_stock": false}'), 'P0001 cost_centre_required',
  'non-stock without a cost centre is refused');
select is((pg_temp.line(6)).is_stock, true, 'and nothing changed');
select is(pg_temp.upd(6, '{"is_stock": false, "cost_centre_id": "c7000000-0000-4000-8000-0000000000c7"}'),
  'P0001 cost_centre_required', 'an inactive cost centre is refused');
select is(pg_temp.upd(6, '{"is_stock": false, "cost_centre_id": "c6000000-0000-4000-8000-0000000000c6"}'),
  '23503 insert or update on table "invoice_line" violates foreign key constraint "invoice_line_cost_centre_fk"',
  'tenant B''s cost centre is refused');
select is(pg_temp.upd(6, '{"is_stock": false, "ingredient_id": "1a000000-0000-4000-8000-00000000001a",
  "cost_centre_id": "c5000000-0000-4000-8000-0000000000c5"}'), 'P0001 non_stock_has_ingredient',
  'non-stock with an ingredient is refused');
select is(pg_temp.upd(6, '{"is_stock": false, "cost_centre_id": "c5000000-0000-4000-8000-0000000000c5"}'), 'ok',
  'non-stock with a cost centre is accepted');
select is((pg_temp.line(6)).cost_centre_id, 'c5000000-0000-4000-8000-0000000000c5'::uuid, 'the centre is stored');
select is(pg_temp.upd(6, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'P0001 non_stock_has_ingredient',
  'a non-stock line cannot be mapped');
select is(pg_temp.upd(5, '{"is_stock": false, "cost_centre_id": "c5000000-0000-4000-8000-0000000000c5"}'), 'ok',
  'a mapped line is booked non-stock');
select is((pg_temp.line(5)).ingredient_id is null and (pg_temp.line(5)).supplier_item_id is null
          and (pg_temp.line(5)).mapping_source is null, true, 'which clears its mapping');
select is((pg_temp.line(5)).corrected_fields, array['ingredient', 'pack'],
  'and unmapping an auto-mapped line is a correction (the earlier pack correction stays)');
select is(pg_temp.upd(5, '{"is_stock": true}'), 'ok', 'back to stock');
select is((pg_temp.line(5)).cost_centre_id, null, 'drops the cost centre');
select is(pg_temp.upd(6, '{"cost_centre_id": null}'), 'P0001 cost_centre_required',
  'a non-stock line cannot lose its cost centre');
select is(pg_temp.upd(1, '{"cost_centre_id": "c5000000-0000-4000-8000-0000000000c5"}'), 'P0001 invalid_request',
  'a stock line takes no cost centre');

-- Credit quantity (AT4 DB).
select is(pg_temp.upd(2, '{"credit_qty": 3}'), 'P0001 credit_qty_exceeds_qty', 'credit 3 on quantity 2 is refused');
select is(pg_temp.upd(2, '{"credit_qty": 2}'), 'ok', 'credit 2 on quantity 2 is accepted');
select is((pg_temp.line(2)).credit_qty, 2::numeric, 'and stored');
select is((pg_temp.line(2)).corrected_fields, '{}', 'a credit quantity is not a correction');
select is(pg_temp.upd(2, '{"qty": 1}'), 'P0001 credit_qty_exceeds_qty', 'lowering the quantity below the credit is refused');

-- Values, checks, corrections.
select is(pg_temp.upd(16, '{"qty": 3}', 7), 'ok', 'a quantity is corrected');
select is((pg_temp.line(16)).corrected_fields, array['qty'], 'as a qty correction');
select is((pg_temp.line(16)).checks, array['amount_mismatch'], 'and the line checks are recomputed');
select is(pg_temp.upd(16, '{"qty": 1}', 7), 'ok', 'the quantity is set back');
select is((pg_temp.line(16)).corrected_fields, '{}', 'which removes the correction');
select is((pg_temp.line(16)).checks, '{}', 'and the check');
select is(pg_temp.upd(17, '{"line_amount": 20.06, "unit_price": 20.06}', 7), 'ok', 'a line amount is corrected');
select is((select gate_flags from public.invoice where id = pg_temp.iid(7)), array['low_confidence'],
  'the totals gate is re-run: total_mismatch goes, low_confidence stays');
select is((select totals_diff from public.invoice where id = pg_temp.iid(7)), 0::numeric, 'and totals_diff is 0');
select is(pg_temp.upd(17, '{"line_amount": 25, "unit_price": 25}', 7), 'ok', 'a wrong amount is set');
select is((select gate_flags from public.invoice where id = pg_temp.iid(7)), array['total_mismatch', 'low_confidence'],
  'the mismatch is flagged again');

-- reviewed: true stamps only.
create temporary table before_row as select * from public.invoice_line where id = pg_temp.lid(4);
grant select on before_row to authenticated;
select is(pg_temp.upd(4, '{"reviewed": true}'), 'ok', '"line checked" is accepted');
select is((select (b.qty, b.unit, b.ingredient_id, b.corrected_fields, b.checks, b.credit_qty, b.is_stock)::text
             from before_row b),
  (select (l.qty, l.unit, l.ingredient_id, l.corrected_fields, l.checks, l.credit_qty, l.is_stock)::text
     from public.invoice_line l where l.id = pg_temp.lid(4)), 'only the review stamp changes');
select isnt((pg_temp.line(4)).reviewed_at, null, 'the stamp is set');

-- Lot, expiry and the other plain values.
select is(pg_temp.upd(4, '{"lot_code": "L-1", "expiry": "2026-12-31"}'), 'ok', 'a missing lot and expiry are typed');
select is((pg_temp.line(4)).corrected_fields, '{}', 'which is not a correction');
select is(pg_temp.upd(4, '{"vat_rate": 22, "supplier_code": "PZ-2"}'), 'ok', 'VAT rate and supplier code are corrected');
select is((pg_temp.line(4)).corrected_fields, array['vat_rate', 'supplier_code'], 'both count');
select is((pg_temp.line(4)).checks, '{}', '22 is an allowed VAT rate');

-- One transaction: the whole call or nothing.
select is(pg_temp.upd(4, '{"ingredient_id": "1d000000-0000-4000-8000-00000000001d", "qty": 5, "credit_qty": 9}'),
  'P0001 credit_qty_exceeds_qty', 'a patch with an invalid part fails');
select is((pg_temp.line(4)).qty, 2::numeric, 'the valid quantity change was not kept');
select is((select count(*)::int from public.supplier_item where supplier_code = 'PZ-2'), 0,
  'and no article was created');

-- Payload shape.
select is(pg_temp.upd(4, '{}'), 'P0001 invalid_request', 'an empty patch is refused');
select is(pg_temp.upd(4, '{"foo": 1}'), 'P0001 invalid_request', 'an unknown key is refused');
select is(pg_temp.upd(4, '[1]'), 'P0001 invalid_request', 'a non-object patch is refused');
select is(pg_temp.upd(4, '{"qty": "2"}'), 'P0001 invalid_request', 'a number sent as text is refused');
select is(pg_temp.upd(4, '{"qty": null}'), 'P0001 invalid_request', 'a null quantity is refused');
select is(pg_temp.upd(4, '{"reviewed": false}'), 'P0001 invalid_request', 'reviewed must be true');

-- Splits: a parent is closed, a child's amounts are locked, a child can be mapped without memory.
select is(pg_temp.upd(7, '{"reviewed": true}'), 'P0001 line_split', 'a split parent cannot be edited');
select is(pg_temp.upd(8, '{"qty": 2}'), 'P0001 split_child_locked', 'a child''s quantity is locked');
select is(pg_temp.upd(8, '{"line_amount": 2}'), 'P0001 split_child_locked', 'and its amount');
select is(pg_temp.upd(8, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  'a child is mapped by ingredient only');
select is((pg_temp.line(8)).supplier_item_id is null and (pg_temp.line(8)).mapping_source = 'manual', true,
  'with no remembered article');
select is(pg_temp.upd(9, '{"reviewed": true}'), 'P0002 not_found', 'a superseded child is not found');

-- A mapping from another invoice is not propagated onto what the reviewer edited.
-- (a) Unmapped by the reviewer after an auto suggestion.
select is(pg_temp.upd(19, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  'a line is mapped to Manzo');
select is((pg_temp.line(20)).mapping_source, 'auto', 'the same article in invoice 2 is auto-mapped');
select is(pg_temp.upd(20, '{"ingredient_id": null}', 2), 'ok', 'the owner unmaps it');
select is(pg_temp.upd(19, '{"ingredient_id": "1b000000-0000-4000-8000-00000000001b"}'), 'ok',
  'the first line is then mapped to Vitello');
select is((pg_temp.line(20)).ingredient_id, null, 'the unmapped line is not re-mapped by propagation');
select is((pg_temp.line(20)).mapping_source, null, 'it has no mapping source');
select is((pg_temp.line(20)).suggested_ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  'its original suggestion (Manzo) is not overwritten');
select is((pg_temp.line(20)).corrected_fields, array['ingredient'], 'and it is still a correction');
-- (b) A unit the reviewer cleared, on a line that was not mapped.
select is(pg_temp.upd(22, '{"unit": null}', 2), 'ok', 'the owner clears the unit of an unmapped line');
select is((pg_temp.line(22)).corrected_fields, array['unit'], 'which is a correction');
select is(pg_temp.upd(21, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  'the same article is mapped in invoice 1');
select is((pg_temp.line(22)).unit, null, 'the cleared unit is not refilled by propagation');
select is((pg_temp.line(22)).ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  'but the line is mapped: a cleared unit is not a mapping decision');
select is((pg_temp.line(22)).suggested_ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  'with the suggestion set');
select is((pg_temp.line(22)).mapping_source, 'auto', 'as an auto mapping');
select is((pg_temp.line(22)).corrected_fields, array['unit'], 'its correction stays (it is not stale)');
-- (c) Non-stock and back to stock.
select is(pg_temp.upd(24, '{"is_stock": false, "cost_centre_id": "c5000000-0000-4000-8000-0000000000c5"}', 2),
  'ok', 'the owner books a line non-stock');
select is(pg_temp.upd(24, '{"is_stock": true}', 2), 'ok', 'and then back to stock');
select is(pg_temp.upd(23, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  'the same article is mapped in invoice 1');
select is((pg_temp.line(24)).ingredient_id, null, 'the line the owner decided on is not mapped');
select is((pg_temp.line(24)).mapping_source, null, 'with no source');
select is((pg_temp.line(24)).suggested_ingredient_id, null, 'and no suggestion');
select is((pg_temp.line(24)).corrected_fields, '{}', 'and no correction is invented');

-- Round 2: only a MAPPING decision stops a mapping from reaching a line. Value-only edits and
-- "line checked" do not.
-- (A) Qty corrected on the unmapped line of invoice 2, then the article is mapped in invoice 1.
select is(pg_temp.upd(26, '{"qty": 3}', 2), 'ok', '(A) the owner corrects the qty of an unmapped line');
select is(pg_temp.upd(25, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  '(A) the same article is mapped in invoice 1');
select is((pg_temp.line(26)).ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  '(A) the qty-corrected line is mapped');
select is((pg_temp.line(26)).mapping_source, 'auto', '(A) as an auto mapping');
select is((pg_temp.line(26)).suggested_ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  '(A) with its suggestion');
select is((pg_temp.line(26)).corrected_fields, array['qty'],
  '(A) and its qty correction is kept, with nothing else added');
select is((pg_temp.line(26)).qty, 3::numeric, '(A) the corrected qty is untouched');
-- Credit qty, lot, "line checked", unit price and amount are not mapping decisions either.
select is(pg_temp.upd(31, '{"credit_qty": 1, "lot_code": "L1", "reviewed": true}', 2), 'ok',
  'credit qty, a lot and "line checked" are saved');
select is(pg_temp.upd(31, '{"unit_price": 13, "line_amount": 26}', 2), 'ok', 'a price and an amount are saved');
select is(pg_temp.upd(30, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  'the article is mapped in invoice 1');
select is((pg_temp.line(31)).mapping_source, 'auto', 'the line with only value edits is mapped');
select is((pg_temp.line(31)).corrected_fields, array['unit_price', 'line_amount'],
  'with corrected_fields exactly the value corrections (credit, lot and checked are none)');
select is((pg_temp.line(31)).lot_code, 'L1', 'and its lot is kept');
-- A changed unit decides the unit only: the mapping still reaches the line, the unit stays.
select is(pg_temp.upd(33, '{"unit": "g"}', 2), 'ok', 'the owner changes the unit of an unmapped line');
select is(pg_temp.upd(32, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  'the article is mapped in invoice 1');
select is((pg_temp.line(33)).mapping_source, 'auto', 'the line with a changed unit is mapped');
select is((pg_temp.line(33)).unit, 'g', 'and keeps the unit the owner chose');
select is((pg_temp.line(33)).corrected_fields, array['unit'], 'the unit stays a correction');
-- (B) Invoice 9 has no supplier. "Line checked" and a supplier link afterwards.
select is(pg_temp.upd(27, '{"reviewed": true}', 9), 'ok', '(B) the owner marks a line of an invoice with no supplier as checked');
-- Mapping decisions on the same invoice: non-stock and back, and an ingredient cleared.
select is(pg_temp.upd(28, '{"is_stock": false, "cost_centre_id": "c5000000-0000-4000-8000-0000000000c5"}', 9),
  'ok', '(B) another line is booked non-stock');
select is(pg_temp.upd(28, '{"is_stock": true}', 9), 'ok', '(B) and back to stock');
select is(pg_temp.upd(29, '{"ingredient_id": null}', 9), 'ok', '(B) a third line has its ingredient cleared');
select is(pg_temp.link(9, '5a000000-0000-4000-8000-00000000005a'), 'ok',
  '(B) the supplier that remembers MAN-1 is linked');
select is((pg_temp.line(27)).ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  '(B) the checked line is auto-mapped');
select is((pg_temp.line(27)).mapping_source, 'auto', '(B) as an auto mapping');
select is((pg_temp.line(27)).corrected_fields, '{}', '(B) with nothing counted as a correction');
select is((pg_temp.line(34)).mapping_source, 'auto', '(B) the untouched control line is mapped');
select is((pg_temp.line(28)).ingredient_id, null, '(B) the non-stock-and-back line is left to the reviewer');
select is((pg_temp.line(29)).ingredient_id, null, '(B) so is the line whose ingredient the reviewer cleared');

-- Access.
select is(pg_temp.upd(14, '{"reviewed": true}', 5), 'P0001 invoice_not_in_review', 'an invoice in duplicate is closed');
select is(pg_temp.upd(12, '{"reviewed": true}', 3), 'P0001 invoice_not_in_review', 'and an approved one');
select is(pg_temp.upd(99, '{"reviewed": true}'), 'P0002 not_found', 'an unknown line is not found');
select is(pg_temp.upd(10, '{"reviewed": true}', 1), 'P0002 not_found', 'a line of another invoice is not found');
select is(pg_temp.upd(1, '{"ingredient_id": "1e000000-0000-4000-8000-00000000001e"}'),
  '23503 insert or update on table "supplier_item" violates foreign key constraint "supplier_item_ingredient_fk"',
  'tenant B''s ingredient is refused');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.upd(4, '{"reviewed": true}'), 'ok', 'the admin may review');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.upd(4, '{"reviewed": true}'), '42501 insufficient_privilege', 'the chef may not');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.upd(4, '{"reviewed": true}'), '42501 insufficient_privilege', 'the waiter may not');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.upd(4, '{"reviewed": true}'), 'P0002 not_found', 'owner B cannot reach A''s line');
select is(pg_temp.upd(18, '{"reviewed": true}', 8), 'ok', 'owner B reviews B''s own line');

reset role;
select * from finish();
rollback;
