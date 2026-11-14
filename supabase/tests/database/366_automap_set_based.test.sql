-- P2-7, lead decision 2026-11-14 (ADR-044 "Statistics-independent automap"): app.automap_lines looks articles up with no
-- dependence on table statistics. Before the rewrite, the per-line lookup seq-scanned the supplier's whole catalogue and hashed
-- the line's description once per catalogue row when supplier_item had no fresh statistics: a 10 x 200 line file against
-- 5 000 articles took about 52 s. Here the catalogue is inserted in the same transaction, so it is never analyzed. The
-- semantics are pinned too: the code wins over the description, inactive articles and ingredients are skipped, and only
-- the invoice's own tenant and supplier are searched. Fake data only (checksum-valid fake VAT numbers, 1998 dates).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);


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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin DigiAlto');

-- Master data: three ingredients (one inactive), the file's supplier and another supplier of the same tenant.
insert into public.ingredient (id, tenant_id, name, base_unit, is_active) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg', true),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Olio', 'l', true),
  ('1d000000-0000-4000-8000-00000000001d', '11111111-1111-4111-8111-111111111111', 'Vecchio', 'kg', false);
insert into public.supplier (id, tenant_id, name, vat_number, is_active) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo 1', 'IT12345678903', true),
  ('5b000000-0000-4000-8000-00000000005b', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo 2', null, true);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, description_hash, pack_qty, pack_unit, invoice_unit, is_active) values
  -- Line 1 matches A by code and B by description: A must win.
  ('5a100000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'AB-1', null, 1, 'kg', 'kg', true),
  ('5b100000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1c000000-0000-4000-8000-00000000001c', null, app.description_hash('Fesa AB'), 1, 'l', 'l', true),
  -- Line 2: the code's article is inactive, so the description's article applies.
  ('5a200000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'AB-2', null, 1, 'kg', 'kg', false),
  ('5b200000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1c000000-0000-4000-8000-00000000001c', null, app.description_hash('Fesa AB due'), 1, 'l', 'l', true),
  -- Line 3: the code's article has an inactive ingredient, so the description's article applies.
  ('5a300000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1d000000-0000-4000-8000-00000000001d', 'AB-3', null, 1, 'kg', 'kg', true),
  ('5b300000-0000-4000-8000-0000000000b3', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1c000000-0000-4000-8000-00000000001c', null, app.description_hash('Fesa AB tre'), 1, 'l', 'l', true),
  -- Line 4: only another supplier of the same tenant knows this code and description: nothing applies.
  ('5c400000-0000-4000-8000-0000000000c4', '11111111-1111-4111-8111-111111111111', '5b000000-0000-4000-8000-00000000005b', '1a000000-0000-4000-8000-00000000001a', 'AB-4', null, 1, 'kg', 'kg', true),
  ('5c500000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', '5b000000-0000-4000-8000-00000000005b', '1a000000-0000-4000-8000-00000000001a', null, app.description_hash('Fesa AB quattro'), 1, 'kg', 'kg', true);


-- Helpers (as in 363) ----------------------------------------
create function pg_temp.iid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text, aal text default null) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role,
    'aal', coalesce(aal, case when app_role = 'admin' then 'aal2' else 'aal1' end))::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text, text) to authenticated;
-- The exact outcome of a statement: ok, or sqlstate:message[:detail]. The helper only records what the statement raised; the test asserts it.
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  v_state text;
  v_msg text;
  v_detail text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ':' || v_msg || coalesce(':' || nullif(v_detail, ''), '');
end
$$;
grant execute on function pg_temp.err(text) to authenticated;
create function pg_temp.path(n int, ext text default 'xml') returns text language sql immutable as $$
  select '11111111-1111-4111-8111-111111111111/1998/' || pg_temp.iid(n) || '.' || ext $$;
-- The fixture Storage object of invoice n (1200 bytes, application/xml unless said otherwise).
create function pg_temp.obj(n int, p_size int default 1200, p_ext text default 'xml') returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata)
  values ('invoices', pg_temp.path(n, p_ext), jsonb_build_object('size', p_size, 'mimetype', case p_ext when 'xml' then 'application/xml' else 'application/pkcs7-mime' end))
$$;
-- A line with all the fields the import needs; amounts are kept equal so the body totals stay consistent.
create function pg_temp.ln(p_desc text, p_code text) returns jsonb language sql as $$
  select jsonb_build_object('rawDescription', p_desc, 'supplierCode', p_code, 'qty', '1.0000', 'unitRaw', 'pz', 'unitPrice', '1.0000', 'lineAmount', '1.0000',
                            'vatRate', '22.00', 'vatNature', null, 'xmlDetails', null) $$;
create function pg_temp.body(n int, idx int, p_number text, p_lines jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', pg_temp.iid(n), 'filePath', pg_temp.path(n), 'fileMime', 'application/xml',
    'fileSizeBytes', 1200, 'originalFilename', 'IT00000000001_00001.xml', 'bodyIndex', idx, 'documentType', 'TD01', 'notes', '[]'::jsonb,
    'header', jsonb_build_object('supplierVat', 'IT12345678903', 'supplierName', 'Fornitore Demo 1', 'numberRaw', p_number, 'invoiceDate', '1998-10-03', 'dueDate', null,
                                 'netTotal', jsonb_array_length(p_lines) || '.00', 'vatTotal', round(jsonb_array_length(p_lines) * 0.22, 2)::text,
                                 'grossTotal', round(jsonb_array_length(p_lines) * 1.22, 2)::text),
    'lines', p_lines,
    'vatSummary', jsonb_build_array(jsonb_build_object('vatRate', '22.00', 'vatNature', null, 'taxable', jsonb_array_length(p_lines) || '.00',
      'tax', round(jsonb_array_length(p_lines) * 0.22, 2)::text, 'rounding', null, 'accessoryCosts', null, 'vatChargeability', 'I', 'legalReference', null)))
$$;
create function pg_temp.pl(p_sha text, p_bodies jsonb) returns jsonb language sql as $$
  select jsonb_build_object('sha256', p_sha, 'format', 'FPR12', 'bodyCount', jsonb_array_length(p_bodies), 'buyer', '{"vat": "IT00000000000", "cf": null}'::jsonb, 'invoices', p_bodies) $$;
create temp table pay (k text primary key, p jsonb not null);
grant select on pay to authenticated;
create function pg_temp.try_import(p_key text) returns text language sql as $$ select pg_temp.err(format('select public.import_xml_invoices((select p from pg_temp.pay where k = %L))', p_key)) $$;
grant execute on function pg_temp.iid(int), pg_temp.path(int, text), pg_temp.ln(text, text), pg_temp.body(int, int, text, jsonb), pg_temp.pl(text, jsonb), pg_temp.try_import(text) to authenticated;
create function pg_temp.line(n int, pos int) returns public.invoice_line language sql as $$
  select * from public.invoice_line where invoice_id = pg_temp.iid(n) and position = pos and sub_position = 0 $$;

-- 1. Semantics ---------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.obj(1);
insert into pay values ('rules', pg_temp.pl(repeat('1', 64), jsonb_build_array(pg_temp.body(1, 1, 'FT 1', jsonb_build_array(
  pg_temp.ln('Fesa AB', 'AB-1'), pg_temp.ln('Fesa AB due', 'AB-2'), pg_temp.ln('Fesa AB tre', 'AB-3'), pg_temp.ln('Fesa AB quattro', 'AB-4'))))));
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.try_import('rules'), 'ok', 'a four-line file imports');
reset role;
select is((pg_temp.line(1, 1)).supplier_item_id, '5a100000-0000-4000-8000-0000000000a1'::uuid,
  'a line matching article A by code and article B by description gets A (the code wins)');
select is((pg_temp.line(1, 1)).ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid, 'with A''s ingredient');
select is((pg_temp.line(1, 2)).supplier_item_id, '5b200000-0000-4000-8000-0000000000b2'::uuid,
  'an inactive code article is skipped: the description''s article applies');
select is((pg_temp.line(1, 3)).supplier_item_id, '5b300000-0000-4000-8000-0000000000b3'::uuid,
  'a code article with an inactive ingredient is skipped: the description''s article applies');
select is((pg_temp.line(1, 4)).supplier_item_id, null, 'another supplier''s articles are never applied, by code or by description');
select is((pg_temp.line(1, 4)).mapping_source, null, 'and the line has no mapping source');

-- 2. The ceiling with a real-size catalogue and no statistics -----------------------------------------------------------------------------------------------------
-- 5 000 articles of the file's supplier: C-1..C-200 match the lines' codes, the rest are other articles. Inserted in this
-- transaction, so supplier_item has no statistics for them (autoanalyze cannot see uncommitted rows).
insert into public.supplier_item (tenant_id, supplier_id, ingredient_id, supplier_code, description_hash, pack_qty, pack_unit, invoice_unit, is_active)
select '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a',
       case when g <= 200 then 'C-' || g else 'N-' || g end, null, 1, 'kg', 'kg', true
  from generate_series(1, 5000) g;
select pg_temp.obj(100 + n) from generate_series(1, 10) n;
insert into pay values ('big', pg_temp.pl(repeat('2', 64), (select jsonb_agg(pg_temp.body(100 + n, n, 'FT 7' || n,
  (select jsonb_agg(pg_temp.ln('Riga ' || g, 'C-' || g)) from generate_series(1, 200) g))) from generate_series(1, 10) n)));
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local statement_timeout = '5s';
select set_config('p27.catalogue_started', clock_timestamp()::text, true);
select is(pg_temp.try_import('big'), 'ok', 'ten bodies of 200 lines against an unanalyzed 5 000-article catalogue import under a 5 second statement timeout');
select diag('the catalogue import took ' || round(extract(epoch from clock_timestamp() - current_setting('p27.catalogue_started')::timestamptz) * 1000) || ' ms');
reset statement_timeout;
reset role;
select is((select count(*)::int from public.invoice_line l join public.invoice i on i.id = l.invoice_id
            where i.number_raw like 'FT 7%' and l.mapping_source = 'auto'), 2000, 'every one of the 2 000 lines is mapped by its code');
select is((select count(*)::int from public.invoice_line l join public.supplier_item si on si.id = l.supplier_item_id
            join public.invoice i on i.id = l.invoice_id
            where i.number_raw like 'FT 7%' and si.supplier_code = l.supplier_code), 2000, 'each to the article with its own code');
select is((select count(*)::int from public.invoice_line l join public.invoice i on i.id = l.invoice_id
            where i.number_raw like 'FT 7%' and l.corrected_fields <> '{}'), 0, 'and none of them is marked corrected');
select is((select count(*)::int from public.supplier_item where supplier_id = '5a000000-0000-4000-8000-00000000005a'), 5006,
  'the catalogue is the size this case is about');

select * from finish();
rollback;
