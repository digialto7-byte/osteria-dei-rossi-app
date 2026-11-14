-- P2-7 S1 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.2, 5 S1): the XML columns and constraints on invoice and invoice_line.
-- An invoice read from a FatturaPA file carries its document type, format, the sha256 of the unwrapped XML, its body index and count and the notes of
-- what Costi ignored; the five metadata columns are all null (a photo or PDF) or all set (an XML file). The file path and MIME constraints accept
-- .xml / application/xml and .p7m / application/pkcs7-mime next to the three existing kinds. The same file (sha256 + body) cannot be live twice in
-- a tenant; the XML columns never change after insert, for any role. Lines gain the VAT nature and a bounded jsonb of XML details.
-- Fake data only: tenants "Osteria Demo A/B", fixture ids, 1998 dates. The rows are written as the table owner, like the definers of S4 will.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- One invoice row: n picks the id and the path (<tenant>/1998/<id>.<ext>); the XML columns are given as they are.
create function pg_temp.ins(n int, p_tenant uuid, p_ext text, p_mime text, p_doc text, p_fmt text, p_sha text, p_idx int, p_cnt int)
  returns void language sql as $$
  insert into public.invoice (id, tenant_id, status, file_path, file_mime, file_size_bytes, document_type, xml_format, xml_sha256, xml_body_index, xml_body_count)
  values (pg_temp.iid(n), p_tenant, 'review', p_tenant || '/1998/' || pg_temp.iid(n) || '.' || p_ext, p_mime, 1200, p_doc, p_fmt, p_sha, p_idx, p_cnt)
$$;
create function pg_temp.sha(c text) returns text language sql immutable as $$ select repeat(c, 64) $$;

-- 1. The columns exist, with the right types ------------------------------------------------------------------------------------------------------------
select has_column('public', 'invoice', 'document_type', 'invoice.document_type exists');
select has_column('public', 'invoice', 'xml_format', 'invoice.xml_format exists');
select has_column('public', 'invoice', 'xml_sha256', 'invoice.xml_sha256 exists');
select has_column('public', 'invoice', 'xml_body_index', 'invoice.xml_body_index exists');
select has_column('public', 'invoice', 'xml_body_count', 'invoice.xml_body_count exists');
select col_not_null('public', 'invoice', 'xml_notes', 'xml_notes is not null');
select col_default_is('public', 'invoice', 'xml_notes', '{}', 'and defaults to the empty array');
select has_column('public', 'invoice_line', 'vat_nature', 'invoice_line.vat_nature exists');
select has_column('public', 'invoice_line', 'xml_details', 'invoice_line.xml_details exists');

-- 2. Valid files and the three existing kinds -----------------------------------------------------------------------------------------------------------
select lives_ok($$ select pg_temp.ins(1, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('a'), 1, 1) $$,
  'a .xml file with application/xml and the full XML metadata is accepted');
select lives_ok($$ select pg_temp.ins(2, '11111111-1111-4111-8111-111111111111', 'p7m', 'application/pkcs7-mime', 'TD24', 'FPA12', pg_temp.sha('b'), 2, 3) $$,
  'a .p7m file with application/pkcs7-mime, body 2 of 3, TD24 and FPA12 is accepted');
select lives_ok($$ select pg_temp.ins(3, '11111111-1111-4111-8111-111111111111', 'pdf', 'application/pdf', null, null, null, null, null) $$,
  'a PDF with no XML metadata is still valid');
select lives_ok($$ select pg_temp.ins(4, '11111111-1111-4111-8111-111111111111', 'jpg', 'image/jpeg', null, null, null, null, null) $$,
  'a JPEG photo is still valid');
select lives_ok($$ select pg_temp.ins(5, '11111111-1111-4111-8111-111111111111', 'png', 'image/png', null, null, null, null, null) $$,
  'a PNG photo is still valid');
select lives_ok($$ select pg_temp.ins(6, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD25', 'FPR12', pg_temp.sha('c'), 10, 10) $$,
  'body 10 of 10 is accepted (the ceiling)');

-- 3. The file path and MIME constraints -----------------------------------------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.ins(11, '11111111-1111-4111-8111-111111111111', 'xml', 'application/pdf', null, null, null, null, null) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_file_mime_ck"', 'a .xml path with application/pdf is refused');
select throws_ok($$ select pg_temp.ins(12, '11111111-1111-4111-8111-111111111111', 'p7m', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('d'), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_file_mime_ck"', 'a .p7m path with application/xml is refused');
select throws_ok($$ select pg_temp.ins(13, '11111111-1111-4111-8111-111111111111', 'pdf', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('d'), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_file_mime_ck"', 'a .pdf path with application/xml is refused');
select throws_ok($$ select pg_temp.ins(14, '11111111-1111-4111-8111-111111111111', 'p7m.xml', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('d'), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_file_path_ck"', 'a .p7m.xml path is refused');
select throws_ok($$ select pg_temp.ins(15, '11111111-1111-4111-8111-111111111111', 'xml.p7m', 'application/pkcs7-mime', 'TD01', 'FPR12', pg_temp.sha('d'), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_file_path_ck"', 'a .xml.p7m path is refused (the stored name carries one extension)');
select throws_ok($$ select pg_temp.ins(16, '11111111-1111-4111-8111-111111111111', 'XML', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('d'), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_file_mime_ck"', 'an upper-case .XML path is refused');
select throws_ok($$ select pg_temp.ins(17, '11111111-1111-4111-8111-111111111111', 'exe', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('d'), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_file_mime_ck"', 'an unknown extension is still refused');

-- 4. The XML metadata: all or nothing, and the allowed values -------------------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.ins(21, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('e'), 1, null) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_meta_ck"', 'metadata with the body count missing is refused');
select throws_ok($$ select pg_temp.ins(22, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', null, pg_temp.sha('e'), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_meta_ck"', 'metadata with the format missing is refused');
select throws_ok($$ select pg_temp.ins(23, '11111111-1111-4111-8111-111111111111', 'pdf', 'application/pdf', null, 'FPR12', null, null, null) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_meta_ck"', 'a PDF carrying only a format is refused');
select throws_ok($$ select pg_temp.ins(24, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', null, null, null, null, null) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_mime_ck"', 'an XML file without a document type is refused');
select throws_ok($$ select pg_temp.ins(25, '11111111-1111-4111-8111-111111111111', 'pdf', 'application/pdf', 'TD01', 'FPR12', pg_temp.sha('e'), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_mime_ck"', 'a PDF with a document type is refused');
select throws_ok($$ select pg_temp.ins(26, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD04', 'FPR12', pg_temp.sha('e'), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_document_type_ck"', 'a credit note (TD04) is refused');
select throws_ok($$ select pg_temp.ins(27, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FSM10', pg_temp.sha('e'), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_format_ck"', 'a simplified-invoice format is refused');
select throws_ok($$ select pg_temp.ins(28, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FPR12', repeat('A', 64), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_sha256_ck"', 'an upper-case sha256 is refused');
select throws_ok($$ select pg_temp.ins(29, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FPR12', repeat('a', 63), 1, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_sha256_ck"', 'a 63-character sha256 is refused');
select throws_ok($$ select pg_temp.ins(30, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('e'), 0, 1) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_body_ck"', 'body index 0 is refused');
select throws_ok($$ select pg_temp.ins(31, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('e'), 3, 2) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_body_ck"', 'body index above the count is refused');
select throws_ok($$ select pg_temp.ins(32, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('e'), 1, 11) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_body_ck"', 'a body count of 11 is refused');
select throws_ok($$ insert into public.invoice (id, tenant_id, status, file_path, file_mime, file_size_bytes, xml_notes)
                    values (pg_temp.iid(33), '11111111-1111-4111-8111-111111111111', 'review',
                            '11111111-1111-4111-8111-111111111111/1998/' || pg_temp.iid(33) || '.pdf', 'application/pdf', 100, array['made_up_note']) $$,
  '23514', 'new row for relation "invoice" violates check constraint "invoice_xml_notes_ck"', 'a note outside the list is refused');

-- 5. The XML columns never change -----------------------------------------------------------------------------------------------------------------------
select throws_ok($$ update public.invoice set xml_sha256 = pg_temp.sha('f') where id = pg_temp.iid(1) $$,
  'P0001', 'invoice_immutable', 'the sha256 cannot be updated');
select throws_ok($$ update public.invoice set document_type = 'TD24' where id = pg_temp.iid(1) $$,
  'P0001', 'invoice_immutable', 'the document type cannot be updated');
select throws_ok($$ update public.invoice set xml_body_count = 2 where id = pg_temp.iid(1) $$,
  'P0001', 'invoice_immutable', 'the body count cannot be updated');
select throws_ok($$ update public.invoice set xml_notes = array['stamp_duty'] where id = pg_temp.iid(1) $$,
  'P0001', 'invoice_immutable', 'the notes cannot be updated');
select throws_ok($$ update public.invoice set document_type = 'TD01', xml_format = 'FPR12', xml_sha256 = pg_temp.sha('9'), xml_body_index = 1, xml_body_count = 1
                     where id = pg_temp.iid(3) $$,
  'P0001', 'invoice_immutable', 'a PDF row cannot be turned into an XML one');
select lives_ok($$ update public.invoice set xml_sha256 = xml_sha256, status = 'rejected' where id = pg_temp.iid(1) $$,
  'writing the same value back, with another column changing, is fine');
set local role service_role;
select throws_ok($$ update public.invoice set xml_sha256 = pg_temp.sha('f') where id = pg_temp.iid(2) $$,
  'P0001', 'invoice_immutable', 'the sha256 cannot be updated by the service role either');
reset role;

-- 6. One live row per file ------------------------------------------------------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.ins(41, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('b'), 2, 3) $$,
  '23505', 'duplicate key value violates unique constraint "invoice_xml_file_uq"', 'the same tenant, sha256 and body index is refused while the first is live');
select lives_ok($$ select pg_temp.ins(42, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('b'), 3, 3) $$,
  'another body of the same file is a different key');
select lives_ok($$ select pg_temp.ins(43, '11111111-1111-4111-8111-111111111111', 'xml', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('a'), 1, 1) $$,
  'the same file is allowed again once the first copy is rejected (invoice 1 was rejected above)');
select lives_ok($$ select pg_temp.ins(44, '22222222-2222-4222-8222-222222222222', 'xml', 'application/xml', 'TD01', 'FPR12', pg_temp.sha('b'), 2, 3) $$,
  'tenant B may hold the same sha256 and body');

-- 7. The lines ------------------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.line(p_pos int, p_nature text, p_details jsonb) returns void language sql as $$
  insert into public.invoice_line (tenant_id, invoice_id, position, raw_description, qty, line_amount, vat_rate, vat_nature, xml_details, field_confidence, extracted)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.iid(2), p_pos, 'Riga demo', 1, 10, case when p_nature is null then 22 else 0 end, p_nature, p_details, '{}', '{}')
$$;
select lives_ok($$ select pg_temp.line(1, 'N2.1', '{"lineNumber": 1, "codes": []}') $$, 'a line with the nature N2.1 and an object of details is accepted');
select lives_ok($$ select pg_temp.line(2, null, null) $$, 'a line without nature and details is accepted (every existing line)');
select throws_ok($$ select pg_temp.line(3, 'N2', null) $$,
  '23514', 'new row for relation "invoice_line" violates check constraint "invoice_line_vat_nature_ck"', 'the generic nature N2 (not in the list) is refused');
select throws_ok($$ select pg_temp.line(4, 'N2.1', '[1, 2]') $$,
  '23514', 'new row for relation "invoice_line" violates check constraint "invoice_line_xml_details_ck"', 'details that are an array are refused');
select throws_ok($$ select pg_temp.line(5, 'N2.1', jsonb_build_object('text', repeat('x', 20000))) $$,
  '23514', 'new row for relation "invoice_line" violates check constraint "invoice_line_xml_details_ck"', 'details over 16 KB are refused');

-- 8. No grant widened -----------------------------------------------------------------------------------------------------------------------------------
select ok(not has_column_privilege('authenticated', 'public.invoice', 'document_type', 'insert')
      and not has_column_privilege('authenticated', 'public.invoice', 'xml_sha256', 'insert')
      and not has_column_privilege('authenticated', 'public.invoice', 'xml_notes', 'update'),
  'authenticated cannot write the XML columns (the M2 column insert grant is unchanged)');
select ok(has_column_privilege('authenticated', 'public.invoice', 'xml_sha256', 'select')
      and has_column_privilege('authenticated', 'public.invoice_line', 'xml_details', 'select'),
  'authenticated reads them through the existing select grant and RLS');
select ok(not has_table_privilege('anon', 'public.invoice', 'select'), 'anon still reads nothing');

select * from finish();
rollback;
