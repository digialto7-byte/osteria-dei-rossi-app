-- P2-7, lead decision 2026-11-14 (ADR-044 "Statistics-independent automap"): app.automap_lines looks articles up with no
-- dependence on table statistics. Before the rewrite, the per-line lookup seq-scanned the supplier's whole catalogue and hashed
-- the line's description once per catalogue row when supplier_item had no fresh statistics: a 10 x 200 line file against
-- 5 000 articles took about 52 s. Here the catalogues are inserted in the same transaction, so they are never analyzed.
-- Two ceiling cases, one per half of the candidate lookup: 2 000 lines matched by CODE, and 2 000 lines with no code
-- matched by DESCRIPTION HASH, each against 5 000 articles under the same 5 second bound. The semantics are pinned too:
-- the code wins over the description, inactive articles and ingredients are skipped, another supplier of the same tenant
-- is never searched, and neither is another TENANT: tenant B owns an article with the same code and the same description
-- as tenant A's, and tenant A's lines get tenant A's article by code and by description hash (022 also pins tenant
-- scoping, with an article of another code). Before each timed import, `analyze public.supplier_item (id)` gives the
-- foreign-key checks on supplier_item a true row count: after earlier files' rolled-back inserts, an analyze can leave
-- supplier_item at reltuples 0 with relpages > 0, and the (tenant_id, id) check is then planned on the tenant-only index and
-- scans the whole tenant per check. Only `id` is analyzed: the lookup's columns (tenant_id, supplier_id, supplier_code,
-- description_hash, is_active) keep no statistics, so cand keeps its statistics-free plan. A full analyze would give cand a
-- statistics-driven plan and hide the pre-ADR-044 regression this test exists to catch (it then passes in under a second).
-- Tenant scoping is detected deterministically by
-- line 7 (a lookup that forgot the tenant picks tenant B's article, the write then fails its tenant-composite foreign key and the
-- import is not ok, and the exact article is asserted); lines 5 and 6 are ties between equally ranked articles, so best effort.
-- Fake data only (checksum-valid fake VAT numbers, 1998 dates).
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);


insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('01010101-0101-4101-8101-010101010101', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '01010101-0101-4101-8101-010101010101', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
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
  ('5b000000-0000-4000-8000-00000000005b', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo 2', null, true),
  -- The hash-only catalogue's supplier (section 3).
  ('5d000000-0000-4000-8000-00000000005d', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo 3', 'IT22222222220', true),
  -- Tenant B's supplier, with the same VAT number as tenant A's file supplier (VAT numbers are unique per tenant only).
  ('5e000000-0000-4000-8000-00000000005e', '01010101-0101-4101-8101-010101010101', 'Fornitore Demo B', 'IT12345678903', true);
insert into public.ingredient (id, tenant_id, name, base_unit, is_active) values
  ('2a000000-0000-4000-8000-00000000002a', '01010101-0101-4101-8101-010101010101', 'Manzo B', 'kg', true);
-- Tenant B's id 01010101-... sorts before tenant A's in the unique indexes; this does not make lines 5 and 6 deterministic.
-- Tenant B has articles (one per supplier, eight suppliers) with the SAME code and the SAME description as tenant A's article of
-- lines 5 and 6 below, and one with the same code as the line-7 case. A lookup that forgot the tenant would meet them. There
-- are eight because the choice between two equally ranked articles is arbitrary (a one-row top-N sort is not stable): with
-- one, such a lookup would still pick tenant A's article now and then. Line 7 has no tie (see there).
insert into public.supplier (id, tenant_id, name, vat_number, is_active)
select ('5e00000' || g || '-0000-4000-8000-00000000005e')::uuid, '01010101-0101-4101-8101-010101010101', 'Fornitore Demo B' || g, null, true
  from generate_series(1, 7) g;
insert into public.supplier_item (tenant_id, supplier_id, ingredient_id, supplier_code, description_hash, pack_qty, pack_unit, invoice_unit, is_active)
select '01010101-0101-4101-8101-010101010101', sb.id, '2a000000-0000-4000-8000-00000000002a', 'AB-5', app.description_hash('Fesa AB cinque'), 1, 'kg', 'kg', true
  from public.supplier sb where sb.tenant_id = '01010101-0101-4101-8101-010101010101';
-- Line 7: tenant B's article has the line's code and description, so a lookup that forgot the tenant ranks it first (code
-- wins), with no tie; tenant A's article of that description has no code.
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, description_hash, pack_qty, pack_unit, invoice_unit, is_active) values
  ('5e700000-0000-4000-8000-0000000000e7', '01010101-0101-4101-8101-010101010101', '5e000000-0000-4000-8000-00000000005e', '2a000000-0000-4000-8000-00000000002a', 'AB-7', app.description_hash('Fesa AB sette'), 1, 'kg', 'kg', true);
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
  ('5c500000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', '5b000000-0000-4000-8000-00000000005b', '1a000000-0000-4000-8000-00000000001a', null, app.description_hash('Fesa AB quattro'), 1, 'kg', 'kg', true),
  -- Lines 5 and 6 (tenant scoping): one article with a code and a description. Line 5 has this code and a description nobody
  -- knows (the code path); line 6 has no code and this description (the description-hash path).
  ('5a500000-0000-4000-8000-0000000000a5', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1c000000-0000-4000-8000-00000000001c', 'AB-5', app.description_hash('Fesa AB cinque'), 1, 'l', 'l', true),
  -- Line 7 (tenant scoping, no tie): this article has the description only; tenant B's article has the code too.
  ('5a700000-0000-4000-8000-0000000000a7', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1c000000-0000-4000-8000-00000000001c', null, app.description_hash('Fesa AB sette'), 1, 'l', 'l', true);


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
create function pg_temp.body(n int, idx int, p_number text, p_lines jsonb, p_vat text default 'IT12345678903', p_name text default 'Fornitore Demo 1') returns jsonb language sql as $$
  select jsonb_build_object('id', pg_temp.iid(n), 'filePath', pg_temp.path(n), 'fileMime', 'application/xml',
    'fileSizeBytes', 1200, 'originalFilename', 'IT00000000001_00001.xml', 'bodyIndex', idx, 'documentType', 'TD01', 'notes', '[]'::jsonb,
    'header', jsonb_build_object('supplierVat', p_vat, 'supplierName', p_name, 'numberRaw', p_number, 'invoiceDate', '1998-10-03', 'dueDate', null,
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
grant execute on function pg_temp.iid(int), pg_temp.path(int, text), pg_temp.ln(text, text), pg_temp.body(int, int, text, jsonb, text, text), pg_temp.pl(text, jsonb), pg_temp.try_import(text) to authenticated;
create function pg_temp.line(n int, pos int) returns public.invoice_line language sql as $$
  select * from public.invoice_line where invoice_id = pg_temp.iid(n) and position = pos and sub_position = 0 $$;

-- 1. Semantics ---------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.obj(1);
insert into pay values ('rules', pg_temp.pl(repeat('1', 64), jsonb_build_array(pg_temp.body(1, 1, 'FT 1', jsonb_build_array(
  pg_temp.ln('Fesa AB', 'AB-1'), pg_temp.ln('Fesa AB due', 'AB-2'), pg_temp.ln('Fesa AB tre', 'AB-3'), pg_temp.ln('Fesa AB quattro', 'AB-4'),
  pg_temp.ln('Riga cinque', 'AB-5'), pg_temp.ln('Fesa AB cinque', null), pg_temp.ln('Fesa AB sette', 'AB-7'))))));
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.try_import('rules'), 'ok', 'a seven-line file imports');
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
select is((pg_temp.line(1, 5)).supplier_item_id, '5a500000-0000-4000-8000-0000000000a5'::uuid,
  'by code: tenant A''s line gets tenant A''s article, never tenant B''s article with the same code and description');
select is((pg_temp.line(1, 6)).supplier_item_id, '5a500000-0000-4000-8000-0000000000a5'::uuid,
  'by description hash: tenant A''s line (no code) gets tenant A''s article, never tenant B''s article with the same description');
select is((pg_temp.line(1, 7)).supplier_item_id, '5a700000-0000-4000-8000-0000000000a7'::uuid,
  'by description hash, with tenant B''s article of the same code ranked first if it were seen: tenant A''s article by description');

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
-- A true row count for invoice_line's foreign-key checks on supplier_item, statistics on `id` only (see the header); as the
-- table owner, before switching role. The lookup's columns stay without statistics.
reset role;
analyze public.supplier_item (id);
set local role authenticated;
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
select is((select count(*)::int from public.supplier_item where supplier_id = '5a000000-0000-4000-8000-00000000005a'), 5008,
  'the catalogue is the size this case is about');

-- 3. The same ceiling for the description-hash half: no codes on the lines -------------------------------------------------------------------------------------------
-- 5 000 articles of another supplier, none with a code: 'Voce 1'..'Voce 200' (hashed) match the lines' descriptions, the rest
-- are other articles. Same transaction, so again no statistics. The lines have no supplier code, so only the hash can match.
insert into public.supplier_item (tenant_id, supplier_id, ingredient_id, supplier_code, description_hash, pack_qty, pack_unit, invoice_unit, is_active)
select '11111111-1111-4111-8111-111111111111', '5d000000-0000-4000-8000-00000000005d', '1a000000-0000-4000-8000-00000000001a',
       null, app.description_hash(case when g <= 200 then 'Voce ' || g else 'Altro ' || g end), 1, 'kg', 'kg', true
  from generate_series(1, 5000) g;
select pg_temp.obj(200 + n) from generate_series(1, 10) n;
insert into pay values ('bighash', pg_temp.pl(repeat('3', 64), (select jsonb_agg(pg_temp.body(200 + n, n, 'FT 8' || n,
  (select jsonb_agg(pg_temp.ln('Voce ' || g, null)) from generate_series(1, 200) g), 'IT22222222220', 'Fornitore Demo 3')) from generate_series(1, 10) n)));
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
-- A true row count for the foreign-key checks, `id` only, as in section 2.
reset role;
analyze public.supplier_item (id);
set local role authenticated;
set local statement_timeout = '5s';
select set_config('p27.hash_started', clock_timestamp()::text, true);
select is(pg_temp.try_import('bighash'), 'ok', 'ten bodies of 200 code-less lines against an unanalyzed 5 000-article catalogue import under a 5 second statement timeout');
select diag('the description-hash import took ' || round(extract(epoch from clock_timestamp() - current_setting('p27.hash_started')::timestamptz) * 1000) || ' ms');
reset statement_timeout;
reset role;
select is((select count(*)::int from public.invoice_line l join public.invoice i on i.id = l.invoice_id
            where i.number_raw like 'FT 8%' and l.supplier_code is null and l.mapping_source = 'auto'), 2000,
  'every one of the 2 000 code-less lines is mapped by its description');
select is((select count(*)::int from public.invoice_line l join public.supplier_item si on si.id = l.supplier_item_id
            join public.invoice i on i.id = l.invoice_id
            where i.number_raw like 'FT 8%' and si.supplier_code is null and si.description_hash = app.description_hash(l.raw_description)), 2000,
  'each to the article with its own description');
select is((select count(*)::int from public.invoice_line l join public.invoice i on i.id = l.invoice_id
            where i.number_raw like 'FT 8%' and l.corrected_fields <> '{}'), 0, 'and none of them is marked corrected');
select is((select count(*)::int from public.supplier_item where supplier_id = '5d000000-0000-4000-8000-00000000005d'), 5000,
  'the description-hash catalogue is 5 000 articles');

select * from finish();
rollback;
