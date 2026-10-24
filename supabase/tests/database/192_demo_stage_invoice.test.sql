-- Demo data step 3 (migration 20261105100200_demo_stage_invoice.sql; ADR-018, plan §3.1.4): the seed's stand-in for the
-- extraction worker. One transaction takes a fake invoice from nothing to 'review' through the real extraction_complete
-- (automap included), only for the demo tenant, only for an active owner of it, only for the invoice's own path.
-- The invoice is never visible as 'received', so the staging extract-invoices job (extraction_claim) can never claim it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ':' || msg;
end
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-0000000000a1', 'owner-r1@example.test'),
  ('a0000000-0000-4000-8000-0000000000a2', 'owner-r2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d1', 'owner-demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'admin-demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d3', 'owner-demo-2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d4', 'staff-d4@staff.invalid');
select public.create_tenant_with_owner('Locale Uno (demo)', 'IT00000000001', 'a0000000-0000-4000-8000-0000000000a1', 'Titolare Uno (demo)');
select public.create_tenant_with_owner('Locale Due (demo)', 'IT00000000002', 'a0000000-0000-4000-8000-0000000000a2', 'Titolare Due (demo)');
select public.create_demo_tenant('Osteria Demo (dati di prova)', 'IT00000000099', 'd0000000-0000-4000-8000-0000000000d1', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d2', 'Supporto DigiAlto (demo)');

create temp table ctx as
  select (select id from public.tenant where is_demo) as d,
         (select id from public.tenant where vat_number = 'IT00000000001') as r1,
         (select id from public.tenant where vat_number = 'IT00000000002') as r2,
         (select u.id from public.app_user u join public.tenant t on t.id = u.tenant_id where t.is_demo and u.role = 'owner') as d_owner,
         (select u.id from public.app_user u join public.tenant t on t.id = u.tenant_id where t.is_demo and u.role = 'admin') as d_admin,
         (select u.id from public.app_user u join public.tenant t on t.vat_number = 'IT00000000001' and t.id = u.tenant_id) as r1_owner;
grant select on ctx to public;

-- A second owner of D who is then deactivated, and a PIN chef of D.
insert into public.app_user (id, tenant_id, auth_id, role, display_name) select 'd1000000-0000-4000-8000-0000000000d3', d, 'd0000000-0000-4000-8000-0000000000d3', 'owner', 'Ex titolare (demo)' from ctx;
update public.app_user set is_active = false, deactivated_at = now() where id = 'd1000000-0000-4000-8000-0000000000d3';
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) select 'd1000000-0000-4000-8000-0000000000d4', d, 'd0000000-0000-4000-8000-0000000000d4', 'chef', 'Chef Bruno (demo)', 'pin' from ctx;

-- Master data of D: two suppliers, two ingredients, two supplier items with codes (so automap has something to find).
insert into public.ingredient (id, tenant_id, name, base_unit) select 'a1a00000-0000-4000-8000-0000000000a1', d, 'Manzo macinato (demo)', 'kg' from ctx;
insert into public.ingredient (id, tenant_id, name, base_unit) select 'a1a00000-0000-4000-8000-0000000000a2', d, 'Zucchero (demo)', 'kg' from ctx;
insert into public.supplier (id, tenant_id, name, vat_number) select '5a000000-0000-4000-8000-0000000000a1', d, 'Macelleria Fittizia (demo)', 'IT12345678903' from ctx;
insert into public.supplier (id, tenant_id, name, vat_number) select '5a000000-0000-4000-8000-0000000000a2', d, 'Latteria Immaginaria (demo)', 'IT00000000000' from ctx;
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit, invoice_unit, is_active)
  select '51000000-0000-4000-8000-0000000000a1', d, '5a000000-0000-4000-8000-0000000000a1', 'a1a00000-0000-4000-8000-0000000000a1', 'DEMO-MAN', 1, 'kg', 'kg', true from ctx;
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit, invoice_unit, is_active)
  select '51000000-0000-4000-8000-0000000000a2', d, '5a000000-0000-4000-8000-0000000000a1', 'a1a00000-0000-4000-8000-0000000000a2', 'DEMO-ZUC', 1, 'kg', 'kg', true from ctx;

create function pg_temp.line(p_code text, p_desc text, p_qty numeric, p_price numeric) returns jsonb language sql as $$
  select jsonb_build_object('raw_description', p_desc, 'supplier_code', p_code, 'qty', p_qty, 'unit_raw', 'kg',
    'unit_price', p_price, 'line_amount', round(p_qty * p_price, 4), 'vat_rate', 10, 'lot_code', null, 'expiry', null,
    'field_confidence', jsonb_build_object(), 'checks', jsonb_build_array(),
    'extracted', jsonb_build_object('description', p_desc, 'supplier_code', p_code, 'qty', p_qty, 'unit', 'kg',
      'unit_price', p_price, 'line_amount', round(p_qty * p_price, 4), 'vat_rate', 10, 'lot_code', null, 'expiry', null))
$$;
create function pg_temp.res(p_vat text, p_name text, p_number text, p_date date) returns jsonb language sql as $$
  select jsonb_build_object(
    'header', jsonb_build_object('supplier_vat', p_vat, 'supplier_name', p_name, 'number_raw', p_number,
      'invoice_date', p_date, 'due_date', p_date + 30, 'payment_terms', '30 giorni', 'net_total', 70, 'vat_total', 7, 'gross_total', 77),
    'lines', jsonb_build_array(pg_temp.line('DEMO-MAN', 'Manzo macinato (demo)', 5, 12), pg_temp.line('DEMO-ZUC', 'Zucchero (demo)', 5, 2)),
    'gate_flags', jsonb_build_array(), 'totals_diff', 0, 'field_confidence', jsonb_build_object(),
    'extraction_json', jsonb_build_object('demo', true))
$$;
create function pg_temp.path(p_tenant uuid, p_invoice uuid, p_ext text default 'pdf') returns text language sql as $$
  select p_tenant || '/2026/' || p_invoice || '.' || p_ext
$$;
-- The call under test, as service_role, returning the status or 'state:message'.
create function pg_temp.stage(p_tenant uuid, p_invoice uuid, p_path text, p_by uuid, p_size int, p_result jsonb) returns text language plpgsql as $$
begin
  return public.demo_stage_invoice(p_tenant, p_invoice, p_path, p_size, p_by, p_result)::text;
exception when others then
  return sqlstate || ':' || sqlerrm;
end
$$;
grant execute on function pg_temp.stage(uuid, uuid, text, uuid, int, jsonb), pg_temp.res(text, text, text, date), pg_temp.path(uuid, uuid, text) to service_role;

-- Grants ------------------------------------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.demo_stage_invoice(uuid, uuid, text, integer, uuid, jsonb)', 'execute'), 'service_role can execute demo_stage_invoice');
select ok(not has_function_privilege('authenticated', 'public.demo_stage_invoice(uuid, uuid, text, integer, uuid, jsonb)', 'execute'), 'authenticated cannot');
select ok(not has_function_privilege('anon', 'public.demo_stage_invoice(uuid, uuid, text, integer, uuid, jsonb)', 'execute'), 'anon cannot');

-- A two-line invoice for D, and a second one from the other supplier --------------------------------------------------------------------
set local role service_role;
select is((select pg_temp.stage(d, '11000000-0000-4000-8000-000000000001', pg_temp.path(d, '11000000-0000-4000-8000-000000000001'), d_owner, 4096,
            pg_temp.res('IT12345678903', 'Macelleria Fittizia (demo)', 'F-001', date '2026-09-20')) from ctx),
          'review', 'D, owner, own path, two lines: the invoice ends in review');
select is((select pg_temp.stage(d, '11000000-0000-4000-8000-000000000002', pg_temp.path(d, '11000000-0000-4000-8000-000000000002'), d_owner, 4096,
            pg_temp.res('IT00000000000', 'Latteria Immaginaria (demo)', 'L-001', date '2026-10-22')) from ctx),
          'review', 'a second invoice from the other supplier too');
reset role;

select is((select i.status::text || ',' || i.extraction_model || ',' || coalesce(i.claim_token::text, 'none') || ',' || i.attempts
             from public.invoice i where i.id = '11000000-0000-4000-8000-000000000001'),
          'review,demo-seed,none,1', 'status review, model demo-seed, no claim left, one attempt');
select is((select i.created_by from public.invoice i where i.id = '11000000-0000-4000-8000-000000000001'), (select d_owner from ctx), 'created_by is the owner');
select is((select i.file_path from public.invoice i where i.id = '11000000-0000-4000-8000-000000000001'), (select pg_temp.path(d, '11000000-0000-4000-8000-000000000001') from ctx), 'the file path is the one given');
select is((select i.file_mime || ',' || i.file_size_bytes from public.invoice i where i.id = '11000000-0000-4000-8000-000000000001'), 'application/pdf,4096', 'a PDF of the given size');
select is((select i.supplier_vat || ',' || i.number || ',' || i.invoice_date || ',' || i.due_date || ',' || i.gross_total
             from public.invoice i where i.id = '11000000-0000-4000-8000-000000000001'),
          'IT12345678903,F-001,2026-09-20,2026-10-20,77.0000', 'the header of the result is stored');
select is((select count(*)::int from public.invoice_line where invoice_id = '11000000-0000-4000-8000-000000000001'), 2, 'two lines');
select is((select string_agg(coalesce(l.ingredient_id::text, 'none') || '/' || l.mapping_source, ',' order by l.position) from public.invoice_line l where l.invoice_id = '11000000-0000-4000-8000-000000000001'),
          'a1a00000-0000-4000-8000-0000000000a1/auto,a1a00000-0000-4000-8000-0000000000a2/auto', 'automap mapped both lines from the supplier codes');
select is((select count(*)::int from public.invoice where tenant_id in (select r1 from ctx union select r2 from ctx)), 0, 'the real tenants have no invoice');

-- A duplicate (same VAT, number and date) is handled as the worker does -------------------------------------------------------------------
set local role service_role;
select is((select pg_temp.stage(d, '11000000-0000-4000-8000-000000000003', pg_temp.path(d, '11000000-0000-4000-8000-000000000003'), d_owner, 4096,
            pg_temp.res('IT12345678903', 'Macelleria Fittizia (demo)', 'f-001', date '2026-09-20')) from ctx),
          'duplicate', 'the same VAT, number and date: duplicate');
reset role;
select is((select duplicate_of from public.invoice where id = '11000000-0000-4000-8000-000000000003'), '11000000-0000-4000-8000-000000000001'::uuid, 'pointing at the first one');

-- Refusals ---------------------------------------------------------------------------------------------------------------------------------
set local role service_role;
select is((select pg_temp.stage(r1, '11000000-0000-4000-8000-000000000011', pg_temp.path(r1, '11000000-0000-4000-8000-000000000011'), r1_owner, 4096,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-011', date '2026-09-20')) from ctx),
          '42501:not_demo_tenant', 'a real tenant: not_demo_tenant, 42501');
select is((select pg_temp.stage(r2, '11000000-0000-4000-8000-000000000012', pg_temp.path(r2, '11000000-0000-4000-8000-000000000012'), r1_owner, 4096,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-012', date '2026-09-20')) from ctx),
          '42501:not_demo_tenant', 'the other real tenant too');
select is(pg_temp.stage(gen_random_uuid(), '11000000-0000-4000-8000-000000000013', 'x', null, 4096, '{}'::jsonb), '42501:not_demo_tenant', 'and an unknown tenant');
select is((select pg_temp.stage(d, '11000000-0000-4000-8000-000000000014', pg_temp.path(d, '11000000-0000-4000-8000-000000000014'), d_admin, 4096,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-014', date '2026-09-20')) from ctx),
          '42501:not_tenant_owner', 'the admin of D is not an owner: refused');
select is((select pg_temp.stage(d, '11000000-0000-4000-8000-000000000015', pg_temp.path(d, '11000000-0000-4000-8000-000000000015'), 'd1000000-0000-4000-8000-0000000000d4', 4096,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-015', date '2026-09-20')) from ctx),
          '42501:not_tenant_owner', 'a chef of D: refused');
select is((select pg_temp.stage(d, '11000000-0000-4000-8000-000000000016', pg_temp.path(d, '11000000-0000-4000-8000-000000000016'), 'd1000000-0000-4000-8000-0000000000d3', 4096,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-016', date '2026-09-20')) from ctx),
          '42501:not_tenant_owner', 'a deactivated owner of D: refused');
select is((select pg_temp.stage(d, '11000000-0000-4000-8000-000000000017', pg_temp.path(d, '11000000-0000-4000-8000-000000000017'), r1_owner, 4096,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-017', date '2026-09-20')) from ctx),
          '42501:not_tenant_owner', 'the owner of another tenant: refused');
select is((select pg_temp.stage(d, '11000000-0000-4000-8000-000000000018', pg_temp.path(r1, '11000000-0000-4000-8000-000000000018'), d_owner, 4096,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-018', date '2026-09-20')) from ctx),
          'P0001:invalid_file_path', 'a path under another tenant: refused');
select is((select pg_temp.stage(d, '11000000-0000-4000-8000-000000000019', pg_temp.path(d, '11000000-0000-4000-8000-000000000020'), d_owner, 4096,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-019', date '2026-09-20')) from ctx),
          'P0001:invalid_file_path', 'a path with another invoice id: refused');
select is((select pg_temp.stage(d, '11000000-0000-4000-8000-000000000021', pg_temp.path(d, '11000000-0000-4000-8000-000000000021', 'jpg'), d_owner, 4096,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-021', date '2026-09-20')) from ctx),
          'P0001:invalid_file_path', 'a path that is not a .pdf: refused');
select is((select left(pg_temp.stage(d, '11000000-0000-4000-8000-000000000022', pg_temp.path(d, '11000000-0000-4000-8000-000000000022'), d_owner, 0,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-022', date '2026-09-20')), 5) from ctx),
          '23514', 'a file size of 0: refused by the table check');
select is((select left(pg_temp.stage(d, '11000000-0000-4000-8000-000000000001', pg_temp.path(d, '11000000-0000-4000-8000-000000000001'), d_owner, 4096,
            pg_temp.res('IT12345678903', 'X (demo)', 'F-023', date '2026-09-20')), 5) from ctx),
          '23505', 'staging an invoice id twice: refused');
reset role;
select is((select count(*)::int from public.invoice), 3, 'after all the refusals only the three good calls wrote an invoice');
select is((select count(*)::int from public.invoice_line), 6, 'and their six lines');

-- The worker queue never sees a demo invoice ------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.invoice where status in ('received', 'extracting')), 0, 'no demo invoice is received or extracting');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes)
  select '11000000-0000-4000-8000-000000000031', r1, r1 || '/2026/11000000-0000-4000-8000-000000000031.pdf', 'application/pdf', 100 from ctx;
set local role service_role;
select is((select tenant_id from public.extraction_claim(300, 3)), (select r1 from ctx), 'extraction_claim takes the real tenant''s waiting invoice');
select is((select count(*)::int from public.extraction_claim(300, 3)), 0, 'and then finds nothing: no demo invoice was ever waiting');
reset role;

select * from finish();
rollback;
