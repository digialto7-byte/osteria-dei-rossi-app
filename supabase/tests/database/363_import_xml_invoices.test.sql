-- P2-7 S4 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.3.6, 5 S4): public.invoice_xml_precheck and public.import_xml_invoices.
-- The import turns the parsed payload of a FatturaPA file into invoices in ONE transaction: one invoice per body with its lines (the XML values are the correction
-- baseline in `extracted`), its VAT summary rows, the duplicate decision, the supplier link and the article mapping (the code of the file first), and an audit row. It never
-- sets extracted_at (the AI quality report stays clean). Every refusal rolls the whole file back. Owner and admin only. Fake data only: "Fornitore Demo 1", "Osteria Demo A/B",
-- checksum-valid fake VAT numbers, lot codes and 1998 dates. The Storage objects are fixture rows (the native shim has the table; in CI the real one).
begin;
create extension if not exists pgtap with schema extensions;
select plan(89);

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

-- Master data: the supplier of the file, two ingredients, and the article memory (one item by code, one by description).
insert into public.ingredient (id, tenant_id, name, base_unit, is_active) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg', true),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Olio', 'l', true);
insert into public.supplier (id, tenant_id, name, vat_number, is_active) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo 1', 'IT12345678903', true);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, description_hash, pack_qty, pack_unit, invoice_unit, is_active) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'ART-1', null, 1, 'kg', 'kg', true),
  ('53000000-0000-4000-8000-000000000053', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1c000000-0000-4000-8000-00000000001c', null,
   app.description_hash('Olio extra vergine'), 1, 'l', 'l', true);

-- Helpers ---------------------------------------------------------------------------------------------------------------------------------------------------
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
create function pg_temp.lines3() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('rawDescription', 'Manzo fesa', 'supplierCode', 'ART-1', 'qty', '2.0000', 'unitRaw', 'kg', 'unitPrice', '12.5000', 'lineAmount', '25.0000',
                       'vatRate', '10.00', 'vatNature', null, 'xmlDetails', jsonb_build_object('lineNumber', 1, 'codes', jsonb_build_array(jsonb_build_object('type', 'EAN', 'value', 'ART-1')))),
    jsonb_build_object('rawDescription', 'Olio extra vergine', 'supplierCode', null, 'qty', '1.0000', 'unitRaw', 'l', 'unitPrice', '10.0000', 'lineAmount', '10.0000',
                       'vatRate', '22.00', 'vatNature', null, 'xmlDetails', null),
    jsonb_build_object('rawDescription', 'Servizio consegna', 'supplierCode', null, 'qty', '1.0000', 'unitRaw', 'pz', 'unitPrice', '5.0000', 'lineAmount', '5.0000',
                       'vatRate', '0.00', 'vatNature', 'N4', 'xmlDetails', null)) $$;
create function pg_temp.summary3() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('vatRate', '10.00', 'vatNature', null, 'taxable', '25.00', 'tax', '2.50', 'rounding', null, 'accessoryCosts', null, 'vatChargeability', 'I', 'legalReference', null),
    jsonb_build_object('vatRate', '22.00', 'vatNature', null, 'taxable', '10.00', 'tax', '2.20', 'rounding', '-0.01', 'accessoryCosts', null, 'vatChargeability', null, 'legalReference', null),
    jsonb_build_object('vatRate', '0.00', 'vatNature', 'N4', 'taxable', '5.00', 'tax', '0.00', 'rounding', null, 'accessoryCosts', null, 'vatChargeability', null, 'legalReference', 'Art. 10 DPR 633/72')) $$;
-- One body: id number n, body index idx, invoice number text.
create function pg_temp.body(n int, idx int, p_number text, p_vat text default 'IT12345678903', p_lines jsonb default null, p_summary jsonb default null,
                             p_type text default 'TD01', p_ext text default 'xml') returns jsonb language sql as $$
  select jsonb_build_object('id', pg_temp.iid(n), 'filePath', pg_temp.path(n, p_ext), 'fileMime', case p_ext when 'xml' then 'application/xml' else 'application/pkcs7-mime' end,
    'fileSizeBytes', 1200, 'originalFilename', 'IT00000000001_00001.xml', 'bodyIndex', idx, 'documentType', p_type, 'notes', jsonb_build_array('attachments'),
    'header', jsonb_build_object('supplierVat', p_vat, 'supplierName', 'Fornitore Demo 1', 'numberRaw', p_number, 'invoiceDate', '1998-10-03', 'dueDate', '1998-11-02',
                                 'netTotal', '40.00', 'vatTotal', '4.70', 'grossTotal', '44.70'),
    'lines', coalesce(p_lines, pg_temp.lines3()), 'vatSummary', coalesce(p_summary, pg_temp.summary3()))
$$;
create function pg_temp.pl(p_sha text, p_bodies jsonb, p_buyer jsonb default '{"vat": "IT00000000000", "cf": null}') returns jsonb language sql as $$
  select jsonb_build_object('sha256', p_sha, 'format', 'FPR12', 'bodyCount', jsonb_array_length(p_bodies), 'buyer', p_buyer, 'invoices', p_bodies) $$;
create function pg_temp.sha(c text) returns text language sql immutable as $$ select repeat(c, 64) $$;
create function pg_temp.imp(p jsonb) returns jsonb language sql as $$ select public.import_xml_invoices(p) $$;
grant execute on function pg_temp.iid(int), pg_temp.path(int, text), pg_temp.lines3(), pg_temp.summary3(), pg_temp.body(int, int, text, text, jsonb, jsonb, text, text),
  pg_temp.pl(text, jsonb, jsonb), pg_temp.sha(text), pg_temp.imp(jsonb) to authenticated;
-- Statements as text for pg_temp.err: the payload is passed through a temp table, so quoting stays simple.
create temp table pay (k text primary key, p jsonb not null);
grant select on pay to authenticated;
create function pg_temp.try_import(p_key text) returns text language sql as $$ select pg_temp.err(format('select public.import_xml_invoices((select p from pg_temp.pay where k = %L))', p_key)) $$;
grant execute on function pg_temp.try_import(text) to authenticated;

select pg_temp.obj(n) from generate_series(1, 6) n;
select pg_temp.obj(7, 999);
select pg_temp.obj(20, 1200, 'p7m');

-- 1. Privileges -----------------------------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.import_xml_invoices(jsonb)', 'execute')), array['authenticated'], 'import_xml_invoices: authenticated only');
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.invoice_xml_precheck(text, text, text, text)', 'execute')), array['authenticated'], 'invoice_xml_precheck: authenticated only');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
                  unnest(array['app.xml_check_payload(jsonb, uuid)', 'app.xml_buyer_state(uuid, text, text)', 'app.xml_max_bodies()', 'app.xml_max_lines()']) f(fn)
            where has_function_privilege(r.role, f.fn, 'execute')), 0, 'the helpers are closed to every API role');
select is((select count(*)::int from pg_proc where oid in ('public.import_xml_invoices(jsonb)'::regprocedure, 'public.invoice_xml_precheck(text, text, text, text)'::regprocedure)
             and prosecdef and proconfig = array['search_path=""']), 2, 'both are security definers with an empty search_path');
select is(app.xml_max_bodies() || ',' || app.xml_max_lines() || ',' || array_to_string(app.xml_document_types(), '/'), '10,200,TD01/TD24/TD25', 'the constants: 10 bodies, 200 lines, the allow-list TD01, TD24, TD25');

-- 2. One body --------------------------------------------------------------------------------------------------------------------------------------------------
insert into pay values ('one', pg_temp.pl(pg_temp.sha('a'), jsonb_build_array(pg_temp.body(1, 1, 'FT 12'))));
create temp table res (k text, j jsonb);
grant all on res to authenticated;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temp table q_before as select public.extraction_quality(current_date - 30, current_date + 1) as j;
grant select on q_before to authenticated;
insert into res select 'one', public.import_xml_invoices((select p from pay where k = 'one'));
select is((select jsonb_array_length(j) from res where k = 'one'), 1, 'the import of one body answers one invoice');
select is((select j -> 0 ->> 'status' from res where k = 'one'), 'review', 'in status review');
select is((select j -> 0 ->> 'id' from res where k = 'one'), pg_temp.iid(1)::text, 'with the id of the payload');
select is((select (j -> 0 -> 'duplicateOf') = 'null'::jsonb from res where k = 'one'), true, 'and no duplicate');
reset role;
select is((select i.status::text || ',' || i.document_type || ',' || i.xml_format || ',' || i.xml_body_index || '/' || i.xml_body_count from public.invoice i where i.id = pg_temp.iid(1)),
          'review,TD01,FPR12,1/1', 'the invoice carries the XML metadata');
select is((select i.supplier_vat || ',' || i.supplier_name || ',' || i.number_raw || ',' || i.invoice_date || ',' || i.due_date || ',' || i.net_total || ',' || i.vat_total || ',' || i.gross_total
             from public.invoice i where i.id = pg_temp.iid(1)), 'IT12345678903,Fornitore Demo 1,FT 12,1998-10-03,1998-11-02,40.0000,4.7000,44.7000', 'and the header and the three totals');
select is((select i.xml_notes from public.invoice i where i.id = pg_temp.iid(1)), array['attachments'], 'and the notes of the file');
select is((select i.supplier_id from public.invoice i where i.id = pg_temp.iid(1)), '5a000000-0000-4000-8000-00000000005a'::uuid, 'the supplier is linked by its VAT number');
select is((select i.extracted_at is null and i.extraction_model is null and i.extraction_json is null from public.invoice i where i.id = pg_temp.iid(1)), true,
          'extracted_at and the model are null: the file never went through the AI path');
select is((select i.totals_diff from public.invoice i where i.id = pg_temp.iid(1)), 0::numeric, 'the totals gate finds no difference');
select is((select i.gate_flags from public.invoice i where i.id = pg_temp.iid(1)), '{}'::text[], 'and no total_mismatch');
select is((select i.created_by from public.invoice i where i.id = pg_temp.iid(1)), 'a1000000-0000-4000-8000-00000000000a'::uuid, 'created_by is the caller');
select is((select count(*)::int from public.invoice_line where invoice_id = pg_temp.iid(1)), 3, 'three lines');
select is((select l.raw_description || ',' || l.supplier_code || ',' || l.qty || ',' || l.unit_raw || ',' || l.unit_price || ',' || l.line_amount || ',' || l.vat_rate
             from public.invoice_line l where l.invoice_id = pg_temp.iid(1) and l.position = 1), 'Manzo fesa,ART-1,2.0000,kg,12.5000,25.0000,10.00', 'line 1 as in the file');
select is((select l.vat_nature || ',' || l.vat_rate from public.invoice_line l where l.invoice_id = pg_temp.iid(1) and l.position = 3), 'N4,0.00', 'the N4 line carries its nature and a 0 rate');
select is((select (l.xml_details -> 'codes' -> 0 ->> 'value') from public.invoice_line l where l.invoice_id = pg_temp.iid(1) and l.position = 1), 'ART-1', 'and the XML details of a line are kept');
select is((select l.extracted ->> 'qty' || ',' || (l.extracted ->> 'unit_price') || ',' || (l.extracted ->> 'line_amount') || ',' || (l.extracted ->> 'vat_rate') || ',' || (l.extracted ->> 'supplier_code')
             from public.invoice_line l where l.invoice_id = pg_temp.iid(1) and l.position = 1), '2.0000,12.5000,25.0000,10.00,ART-1', 'the extracted baseline holds the file values');
select is((select count(*)::int from public.invoice_line l where l.invoice_id = pg_temp.iid(1) and l.corrected_fields <> '{}'), 0, 'no line counts as corrected yet');
select is((select count(*)::int from public.invoice_line l where l.invoice_id = pg_temp.iid(1) and l.ingredient_id is not null), 2, 'two lines are mapped from the article memory');
select is((select l.ingredient_id from public.invoice_line l where l.invoice_id = pg_temp.iid(1) and l.position = 1), '1a000000-0000-4000-8000-00000000001a'::uuid, 'the first by its code (ART-1)');
select is((select l.ingredient_id from public.invoice_line l where l.invoice_id = pg_temp.iid(1) and l.position = 2), '1c000000-0000-4000-8000-00000000001c'::uuid, 'the second by its description');
select is((select l.ingredient_id is null from public.invoice_line l where l.invoice_id = pg_temp.iid(1) and l.position = 3), true, 'the third stays open');
select is((select string_agg(s.vat_rate || ':' || coalesce(s.vat_nature, '-') || ':' || s.taxable || ':' || s.tax || ':' || coalesce(s.rounding::text, '-'), ',' order by s.position)
             from public.invoice_vat_summary s where s.invoice_id = pg_temp.iid(1)), '10.00:-:25.00:2.50:-,22.00:-:10.00:2.20:-0.01,0.00:N4:5.00:0.00:-', 'the three VAT summary rows');
select is((select count(*)::int from public.audit_event where entity_id = pg_temp.iid(1) and action = 'invoice.imported_xml' and created_by = 'a1000000-0000-4000-8000-00000000000a'
             and after = jsonb_build_object('documentType', 'TD01', 'bodyIndex', 1, 'bodyCount', 1, 'status', 'review')), 1, 'one audit row invoice.imported_xml');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select public.extraction_quality(current_date - 30, current_date + 1)), (select j from q_before), 'the extraction-quality report is unchanged by an XML invoice');
reset role;

-- 3. Three bodies, and all or nothing ----------------------------------------------------------------------------------------------------------------------------
insert into pay values ('three', pg_temp.pl(pg_temp.sha('b'), jsonb_build_array(pg_temp.body(2, 1, 'FT 21'), pg_temp.body(3, 2, 'FT 22'), pg_temp.body(4, 3, 'FT 23'))));
insert into pay values ('atomic', pg_temp.pl(pg_temp.sha('c'), jsonb_build_array(pg_temp.body(5, 1, 'FT 31'), pg_temp.body(6, 2, 'FT 32'), pg_temp.body(90, 3, 'FT 33'))));
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.try_import('three'), 'ok', 'a file of three bodies imports');
select is((select count(*)::int from public.invoice where xml_sha256 = pg_temp.sha('b')), 3, 'three invoices with the same sha256');
select is((select array_agg(xml_body_index::text || '/' || xml_body_count order by xml_body_index) from public.invoice where xml_sha256 = pg_temp.sha('b')), array['1/3', '2/3', '3/3'], 'bodies 1 to 3 of 3');
select is(pg_temp.try_import('atomic'), 'P0001:file_missing', 'a third body without its Storage object refuses the whole file (file_missing)');
select is((select count(*)::int from public.invoice where xml_sha256 = pg_temp.sha('c')), 0, 'and nothing of that file was written');
select is((select count(*)::int from public.invoice where id in (pg_temp.iid(5), pg_temp.iid(6), pg_temp.iid(90))), 0, 'not even the first two bodies');

-- 4. Refusals ---------------------------------------------------------------------------------------------------------------------------------------------------
-- Each payload is a mutation of a valid one-body file with a fresh sha256 and a fresh (unused) invoice id.
reset role;
select pg_temp.obj(n) from generate_series(30, 60) n;
select pg_temp.obj(61, 1200, 'p7m');
-- the base payload for invoice n
create function pg_temp.base(n int, c text) returns jsonb language sql as $$ select pg_temp.pl(pg_temp.sha(c), jsonb_build_array(pg_temp.body(n, 1, 'FT 5' || n))) $$;
insert into pay values
  ('badkey', pg_temp.base(30, 'd') || '{"extra": 1}'::jsonb),
  ('badbodykey', jsonb_set(pg_temp.base(31, 'd'), '{invoices,0,surprise}', 'true')),
  ('badamount', jsonb_set(pg_temp.base(32, 'd'), '{invoices,0,lines,0,lineAmount}', '"1e3"')),
  ('numamount', jsonb_set(pg_temp.base(33, 'd'), '{invoices,0,lines,0,lineAmount}', '25')),
  ('negamount', jsonb_set(pg_temp.base(34, 'd'), '{invoices,0,lines,0,lineAmount}', '"-5.0000"')),
  ('td04', pg_temp.pl(pg_temp.sha('d'), jsonb_build_array(pg_temp.body(35, 1, 'FT 535', p_type => 'TD04')))),
  ('td16', pg_temp.pl(pg_temp.sha('d'), jsonb_build_array(pg_temp.body(36, 1, 'FT 536', p_type => 'TD16')))),
  ('eleven', pg_temp.pl(pg_temp.sha('d'), (select jsonb_agg(pg_temp.body(40 + n, n, 'FT 6' || n)) from generate_series(1, 11) n))),
  ('lines201', pg_temp.pl(pg_temp.sha('d'), jsonb_build_array(pg_temp.body(37, 1, 'FT 537', p_lines => (select jsonb_agg(pg_temp.lines3() -> 0) from generate_series(1, 201)))))),
  ('natureless', jsonb_set(pg_temp.base(38, 'd'), '{invoices,0,lines,2,vatNature}', 'null')),
  ('rateandnature', jsonb_set(pg_temp.base(39, 'd'), '{invoices,0,lines,0,vatNature}', '"N4"')),
  ('badnote', jsonb_set(pg_temp.base(40, 'd'), '{invoices,0,notes}', '["made_up"]')),
  ('badnature', jsonb_set(pg_temp.base(41, 'd'), '{invoices,0,lines,2,vatNature}', '"N2"')),
  ('baddate', jsonb_set(pg_temp.base(42, 'd'), '{invoices,0,header,invoiceDate}', '"1998-02-30"')),
  ('badvat', jsonb_set(pg_temp.base(43, 'd'), '{invoices,0,header,supplierVat}', '"it123"')),
  ('indexgap', jsonb_set(pg_temp.base(44, 'd'), '{invoices,0,bodyIndex}', '2')),
  ('countmismatch', jsonb_set(pg_temp.base(45, 'd'), '{bodyCount}', '2')),
  ('bigtotal', jsonb_set(pg_temp.base(46, 'd'), '{invoices,0,header,grossTotal}', '"10000000.01"')),
  ('otherpath', jsonb_set(pg_temp.base(47, 'd'), '{invoices,0,filePath}', to_jsonb('22222222-2222-4222-8222-222222222222/1998/' || pg_temp.iid(47) || '.xml'))),
  ('wrongext', jsonb_set(pg_temp.base(48, 'd'), '{invoices,0,filePath}', to_jsonb(pg_temp.path(48, 'p7m')))),
  ('wrongid', jsonb_set(pg_temp.base(49, 'd'), '{invoices,0,filePath}', to_jsonb(pg_temp.path(50)))),
  ('badsha', jsonb_set(pg_temp.base(50, 'd'), '{sha256}', '"ABC"')),
  ('badsize', pg_temp.pl(pg_temp.sha('d'), jsonb_build_array(pg_temp.body(7, 1, 'FT 507')))),
  ('nosummary', jsonb_set(pg_temp.base(51, 'd'), '{invoices,0,vatSummary}', '[]')),
  ('ownvat', pg_temp.pl(pg_temp.sha('d'), jsonb_build_array(pg_temp.body(52, 1, 'FT 552', p_vat => 'IT00000000000')))),
  ('otherbuyer', pg_temp.pl(pg_temp.sha('d'), jsonb_build_array(pg_temp.body(53, 1, 'FT 553')), '{"vat": "IT11111111115", "cf": null}')),
  ('nobuyer', pg_temp.pl(pg_temp.sha('d'), jsonb_build_array(pg_temp.body(54, 1, 'FT 554')), '{"vat": null, "cf": null}')),
  ('cfbuyer', pg_temp.pl(pg_temp.sha('e'), jsonb_build_array(pg_temp.body(55, 1, 'FT 555')), '{"vat": null, "cf": "00000000000"}')),
  ('p7m', pg_temp.pl(pg_temp.sha('f'), jsonb_build_array(pg_temp.body(61, 1, 'FT 561', p_ext => 'p7m')))),
  ('again', pg_temp.pl(pg_temp.sha('a'), jsonb_build_array(pg_temp.body(56, 1, 'FT 556'))));
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.try_import('badkey'), 'P0001:invalid_request', 'an unknown top-level key is refused');
select is(pg_temp.try_import('badbodykey'), 'P0001:invalid_request', 'an unknown key in a body is refused');
select is(pg_temp.try_import('badamount'), 'P0001:invalid_request', 'an amount written "1e3" is refused');
select is(pg_temp.try_import('numamount'), 'P0001:invalid_request', 'an amount sent as a JSON number is refused');
select is(pg_temp.try_import('negamount'), 'P0001:invalid_request', 'a negative amount is refused');
select is(pg_temp.try_import('td04'), 'P0001:invalid_request', 'a credit note (TD04) is refused');
select is(pg_temp.try_import('td16'), 'P0001:invalid_request', 'and every other type outside the allow-list (TD16)');
select is(pg_temp.try_import('eleven'), 'P0001:invalid_request', 'eleven bodies are refused');
select is(pg_temp.try_import('lines201'), 'P0001:invalid_request', '201 lines are refused');
select is(pg_temp.try_import('natureless'), 'P0001:invalid_request', 'a 0 % line without a nature is refused');
select is(pg_temp.try_import('rateandnature'), 'P0001:invalid_request', 'a 10 % line with a nature is refused');
select is(pg_temp.try_import('badnote'), 'P0001:invalid_request', 'a note outside the list is refused');
select is(pg_temp.try_import('badnature'), 'P0001:invalid_request', 'the generic nature N2 is refused');
select is(pg_temp.try_import('baddate'), 'P0001:invalid_request', 'an impossible date is refused');
select is(pg_temp.try_import('badvat'), 'P0001:invalid_request', 'a badly written supplier VAT is refused');
select is(pg_temp.try_import('indexgap'), 'P0001:invalid_request', 'a body index that does not follow the order is refused');
select is(pg_temp.try_import('countmismatch'), 'P0001:invalid_request', 'a body count that does not match the bodies is refused');
select is(pg_temp.try_import('bigtotal'), 'P0001:invalid_request', 'a total above 10 000 000 is refused');
select is(pg_temp.try_import('otherpath'), 'P0001:invalid_request', 'the path of another tenant is refused');
select is(pg_temp.try_import('wrongext'), 'P0001:invalid_request', 'a path whose extension does not match the MIME type is refused');
select is(pg_temp.try_import('wrongid'), 'P0001:invalid_request', 'a path that is not the invoice id is refused');
select is(pg_temp.try_import('badsha'), 'P0001:invalid_request', 'a sha256 that is not 64 lower-case hex characters is refused');
select is(pg_temp.try_import('nosummary'), 'P0001:invalid_request', 'a file without a VAT summary is refused');
select is(pg_temp.try_import('badsize'), 'P0001:file_missing', 'a Storage object of another size is file_missing');
select is(pg_temp.err($$ select public.import_xml_invoices(null) $$), 'P0001:invalid_request', 'a null payload is refused');
select is(pg_temp.try_import('ownvat'), 'P0001:xml_issued_by_tenant', 'a file issued by the venue itself is refused');
select is(pg_temp.try_import('otherbuyer'), 'P0001:xml_not_addressed_to_tenant', 'a file addressed to another VAT number is refused');
select is(pg_temp.try_import('nobuyer'), 'P0001:xml_not_addressed_to_tenant', 'a file with no buyer data is refused');
select is(pg_temp.try_import('cfbuyer'), 'ok', 'a buyer given by codice fiscale equal to the VAT digits is accepted');
select is(pg_temp.try_import('p7m'), 'ok', 'a p7m file with its object imports');
select is((select count(*)::int from public.invoice where xml_sha256 in (pg_temp.sha('d'))), 0, 'none of the refused files left a row');
select is(pg_temp.try_import('again'), 'P0001:already_uploaded:' || pg_temp.iid(1), 'the same sha256 and body again: already_uploaded, with the id of the first invoice as the detail');
reset role;
-- The same file after the first copy was rejected is allowed again.
update public.invoice set status = 'rejected' where id = pg_temp.iid(1);
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.try_import('again'), 'ok', 'once the first copy is rejected, the same file can be uploaded again');
reset role;

-- The plan's third buyer state (a tenant without a VAT number, note buyer_unchecked) cannot occur on main: tenant.vat_number is NOT NULL.
select col_not_null('public', 'tenant', 'vat_number', 'tenant.vat_number is never null, so the buyer can always be checked');

-- 5. The precheck -------------------------------------------------------------------------------------------------------------------------------------------------
select count(*) as n_before from public.invoice \gset
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select public.invoice_xml_precheck(pg_temp.sha('b'), 'IT12345678903', 'IT00000000000', null) -> 'alreadyUploaded' -> 0 ->> 'bodyIndex'), '1', 'the precheck lists the live bodies of a file (body 1 first)');
select is((select jsonb_array_length(public.invoice_xml_precheck(pg_temp.sha('b'), 'IT12345678903', 'IT00000000000', null) -> 'alreadyUploaded')), 3, 'all three');
select is((select public.invoice_xml_precheck(pg_temp.sha('1'), 'IT12345678903', 'IT00000000000', null)), '{"buyer": "match", "alreadyUploaded": [], "issuedByTenant": false}'::jsonb, 'a new file: nothing uploaded, buyer match, not issued by the venue');
select is((select public.invoice_xml_precheck(pg_temp.sha('1'), 'IT00000000000', 'IT11111111115', null)), '{"buyer": "mismatch", "alreadyUploaded": [], "issuedByTenant": true}'::jsonb, 'another buyer and the venue as issuer');
select is((select public.invoice_xml_precheck(pg_temp.sha('1'), 'IT12345678903', null, '00000000000') ->> 'buyer'), 'match', 'a codice fiscale equal to the VAT digits matches');
select is((select jsonb_array_length(public.invoice_xml_precheck(pg_temp.sha('a'), 'IT12345678903', 'IT00000000000', null) -> 'alreadyUploaded')), 1, 'a rejected copy is not listed (only the second copy of file a is live)');
select is(pg_temp.err($$ select public.invoice_xml_precheck('xyz', 'IT12345678903', 'IT00000000000', null) $$), 'P0001:invalid_request', 'a bad sha256 is refused');
reset role;
select is((select count(*) from public.invoice), :n_before::bigint, 'the precheck wrote nothing');

-- 6. Roles ---------------------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.try_import('cfbuyer'), '42501:insufficient_privilege', 'the chef cannot import');
select is(pg_temp.err($$ select public.invoice_xml_precheck(repeat('a', 64), 'IT12345678903', null, null) $$), '42501:insufficient_privilege', 'nor run the precheck');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.try_import('cfbuyer'), '42501:insufficient_privilege', 'the waiter cannot import');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin', 'aal1');
select is(pg_temp.try_import('cfbuyer'), '42501:insufficient_privilege', 'an admin at aal1 cannot import (the gate)');
select is(pg_temp.err($$ select public.invoice_xml_precheck(repeat('a', 64), 'IT12345678903', null, null) $$), '42501:insufficient_privilege', 'nor run the precheck');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.try_import('cfbuyer'), 'P0001:invalid_request', 'owner B with tenant A''s payload: the path is not B''s folder (invalid_request)');
select is((select count(*)::int from public.invoice), 0, 'and owner B sees none of tenant A''s invoices');
reset role;
-- The admin at aal2 can.
insert into pay values ('admin', pg_temp.pl(pg_temp.sha('8'), jsonb_build_array(pg_temp.body(59, 1, 'FT 559'))));
set local role authenticated;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.try_import('admin'), 'ok', 'an admin at aal2 imports');
reset role;

-- 7. The ceiling: 10 bodies of 200 lines in five seconds ---------------------------------------------------------------------------------------------------------
select pg_temp.obj(100 + n) from generate_series(1, 10) n;
insert into pay values ('big', pg_temp.pl(pg_temp.sha('7'), (select jsonb_agg(pg_temp.body(100 + n, n, 'FT 7' || n, p_lines => (select jsonb_agg(jsonb_build_object('rawDescription', 'Riga ' || g, 'supplierCode', 'C-' || g,
    'qty', '1.0000', 'unitRaw', 'pz', 'unitPrice', '1.0000', 'lineAmount', '1.0000', 'vatRate', '22.00', 'vatNature', null, 'xmlDetails', null)) from generate_series(1, 200) g)))
  from generate_series(1, 10) n)));
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local statement_timeout = '5s';
select is(pg_temp.try_import('big'), 'ok', 'ten bodies of 200 lines import under a 5 second statement timeout');
reset statement_timeout;
reset role;
select is((select count(*)::int from public.invoice_line where invoice_id in (select id from public.invoice where xml_sha256 = pg_temp.sha('7'))), 2000, 'with all 2000 lines');

-- 8. Lock order: the duplicate-key locks of all bodies are taken sorted, before any row is written -----------------------------------------------------------------
select ok((select p.prosrc ~ 'pg_advisory_xact_lock\(k\)[^;]*order by k' or p.prosrc ~ 'order by k[^;]*pg_advisory_xact_lock\(k\)'
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'import_xml_invoices')
          and (select p.prosrc !~ 'pg_advisory_xact_lock\(v_lock\)' from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'import_xml_invoices'),
          'the duplicate locks are taken in sorted key order (no body-order locking), so two multi-body files in opposite order cannot deadlock');

select * from finish();
rollback;
