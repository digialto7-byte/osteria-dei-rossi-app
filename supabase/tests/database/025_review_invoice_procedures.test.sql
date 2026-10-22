-- M4 step 7: review_set_supplier, review_update_header, review_clear_duplicate, retry_extraction
-- (plan §3.2). Acts as owner A unless stated. Each is one transaction and writes only the tables
-- named in its test; no invoice is ever approved.
begin;
create extension if not exists pgtap with schema extensions;
select plan(127);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
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
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A');

insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Vitello', 'kg');
-- SA: the supplier the invoices print. SB2: another supplier with another VAT. SC: inactive.
insert into public.supplier (id, tenant_id, name, vat_number, is_active) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903', true),
  ('5b000000-0000-4000-8000-00000000005b', '11111111-1111-4111-8111-111111111111',
   'Altro Fornitore', 'IT00000000018', true),
  ('5c000000-0000-4000-8000-00000000005c', '11111111-1111-4111-8111-111111111111',
   'Fornitore Inattivo', 'IT00000000026', false),
  ('5d000000-0000-4000-8000-00000000005d', '11111111-1111-4111-8111-111111111111',
   'Senza Partita Iva', null, true),
  ('5e000000-0000-4000-8000-00000000005e', '22222222-2222-4222-8222-222222222222',
   'Fornitore Demo Srl', 'IT12345678903', true);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty,
    pack_unit, invoice_unit) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 'kg', 'kg'),
  ('52000000-0000-4000-8000-000000000052', '11111111-1111-4111-8111-111111111111',
   '5b000000-0000-4000-8000-00000000005b', '1b000000-0000-4000-8000-00000000001b', 'MAN-1', 1, 'kg', 'kg');

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$
  select ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- An invoice with the extraction it was read from (extraction_json), so header corrections can be
-- measured against it. Lines 10.00 + 20.00, VAT 3.00, gross 33.00 unless told otherwise.
create function pg_temp.mk_invoice(n int, p_status public.invoice_status default 'review',
    p_vat text default 'IT12345678903', p_number text default null,
    p_date date default '2026-10-15', p_supplier uuid default null, p_gross numeric default 33,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111', p_dup_of uuid default null,
    p_override boolean default false, p_warn uuid default null, p_attempts int default 0,
    p_error text default null) returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total,
      gross_total, totals_diff, supplier_id, duplicate_of, duplicate_override, duplicate_warning_of,
      attempts, extraction_error, next_attempt_at, extraction_json)
  values (pg_temp.iid(n), p_tenant, p_tenant || '/2026/' || pg_temp.iid(n) || '.pdf',
      'application/pdf', 100, p_status, p_vat, 'Fornitore Demo Srl', coalesce(p_number, 'FT ' || n),
      p_date, '2026-11-15',
      30, 3, p_gross, 0, p_supplier, p_dup_of, p_override, p_warn, p_attempts, p_error,
      case when p_error is not null then now() + interval '1 hour' end,
      jsonb_build_object('supplier_vat', p_vat, 'supplier_name', 'Fornitore Demo Srl',
        'invoice_number', coalesce(p_number, 'FT ' || n), 'invoice_date', p_date,
        'due_date', '2026-11-15',
        'net_total', 30, 'vat_total', 3, 'gross_total', p_gross))
$$;
create function pg_temp.mk_line(n int, inv int, pos int, p_code text, p_amount numeric,
    p_extra text default '', p_vals text default '',
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
begin
  execute format($q$
    insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description,
        supplier_code, qty, unit_price, line_amount, vat_rate, unit, suggested_unit, field_confidence,
        extracted %s)
    values (%L, %L, %L, %s, 'Prodotto', %L, 1, %s, %s, 10, 'kg', 'kg', '{}',
        jsonb_build_object('qty', 1, 'unit_price', %s, 'line_amount', %s, 'vat_rate', 10,
          'supplier_code', %L::text, 'lot_code', null, 'expiry', null) %s)$q$,
    case when p_extra = '' then '' else ', ' || p_extra end, pg_temp.lid(n), p_tenant,
    pg_temp.iid(inv), pos, p_code, p_amount, p_amount, p_amount, p_amount, p_code,
    case when p_vals = '' then '' else ', ' || p_vals end);
end
$$;

-- Inventory of fixtures.
-- 1 link SA (same VAT as printed)       2 create a supplier         3 create with an existing VAT
-- 4 link SB2 (other VAT, duplicate)     5 relink SA -> SB2          6 buyer's VAT: nothing extracted
-- 7 argument errors                     9 live invoice of SB2's VAT 11 live invoice FT 77
-- 10 header: gross                      12 header: number           13 header: override
-- 14 header: date                       15 header: shape            16 duplicate invoice (not editable)
-- 20 duplicate to clear                 21 warning to clear         22 clean   23 approved
-- 30 failed (attempts 3)                31 review                   40 tenant B
select pg_temp.mk_invoice(1, p_warn => null);
update public.invoice set supplier_suggestion_id = '5d000000-0000-4000-8000-00000000005d'
  where id = pg_temp.iid(1);
select pg_temp.mk_invoice(2, p_vat => 'IT00000000034');
select pg_temp.mk_invoice(3);
select pg_temp.mk_invoice(4);
select pg_temp.mk_invoice(5, p_supplier => '5a000000-0000-4000-8000-00000000005a');
select pg_temp.mk_invoice(6, p_vat => null);
select pg_temp.mk_invoice(7);
select pg_temp.mk_invoice(9, p_vat => 'IT00000000018', p_number => 'FT 4');
select pg_temp.mk_invoice(10);
select pg_temp.mk_invoice(11, p_vat => 'IT12345678903', p_number => 'FT 77');
select pg_temp.mk_invoice(12);
select pg_temp.mk_invoice(13, p_override => true);
select pg_temp.mk_invoice(14, p_number => 'FT 77', p_date => '2026-10-16');
select pg_temp.mk_invoice(15);
select pg_temp.mk_invoice(16, 'duplicate', p_dup_of => pg_temp.iid(11));
select pg_temp.mk_invoice(20, 'duplicate', p_dup_of => pg_temp.iid(11));
select pg_temp.mk_invoice(21, p_warn => pg_temp.iid(11));
select pg_temp.mk_invoice(22);
select pg_temp.mk_invoice(23, 'approved');
select pg_temp.mk_invoice(30, 'extraction_failed', p_attempts => 3, p_error => 'schema_invalid');
select pg_temp.mk_invoice(31);
select pg_temp.mk_invoice(40, p_tenant => '22222222-2222-4222-8222-222222222222');
-- Every invoice has its own number (FT <n>), so none is a duplicate of another by accident.
-- Invoice 9 shares VAT, number (FT 4) and date with what invoice 4 becomes after linking SB2.

-- Lines: two on each invoice that needs a gate (10.00 + 20.00), codes MAN-1 and ZZ-1.
select pg_temp.mk_line(101, 1, 1, 'MAN-1', 10);   select pg_temp.mk_line(102, 1, 2, 'ZZ-1', 20);
select pg_temp.mk_line(201, 2, 1, 'MAN-1', 10);   select pg_temp.mk_line(202, 2, 2, 'ZZ-1', 20);
select pg_temp.mk_line(401, 4, 1, 'MAN-1', 10);   select pg_temp.mk_line(402, 4, 2, 'ZZ-1', 20);
select pg_temp.mk_line(601, 6, 1, 'MAN-1', 10);   select pg_temp.mk_line(602, 6, 2, 'ZZ-1', 20);
select pg_temp.mk_line(1001, 10, 1, 'MAN-1', 10); select pg_temp.mk_line(1002, 10, 2, 'ZZ-1', 20);
-- Invoice 5: line 501 auto-mapped through SA's item with a corrected pack; 502 mapped by hand.
select pg_temp.mk_line(501, 5, 1, 'MAN-1', 10,
  'ingredient_id, supplier_item_id, suggested_ingredient_id, suggested_supplier_item_id, mapping_source, pack_corrected, corrected_fields',
  $$'1a000000-0000-4000-8000-00000000001a', '51000000-0000-4000-8000-000000000051',
    '1a000000-0000-4000-8000-00000000001a', '51000000-0000-4000-8000-000000000051', 'auto', true,
    '{pack}'$$);
select pg_temp.mk_line(502, 5, 2, 'ZZ-1', 20, 'ingredient_id, supplier_item_id, mapping_source',
  $$'1a000000-0000-4000-8000-00000000001a', '51000000-0000-4000-8000-000000000051', 'manual'$$);
-- Units at the time of the re-link (round 2). All start as unit = suggested_unit 'kg', which is what
-- the old supplier's article filled in.
--   503 untouched: the unit came from the old supplier's memory and must go.
--   504 the reviewer changed the unit to 'g' (it differs from the suggestion): kept.
--   506 untouched, printed unit 'g': the unit is read again from the print.
select pg_temp.mk_line(503, 5, 3, 'ZZ-9', 5);
select pg_temp.mk_line(504, 5, 4, 'ZZ-8', 5);
update public.invoice_line set unit = 'g' where id = pg_temp.lid(504);
-- 505 the reviewer cleared the unit and typed 'kg' again (the same as the suggestion): kept.
select pg_temp.mk_line(505, 5, 5, 'ZZ-6', 5);
update public.invoice_line set unit_decided_at = now() where id = pg_temp.lid(505);
select pg_temp.mk_line(506, 5, 6, 'ZZ-7', 5);
update public.invoice_line set unit_raw = 'g' where id = pg_temp.lid(506);

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
create function pg_temp.link(p_inv int, p_supplier uuid, p_new text default null) returns text
  language sql as $$
  select pg_temp.err(format('select public.review_set_supplier(%L, %L, %L::jsonb)', pg_temp.iid(p_inv),
    p_supplier, p_new)) $$;
create function pg_temp.header(p_inv int, p_patch text) returns text language sql as $$
  select pg_temp.err(format('select public.review_update_header(%L, %L::jsonb)', pg_temp.iid(p_inv), p_patch)) $$;
create function pg_temp.clear(p_inv int) returns text language sql as $$
  select pg_temp.err(format('select public.review_clear_duplicate(%L)', pg_temp.iid(p_inv))) $$;
create function pg_temp.retry(p_inv int) returns text language sql as $$
  select pg_temp.err(format('select public.retry_extraction(%L)', pg_temp.iid(p_inv))) $$;
create function pg_temp.inv(n int) returns public.invoice language sql as $$
  select i from public.invoice i where i.id = pg_temp.iid(n) $$;
create function pg_temp.line(n int) returns public.invoice_line language sql as $$
  select l from public.invoice_line l where l.id = pg_temp.lid(n) $$;
create temporary table xact_snapshot as
  select relname::text as relname, n_tup_ins + n_tup_upd + n_tup_del as writes
    from pg_stat_xact_user_tables where schemaname = 'public';
create function pg_temp.snapshot() returns void language sql as $$
  with gone as (delete from xact_snapshot)
  insert into xact_snapshot
    select relname::text, n_tup_ins + n_tup_upd + n_tup_del
      from pg_stat_xact_user_tables where schemaname = 'public' $$;
create function pg_temp.written_since_snapshot() returns text[] language sql as $$
  select coalesce(array_agg(t.relname::text order by t.relname), '{}')
    from pg_stat_xact_user_tables t
    left join xact_snapshot s on s.relname = t.relname::text
   where t.schemaname = 'public' and t.n_tup_ins + t.n_tup_upd + t.n_tup_del > coalesce(s.writes, 0) $$;
grant select, insert, delete on xact_snapshot to authenticated;
grant execute on function pg_temp.iid(int), pg_temp.lid(int), pg_temp.act_as(uuid, uuid, text),
  pg_temp.err(text), pg_temp.link(int, uuid, text), pg_temp.header(int, text), pg_temp.clear(int),
  pg_temp.retry(int), pg_temp.inv(int), pg_temp.line(int), pg_temp.snapshot(),
  pg_temp.written_since_snapshot() to authenticated;

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

select ok(
  (select bool_and(has_function_privilege('authenticated', f, 'execute')
                   and not has_function_privilege('anon', f, 'execute')
                   and not has_function_privilege('service_role', f, 'execute'))
     from unnest(array[
       'public.review_set_supplier(uuid, uuid, jsonb)', 'public.review_update_header(uuid, jsonb)',
       'public.review_clear_duplicate(uuid)', 'public.retry_extraction(uuid)']) f),
  'only authenticated can call the invoice procedures');

-- Supplier: link an existing one.
select pg_temp.snapshot();
select is(pg_temp.link(1, '5a000000-0000-4000-8000-00000000005a'), 'ok', 'an existing supplier is linked');
select ok(pg_temp.written_since_snapshot() <@ array['invoice', 'invoice_line'],
  'linking writes only invoice and invoice_line');
select is((pg_temp.inv(1)).supplier_id, '5a000000-0000-4000-8000-00000000005a'::uuid, 'the invoice is linked');
select is((pg_temp.inv(1)).supplier_suggestion_id, null, 'and the suggestion is cleared');
select is((pg_temp.inv(1)).status, 'review'::public.invoice_status, 'the invoice stays in review');
select is((pg_temp.line(101)).mapping_source, 'auto', 'auto-mapping runs: the coded line is mapped through the remembered article');
select is((pg_temp.line(101)).ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid, 'to the right ingredient');
select is((pg_temp.line(101)).corrected, false, 'without a correction');
select is((pg_temp.line(102)).ingredient_id, null, 'an unknown code stays unmapped');
select is((pg_temp.inv(1)).header_corrected_fields, '{}', 'the printed VAT matched, so nothing is corrected');
select is(pg_temp.link(1, '5a000000-0000-4000-8000-00000000005a'), 'ok', 'linking the same supplier again is fine');
select is((pg_temp.line(101)).mapping_source, 'auto', 'and keeps the mapping');

-- Supplier: create from the extracted data.
select pg_temp.snapshot();
select is(pg_temp.link(2, null, '{"name": "Nuovo Fornitore Srl", "vat_number": "IT00000000034", "payment_terms_days": 30}'),
  'ok', 'a supplier is created from the extracted data');
select ok(pg_temp.written_since_snapshot() <@ array['invoice', 'invoice_line', 'supplier']
      and 'supplier' = any (pg_temp.written_since_snapshot()),
  'creating writes only supplier, invoice and invoice_line');
select is((select name || '/' || vat_number || '/' || payment_terms_days || '/' || is_active || '/' || created_by
             from public.supplier where id = (pg_temp.inv(2)).supplier_id),
  'Nuovo Fornitore Srl/IT00000000034/30/true/a1000000-0000-4000-8000-00000000000a',
  'the supplier is stored with the owner as creator');
select is((select tenant_id from public.supplier where id = (pg_temp.inv(2)).supplier_id),
  '11111111-1111-4111-8111-111111111111'::uuid, 'in the caller''s tenant');
select is((pg_temp.line(201)).ingredient_id, null, 'a new supplier has no remembered articles yet');
select is((pg_temp.inv(2)).status, 'review'::public.invoice_status, 'and the invoice is not approved');

-- Create with a VAT that already exists: one transaction, nothing changes.
select is((select count(*)::int from public.supplier where tenant_id = '11111111-1111-4111-8111-111111111111'), 5,
  'five suppliers in tenant A');
select is(pg_temp.link(3, null, '{"name": "Doppione", "vat_number": "IT12345678903"}'),
  '23505 duplicate key value violates unique constraint "supplier_tenant_vat_uq"',
  'an existing VAT is refused');
select is((select count(*)::int from public.supplier where tenant_id = '11111111-1111-4111-8111-111111111111'), 5,
  'no supplier was inserted');
select is((pg_temp.inv(3)).supplier_id, null, 'and the invoice is still unlinked');
select is(pg_temp.link(3, null, '{"name": "Senza Iva", "vat_number": null, "payment_terms_days": null}'), 'ok',
  'a supplier without a VAT is created');
select is(pg_temp.link(3, null, '{"name": "", "vat_number": null}'),
  '23514 new row for relation "supplier" violates check constraint "supplier_name_check"',
  'an empty name is refused by the table check');

-- Linking a supplier with another VAT than printed copies the VAT and re-checks for a duplicate.
select is(pg_temp.link(4, '5b000000-0000-4000-8000-00000000005b'), 'ok', 'a supplier with another VAT is linked');
select is((pg_temp.inv(4)).supplier_vat, 'IT00000000018', 'the supplier''s VAT is copied to the invoice');
select is((pg_temp.inv(4)).header_corrected_fields, array['supplier_vat'], 'recorded as a header correction');
select is((pg_temp.inv(4)).status, 'duplicate'::public.invoice_status,
  'the duplicate re-check moves it to duplicate (same VAT, number and date as invoice 9)');
select is((pg_temp.inv(4)).duplicate_of, pg_temp.iid(9), 'pointing at the other invoice');
select is((pg_temp.line(401)).mapping_source, 'auto', 'the lines were still auto-mapped');
select is((pg_temp.line(401)).ingredient_id, '1b000000-0000-4000-8000-00000000001b'::uuid, 'through the new supplier''s article');

-- Re-linking to another supplier clears the mappings that belonged to the first one.
select is((pg_temp.line(501)).pack_corrected, true, 'before: line 501 has a corrected pack');
select is(pg_temp.link(5, '5b000000-0000-4000-8000-00000000005b'), 'ok', 'an invoice is re-linked to another supplier');
select is((pg_temp.line(502)).ingredient_id is null and (pg_temp.line(502)).supplier_item_id is null
          and (pg_temp.line(502)).mapping_source is null, true, 'a manual mapping is cleared');
select is((pg_temp.line(501)).suggested_supplier_item_id, '52000000-0000-4000-8000-000000000052'::uuid,
  'the suggestion now comes from the new supplier''s article (the old one was cleared first)');
select is((pg_temp.line(501)).ingredient_id, '1b000000-0000-4000-8000-00000000001b'::uuid, 'and so does the mapping');
select is((pg_temp.line(501)).pack_corrected, false, 'the pack correction is reset');
select is((pg_temp.line(501)).corrected_fields, '{}', 'and the corrections are recomputed');
select is((pg_temp.inv(5)).supplier_id, '5b000000-0000-4000-8000-00000000005b'::uuid, 'the new supplier is linked');
select is((pg_temp.line(503)).unit, null, 'an untouched line loses the unit the old supplier''s article filled');
select is((pg_temp.line(503)).suggested_unit, null, 'and the suggestion with it');
select is((pg_temp.line(503)).corrected_fields, '{}', 'so no unit correction is left behind');
select is((pg_temp.line(504)).unit, 'g', 'a unit the reviewer changed is kept');
select is((pg_temp.line(504)).suggested_unit, 'kg', 'with its suggestion');
select is((pg_temp.line(504)).corrected_fields, array['unit'], 'and it stays a correction');
select is((pg_temp.line(505)).unit, 'kg', 'a unit the reviewer decided on is kept even when it equals the suggestion');
select is((pg_temp.line(505)).suggested_unit, 'kg', 'with its suggestion');
select is((pg_temp.line(506)).unit, 'g', 'an untouched line''s unit is read again from the printed one');
select is((pg_temp.line(506)).suggested_unit, 'g', 'and stored as the suggestion');

-- The buyer's VAT was blanked at extraction: copying the supplier's VAT is not a correction.
select is(pg_temp.link(6, '5a000000-0000-4000-8000-00000000005a'), 'ok', 'a supplier is linked to an invoice with no VAT');
select is((pg_temp.inv(6)).supplier_vat, 'IT12345678903', 'its VAT is copied');
select is((pg_temp.inv(6)).header_corrected_fields, '{}', 'filling a VAT the extraction could not read is not a correction');

-- Argument errors.
select is(pg_temp.link(7, null), 'P0001 invalid_request', 'neither a supplier nor data is refused');
select is(pg_temp.link(7, '5a000000-0000-4000-8000-00000000005a', '{"name": "X"}'), 'P0001 invalid_request',
  'both are refused');
select is(pg_temp.link(7, null, '{"name": "X", "foo": 1}'), 'P0001 invalid_request', 'an unknown key is refused');
select is(pg_temp.link(7, null, '{"vat_number": "IT00000000042"}'), 'P0001 invalid_request', 'a name is required');
select is(pg_temp.link(7, '5c000000-0000-4000-8000-00000000005c'), 'P0002 not_found', 'an inactive supplier is not found');
select is(pg_temp.link(7, '5e000000-0000-4000-8000-00000000005e'), 'P0002 not_found', 'tenant B''s supplier is not found');
select is(pg_temp.link(7, gen_random_uuid()), 'P0002 not_found', 'an unknown supplier is not found');
select is((pg_temp.inv(7)).supplier_id, null, 'and nothing was linked');

-- Header corrections.
select pg_temp.snapshot();
select is(pg_temp.header(10, '{"gross_total": 33.06}'), 'ok', 'the gross total is corrected');
select ok(pg_temp.written_since_snapshot() = array['invoice'], 'a header edit writes only invoice');
select is((pg_temp.inv(10)).header_corrected_fields, array['gross_total'], 'recorded as a header correction');
select is((pg_temp.inv(10)).gate_flags, array['total_mismatch'], 'the totals gate is re-run: now flagged');
select is((pg_temp.inv(10)).totals_diff, -0.06::numeric, 'with the difference');
select is(pg_temp.header(10, '{"gross_total": 33}'), 'ok', 'the gross total is set back');
select is((pg_temp.inv(10)).header_corrected_fields, '{}', 'the correction goes');
select is((pg_temp.inv(10)).gate_flags, '{}', 'and so does the flag');
select is(pg_temp.header(10, '{"vat_total": null}'), 'ok', 'a total can be cleared');
select is((pg_temp.inv(10)).gate_flags, array['total_mismatch'], 'a missing total is flagged');
select is(pg_temp.header(10, '{"vat_total": 3, "net_total": 31, "due_date": "2026-12-01"}'), 'ok', 'several fields at once');
select is((pg_temp.inv(10)).header_corrected_fields, array['due_date', 'net_total'], 'each changed field is recorded once');

-- Header: the duplicate re-check.
select is(pg_temp.header(12, '{"number_raw": "ft 77"}'), 'ok', 'the number is changed to match a live invoice');
select is((pg_temp.inv(12)).status, 'duplicate'::public.invoice_status, 'the invoice becomes a duplicate');
select is((pg_temp.inv(12)).duplicate_of, pg_temp.iid(11), 'of that invoice');
select is(pg_temp.header(12, '{"number_raw": "FT 5"}'), 'P0001 invoice_not_in_review', 'a duplicate is then closed to edits');
select is(pg_temp.header(13, '{"number_raw": "ft 77"}'), 'ok', 'an invoice already cleared by the owner is edited');
select is((pg_temp.inv(13)).status, 'review'::public.invoice_status, 'it is not re-flagged');
select is(pg_temp.header(14, '{"invoice_date": "2026-10-15"}'), 'ok', 'the date is changed to match a live invoice');
select is((pg_temp.inv(14)).status, 'duplicate'::public.invoice_status, 'the invoice becomes a duplicate');
select is(pg_temp.header(15, '{"number_raw": "FT 99"}'), 'ok', 'a number matching nothing');
select is((pg_temp.inv(15)).status, 'review'::public.invoice_status, 'stays in review');
select is((pg_temp.inv(15)).number, 'FT99', 'with the normalised number updated');

-- Header: shape.
select is(pg_temp.header(15, '{}'), 'P0001 invalid_request', 'an empty patch is refused');
select is(pg_temp.header(15, '{"supplier_vat": "IT00000000042"}'), 'P0001 invalid_request', 'the VAT is not editable here');
select is(pg_temp.header(15, '{"gross_total": "33"}'), 'P0001 invalid_request', 'a number sent as text is refused');
select is(pg_temp.header(15, '{"invoice_date": "domani"}') like '22007%', true, 'a bad date is refused');
select is(pg_temp.header(15, '{"gross_total": -1}'), '23514 new row for relation "invoice" violates check constraint "invoice_totals_ck"',
  'a negative total is refused by the table check');
select is(pg_temp.header(16, '{"gross_total": 1}'), 'P0001 invoice_not_in_review', 'a duplicate invoice is closed');

-- Clearing a duplicate flag.
select is(pg_temp.clear(20), 'ok', 'a duplicate is cleared');
select is((pg_temp.inv(20)).status, 'review'::public.invoice_status, 'back to review');
select is((pg_temp.inv(20)).duplicate_of, null, 'with no duplicate link');
select is((pg_temp.inv(20)).duplicate_override, true, 'the override is recorded');
select is((pg_temp.inv(20)).duplicate_override_by, 'a1000000-0000-4000-8000-00000000000a'::uuid, 'with who cleared it');
select is((pg_temp.inv(20)).duplicate_override_at, now(), 'and when');
select is((select count(*)::int || ' ' || min(action) || ' ' || min(created_by::text) || ' ' || min(before ->> 'status')
                  || ' ' || min(before ->> 'duplicate_of') || ' ' || min(after ->> 'status')
             from public.audit_event where entity_id = pg_temp.iid(20)),
  '1 invoice.duplicate_cleared a1000000-0000-4000-8000-00000000000a duplicate ' || pg_temp.iid(11) || ' review',
  'clearing a duplicate writes one audit row: who, and the status and link before');
select is(pg_temp.clear(21), 'ok', 'a warning is cleared');
select is((pg_temp.inv(21)).duplicate_warning_of, null, 'the warning is gone');
select is((pg_temp.inv(21)).status, 'review'::public.invoice_status, 'the status is review');
select is((pg_temp.inv(21)).duplicate_override, true, 'and the override is recorded');
select is((select count(*)::int || ' ' || min(action) || ' ' || min(before ->> 'duplicate_warning_of')
             from public.audit_event where entity_id = pg_temp.iid(21)),
  '1 invoice.duplicate_cleared ' || pg_temp.iid(11), 'dismissing a warning is audited too');
select is(pg_temp.clear(22), 'P0001 not_flagged', 'a clean invoice has nothing to clear');
select is((pg_temp.inv(22)).duplicate_override, false, 'and is not marked');
select is((select count(*)::int from public.audit_event where entity_id = pg_temp.iid(22)), 0,
  'and nothing is audited');
select is(pg_temp.clear(23), 'P0001 not_flagged', 'an approved invoice has nothing to clear');
select is(pg_temp.clear(20), 'P0001 not_flagged', 'a cleared invoice has nothing more to clear');

-- Retry.
select is(pg_temp.retry(30), 'ok', 'a failed extraction is retried');
select is((pg_temp.inv(30)).status, 'received'::public.invoice_status, 'back in the queue');
select is((pg_temp.inv(30)).attempts, 0::smallint, 'with its attempts reset');
select is((pg_temp.inv(30)).extraction_error, null, 'and no error');
select is((pg_temp.inv(30)).next_attempt_at, null, 'and no wait');
select is(pg_temp.retry(30), 'P0001 not_failed', 'a queued invoice cannot be retried');
select is(pg_temp.retry(31), 'P0001 not_failed', 'an invoice in review cannot be retried');

-- Access.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.link(7, '5a000000-0000-4000-8000-00000000005a'), '42501 insufficient_privilege', 'the chef may not link');
select is(pg_temp.header(15, '{"gross_total": 1}'), '42501 insufficient_privilege', 'edit the header');
select is(pg_temp.clear(20), '42501 insufficient_privilege', 'clear a duplicate');
select is(pg_temp.retry(30), '42501 insufficient_privilege', 'or retry');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.link(7, '5a000000-0000-4000-8000-00000000005a'), '42501 insufficient_privilege', 'the waiter may not link');
select is(pg_temp.header(15, '{"gross_total": 1}'), '42501 insufficient_privilege', 'edit the header');
select is(pg_temp.clear(20), '42501 insufficient_privilege', 'clear a duplicate');
select is(pg_temp.retry(30), '42501 insufficient_privilege', 'or retry');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.link(7, '5e000000-0000-4000-8000-00000000005e'), 'P0002 not_found', 'owner B cannot reach A''s invoice to link');
select is(pg_temp.header(15, '{"gross_total": 1}'), 'P0002 not_found', 'to edit the header');
select is(pg_temp.clear(22), 'P0002 not_found', 'to clear a duplicate');
select is(pg_temp.retry(30), 'P0002 not_found', 'or to retry');
select is(pg_temp.clear(40), 'P0001 not_flagged', 'owner B works on B''s own invoice');

reset role;
select * from finish();
rollback;
