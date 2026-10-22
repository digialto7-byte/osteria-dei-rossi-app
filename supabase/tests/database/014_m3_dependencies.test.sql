-- M3 relies on what the M2 founder-answers PR (#7) created. This file pins those identifiers so
-- a rename there fails here, not in the extraction procedures. No schema change.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');

-- Identifiers.
select has_column('public', 'invoice', 'supplier_name', 'invoice.supplier_name exists');
select has_column('public', 'invoice', 'duplicate_warning_of', 'invoice.duplicate_warning_of exists');
select col_type_is('public', 'invoice', 'duplicate_warning_of', 'uuid', 'duplicate_warning_of is a uuid');
select has_column('public', 'invoice', 'duplicate_override', 'invoice.duplicate_override exists');
select col_type_is('public', 'invoice', 'duplicate_override', 'boolean', 'duplicate_override is a boolean');
select has_column('public', 'invoice', 'duplicate_of', 'invoice.duplicate_of exists');
select has_function('app', 'find_duplicate_invoice_in', array['uuid', 'text', 'text', 'date', 'uuid'],
  'the VAT finder takes tenant, vat, number, date, exclude');
select has_function('app', 'find_name_duplicate_invoice_in',
  array['uuid', 'text', 'text', 'date', 'uuid'],
  'the name finder takes tenant, name, number, date, exclude');
select has_function('public', 'find_name_duplicate_invoice', array['text', 'text', 'date', 'uuid'],
  'the public name finder exists');
select has_function('app', 'normalise_name', array['text'], 'app.normalise_name exists');
select has_index('public', 'invoice', 'invoice_dedup_idx', 'the VAT key index exists');
select hasnt_index('public', 'invoice', 'invoice_dedup_uq', 'the unique dedup index is gone');
select is((select indisunique from pg_index where indexrelid = 'public.invoice_dedup_idx'::regclass),
  false, 'invoice_dedup_idx is not unique');
select ok(has_function_privilege('service_role',
  'app.find_duplicate_invoice_in(uuid, text, text, date, uuid)', 'execute'),
  'service_role can execute the VAT finder');
select ok(has_function_privilege('service_role',
  'app.find_name_duplicate_invoice_in(uuid, text, text, date, uuid)', 'execute'),
  'service_role can execute the name finder');

-- Invoice number key: punctuation matters, whitespace and case do not.
select isnt(app.normalise_invoice_number('FT 1/2026'), app.normalise_invoice_number('FT-1-2026'),
  'FT 1/2026 is not FT-1-2026');
select is(app.normalise_invoice_number('FT 1/2026'), app.normalise_invoice_number(' ft 1/2026 '),
  'case and surrounding spaces do not matter');

-- Status transitions the worker needs.
create function pg_temp.try_move(p_from public.invoice_status, p_to public.invoice_status)
  returns text language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  -- Insert in the starting state (inserts are not guarded), then try the move.
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status)
  values (v_id, '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111/2026/' || v_id || '.pdf', 'application/pdf', 10,
    case when p_from = 'duplicate' then 'review' else p_from end);
  if p_from = 'duplicate' then
    update public.invoice set status = 'duplicate',
      duplicate_of = 'a1000000-0000-4000-8000-0000000000a1' where id = v_id;
  end if;
  update public.invoice set status = p_to,
    duplicate_of = case when p_to = 'duplicate'
      then 'a1000000-0000-4000-8000-0000000000a1'::uuid else duplicate_of end
    where id = v_id;
  return 'ok';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;

-- A parent invoice so 'duplicate' rows can point at something.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status)
values ('a1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111/2026/a1000000-0000-4000-8000-0000000000a1.pdf',
  'application/pdf', 10, 'review');

select is(pg_temp.try_move('received', 'extracting'), 'ok', 'received -> extracting is allowed');
select is(pg_temp.try_move('extracting', 'duplicate'), 'ok', 'extracting -> duplicate is allowed');
select is(pg_temp.try_move('extracting', 'review'), 'ok', 'extracting -> review is allowed');
select is(pg_temp.try_move('duplicate', 'review'), 'ok', 'duplicate -> review is allowed');
select is(pg_temp.try_move('review', 'received'), 'P0001:invalid_status_transition',
  'review -> received is refused');
select * from finish();
rollback;
