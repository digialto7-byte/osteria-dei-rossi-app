-- P2-7 S5 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.5, 5 S5): duplicates between an XML invoice and a photo or PDF, and public.review_replace_with_xml.
-- The duplicate key is the existing one (supplier VAT + normalised number + date), whichever file arrives first. An XML invoice that looks like a photo/PDF in review or approved is
-- imported as 'duplicate' of it; a PDF extracted after an XML invoice becomes 'duplicate' of the XML one; two XML files with the key are 'duplicate' of each other.
-- review_replace_with_xml(xml, other) is the one-tap "use the XML instead of the PDF": only when the XML invoice is a duplicate of a non-XML invoice still in review that is an undeclared
-- look-alike of it: the other is rejected (reason "Sostituita dal file XML") and the XML invoice goes to review (or stays a duplicate of a third live look-alike). One transaction;
-- a second call finds the other rejected and writes nothing. Fake data only: "Fornitore Demo 1", 1998 dates. The race against approve_invoice is in scripts/test-db-races.sh.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A');

-- Helpers ---------------------------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.iid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', 'aal1')::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text) to authenticated;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  v_state text;
  v_msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return v_state || ':' || v_msg;
end
$$;
grant execute on function pg_temp.err(text) to authenticated;
-- A photo/PDF invoice of the supplier with a given number and status (written by the table owner, as the extraction would leave it).
create function pg_temp.photo(n int, p_number text, p_status text default 'review', p_date date default '1998-10-03') returns void language plpgsql as $$
begin
  insert into public.invoice (id, tenant_id, status, file_path, file_mime, file_size_bytes, supplier_vat, supplier_name, number_raw, invoice_date)
  values (pg_temp.iid(n), '11111111-1111-4111-8111-111111111111', 'review', '11111111-1111-4111-8111-111111111111/1998/' || pg_temp.iid(n) || '.pdf', 'application/pdf', 1000,
          'IT12345678903', 'Fornitore Demo 1', p_number, p_date);
  if p_status <> 'review' then
    update public.invoice set status = p_status::public.invoice_status where id = pg_temp.iid(n);
  end if;
end
$$;
create function pg_temp.path(n int) returns text language sql immutable as $$ select '11111111-1111-4111-8111-111111111111/1998/' || pg_temp.iid(n) || '.xml' $$;
-- A one-line XML body (net 10, VAT 2,20, gross 12,20) for invoice n with the given number and sha.
create function pg_temp.xml(n int, p_sha text, p_number text, p_date text default '1998-10-03') returns jsonb language sql as $$
  select jsonb_build_object('sha256', repeat(p_sha, 64), 'format', 'FPR12', 'bodyCount', 1, 'buyer', jsonb_build_object('vat', 'IT00000000000', 'cf', null),
    'invoices', jsonb_build_array(jsonb_build_object('id', pg_temp.iid(n), 'filePath', pg_temp.path(n), 'fileMime', 'application/xml', 'fileSizeBytes', 1200,
      'originalFilename', null, 'bodyIndex', 1, 'documentType', 'TD01', 'notes', jsonb_build_array(),
      'header', jsonb_build_object('supplierVat', 'IT12345678903', 'supplierName', 'Fornitore Demo 1', 'numberRaw', p_number, 'invoiceDate', p_date, 'dueDate', null,
                                   'netTotal', '10.00', 'vatTotal', '2.20', 'grossTotal', '12.20'),
      'lines', jsonb_build_array(jsonb_build_object('rawDescription', 'Manzo fesa', 'supplierCode', 'ART-1', 'qty', '1.0000', 'unitRaw', 'kg', 'unitPrice', '10.0000',
                                                    'lineAmount', '10.0000', 'vatRate', '22.00', 'vatNature', null, 'xmlDetails', null)),
      'vatSummary', jsonb_build_array(jsonb_build_object('vatRate', '22.00', 'vatNature', null, 'taxable', '10.00', 'tax', '2.20', 'rounding', null,
                                                         'accessoryCosts', null, 'vatChargeability', null, 'legalReference', null)))))
$$;
create temp table pay (k text primary key, p jsonb not null);
grant select on pay to authenticated;
create function pg_temp.imp(p_key text) returns text language sql as $$
  select pg_temp.err(format('select public.import_xml_invoices((select p from pg_temp.pay where k = %L))', p_key)) $$;
create function pg_temp.replace_(p_xml int, p_other int) returns text language sql as $$
  select pg_temp.err(format('select public.review_replace_with_xml(%L, %L)', pg_temp.iid(p_xml), pg_temp.iid(p_other))) $$;
grant execute on function pg_temp.iid(int), pg_temp.path(int), pg_temp.imp(text), pg_temp.replace_(int, int) to authenticated;
create function pg_temp.obj(n int) returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata) values ('invoices', pg_temp.path(n), jsonb_build_object('size', 1200, 'mimetype', 'application/xml')) $$;

select pg_temp.obj(n) from generate_series(1, 30) n;
-- Photos and PDFs: 101 in review (FT 12), 102 approved (FT 13), 103 in review (ft14, another spelling), 104 and 105 in review with the same key (FT 16), 106 in review (FT 17).
select pg_temp.photo(101, 'FT 12');
select pg_temp.photo(102, 'FT 13', 'approved');
select pg_temp.photo(103, 'ft14');
select pg_temp.photo(104, 'FT 16');
select pg_temp.photo(105, 'FT 16');
select pg_temp.photo(106, 'FT 17');
-- Each XML file is one row of the payload table.
insert into pay values
  ('x1', pg_temp.xml(1, '1', 'FT 12')),
  ('x2', pg_temp.xml(2, '2', 'FT 13')),
  ('x3', pg_temp.xml(3, '3', 'FT 14')),
  ('x4', pg_temp.xml(4, '4', 'FT 15')),
  ('x5', pg_temp.xml(5, '5', 'FT 15')),
  ('x6', pg_temp.xml(6, '6', 'FT 16')),
  ('x7', pg_temp.xml(7, '7', 'FT 17')),
  ('x8', pg_temp.xml(8, '8', 'FT 18'));

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

-- 1. Import against what is already there -----------------------------------------------------------------------------------------------------------------------
select is(pg_temp.imp('x1'), 'ok', 'an XML file with the key of a photo in review imports');
select is((select i.status::text || ' ' || i.duplicate_of from public.invoice i where i.id = pg_temp.iid(1)), 'duplicate ' || pg_temp.iid(101), 'as a duplicate of that photo');
select is(pg_temp.imp('x2'), 'ok', 'an XML file with the key of an approved photo imports');
select is((select i.status::text || ' ' || i.duplicate_of from public.invoice i where i.id = pg_temp.iid(2)), 'duplicate ' || pg_temp.iid(102), 'as a duplicate of the approved one');
select is(pg_temp.imp('x3'), 'ok', 'FT 14 against ft14 imports');
select is((select i.status::text || ' ' || i.duplicate_of from public.invoice i where i.id = pg_temp.iid(3)), 'duplicate ' || pg_temp.iid(103), 'and the normalised number makes it a duplicate');
select is(pg_temp.imp('x4'), 'ok', 'an XML file with a key nobody has imports');
select is((select i.status::text from public.invoice i where i.id = pg_temp.iid(4)), 'review', 'into review');
select is(pg_temp.imp('x5'), 'ok', 'a second XML file (another sha256) with the same key imports');
select is((select i.status::text || ' ' || i.duplicate_of from public.invoice i where i.id = pg_temp.iid(5)), 'duplicate ' || pg_temp.iid(4), 'as a duplicate of the first XML invoice');

-- 2. A PDF extracted after an XML invoice --------------------------------------------------------------------------------------------------------------------------
reset role;
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, attempts, extraction_started_at, claim_token)
  values (pg_temp.iid(107), '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/1998/' || pg_temp.iid(107) || '.pdf', 'application/pdf', 1000, 'extracting', 1, now(),
          '99999999-0000-4000-8000-000000000107');
set local role service_role;
select is((select public.extraction_complete(pg_temp.iid(107), '99999999-0000-4000-8000-000000000107', jsonb_build_object(
    'header', jsonb_build_object('supplier_vat', 'IT12345678903', 'supplier_name', 'Fornitore Demo 1', 'number_raw', 'FT 15', 'invoice_date', '1998-10-03', 'due_date', '1998-11-02',
                                 'payment_terms', '30 gg', 'net_total', 10, 'vat_total', 2.2, 'gross_total', 12.2),
    'lines', '[]'::jsonb, 'gate_flags', '[]'::jsonb, 'totals_diff', 0, 'field_confidence', '{}'::jsonb, 'extraction_json', '{}'::jsonb), 'test-model')::text),
  'duplicate', 'the extraction of a PDF with the key of an XML invoice (FT 15) answers duplicate');
reset role;
select is((select i.duplicate_of from public.invoice i where i.id = pg_temp.iid(107)), pg_temp.iid(4), 'of the XML invoice');

-- 3. Replace --------------------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select count(*)::int from pg_proc where oid = 'public.review_replace_with_xml(uuid, uuid)'::regprocedure and prosecdef and proconfig = array['search_path=""']), 1, 'review_replace_with_xml is a security definer with an empty search_path');
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.review_replace_with_xml(uuid, uuid)', 'execute')), array['authenticated'], 'executable by authenticated only');
-- The XML copy of FT 12 (invoice 1) is a duplicate of the photo 101: replace the photo.
select is(pg_temp.replace_(1, 101), 'ok', 'the owner replaces the photo by its XML copy');
select is((select i.status::text from public.invoice i where i.id = pg_temp.iid(101)), 'rejected', 'the photo is rejected');
select is((select a.reason from public.audit_event a where a.entity_id = pg_temp.iid(101) and a.action = 'invoice.rejected'), 'Sostituita dal file XML', 'with the reason "Sostituita dal file XML"');
select is((select i.status::text || ' ' || coalesce(i.duplicate_of::text, 'null') from public.invoice i where i.id = pg_temp.iid(1)), 'review null', 'the XML invoice is in review, no longer a duplicate');
select is((select a.after from public.audit_event a where a.entity_id = pg_temp.iid(1) and a.action = 'invoice.replaced_by_xml'), jsonb_build_object('other', pg_temp.iid(101)), 'and the audit row invoice.replaced_by_xml names the other');
select is(pg_temp.replace_(1, 101), 'P0001:replace_not_allowed', 'a second call is refused (the XML invoice is in review now)');
select is((select count(*)::int from public.audit_event a where a.entity_id = pg_temp.iid(101) and a.action = 'invoice.rejected'), 1, 'and exactly one rejection row exists');
select is((select count(*)::int from public.audit_event a where a.entity_id = pg_temp.iid(1) and a.action = 'invoice.replaced_by_xml'), 1, 'and exactly one replacement row');

-- The same call on an invoice that is no longer a duplicate of anything, with the other already rejected: nothing written twice.
select is(pg_temp.replace_(3, 101), 'P0001:replace_not_allowed', 'the other is rejected already: refused');

-- A third live look-alike keeps the XML invoice a duplicate: invoice 6 (FT 16) is a duplicate of photo 104; photo 105 is another live photo with the key.
select is(pg_temp.imp('x6'), 'ok', 'an XML file with the key of two photos in review imports');
select is((select i.status::text || ' ' || i.duplicate_of from public.invoice i where i.id = pg_temp.iid(6)), 'duplicate ' || pg_temp.iid(104), 'as a duplicate of the first one');
select is(pg_temp.replace_(6, 104), 'ok', 'replacing the first photo works');
select is((select i.status::text || ' ' || i.duplicate_of from public.invoice i where i.id = pg_temp.iid(6)), 'duplicate ' || pg_temp.iid(105), 'and the XML invoice stays a duplicate, now of the other live photo');
select is((select i.status::text from public.invoice i where i.id = pg_temp.iid(104)), 'rejected', 'the first photo is rejected');
select is(pg_temp.replace_(6, 105), 'ok', 'replacing the second photo too');
select is((select i.status::text || ' ' || coalesce(i.duplicate_of::text, 'null') from public.invoice i where i.id = pg_temp.iid(6)), 'review null', 'the XML invoice is in review once no look-alike is left');

-- Refusals --------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.replace_(2, 102), 'P0001:replace_not_allowed', 'the photo is approved: no replace');
select is((select i.status::text from public.invoice i where i.id = pg_temp.iid(102)), 'approved', 'and the approved photo is untouched');
select is(pg_temp.replace_(5, 4), 'P0001:replace_not_allowed', 'the other is an XML invoice: no replace');
select is(pg_temp.replace_(4, 106), 'P0001:replace_not_allowed', 'the XML invoice is in review (not a duplicate): no replace');
select is(pg_temp.imp('x7'), 'ok', 'an XML file with the key of photo 106 (FT 17) imports');
select is(pg_temp.replace_(7, 103), 'P0001:replace_not_allowed', 'a photo that is not a look-alike of the XML invoice: no replace');
select is(pg_temp.replace_(7, 7), 'P0001:replace_not_allowed', 'an invoice cannot replace itself');
select is((select i.status::text from public.invoice i where i.id = pg_temp.iid(103)), 'review', 'the unrelated photo is untouched');
-- A pair the owner declared "not a duplicate" is not a look-alike any more.
select public.review_clear_duplicate(pg_temp.iid(7), pg_temp.iid(106));
select is(pg_temp.replace_(7, 106), 'P0001:replace_not_allowed', 'a declared "not a duplicate" pair cannot be replaced');
select is((select i.status::text from public.invoice i where i.id = pg_temp.iid(106)), 'review', 'and the photo stays in review');

-- Unknown ids and another tenant ----------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err(format('select public.review_replace_with_xml(%L, %L)', gen_random_uuid(), pg_temp.iid(106))), 'P0002:not_found', 'an unknown XML id is not_found');
select is(pg_temp.err(format('select public.review_replace_with_xml(%L, %L)', pg_temp.iid(7), gen_random_uuid())), 'P0002:not_found', 'an unknown other id is not_found');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.replace_(7, 106), 'P0002:not_found', 'owner B with tenant A''s ids: not_found');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.replace_(7, 106), '42501:insufficient_privilege', 'the chef cannot replace');
reset role;

-- 4. The supplier memory is applied again on replace ---------------------------------------------------------------------------------------------------------------
-- File 8 (FT 18) is imported while its supplier is unknown to the tenant; the photo 108 with the same key is in review. After the supplier and its article exist,
-- the replacement links the supplier and maps the line (automap runs again).
select pg_temp.photo(108, 'FT 18');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.imp('x8'), 'ok', 'a file of an unknown supplier imports');
reset role;
select is((select i.supplier_id is null and i.status = 'duplicate' from public.invoice i where i.id = pg_temp.iid(8)), true, 'with no supplier linked, as a duplicate of the photo');
insert into public.ingredient (id, tenant_id, name, base_unit, is_active) values ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg', true);
insert into public.supplier (id, tenant_id, name, vat_number, is_active) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo 1', 'IT12345678903', true);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit, invoice_unit, is_active)
  values ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'ART-1', 1, 'kg', 'kg', true);
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.replace_(8, 108), 'ok', 'the replacement runs');
reset role;
select is((select i.supplier_id from public.invoice i where i.id = pg_temp.iid(8)), '5a000000-0000-4000-8000-00000000005a'::uuid, 'the supplier is linked by its VAT number');
select is((select l.ingredient_id from public.invoice_line l where l.invoice_id = pg_temp.iid(8) and l.position = 1), '1a000000-0000-4000-8000-00000000001a'::uuid, 'and the line is mapped by the article code of the file');

select * from finish();
rollback;
