-- P2-7 S3 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.2, 5 S3): the table invoice_vat_summary holds the per-rate rows of a FatturaPA file (DatiRiepilogo): taxable amount,
-- tax, optional rounding, accessory costs, chargeability and legal reference, one row per rate and nature. It is append-only (trigger, as raw_lot), carries a tenant_id and RLS, is read by
-- owner and admin of the tenant only, and takes no insert, update or delete from any API role (the import definer of S4 writes it). It joins the ADR-018 purge list, right before invoice.
-- Fake data only: tenants "Osteria Demo A/B", 1998 dates.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

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

-- One XML invoice per tenant (written as the table owner, like the import definer will).
insert into public.invoice (id, tenant_id, status, file_path, file_mime, file_size_bytes, document_type, xml_format, xml_sha256, xml_body_index, xml_body_count) values
  ('a2000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'review',
   '11111111-1111-4111-8111-111111111111/1998/a2000000-0000-4000-8000-0000000000a2.xml', 'application/xml', 1200, 'TD01', 'FPR12', repeat('a', 64), 1, 1),
  ('b2000000-0000-4000-8000-0000000000b2', '22222222-2222-4222-8222-222222222222', 'review',
   '22222222-2222-4222-8222-222222222222/1998/b2000000-0000-4000-8000-0000000000b2.xml', 'application/xml', 1200, 'TD01', 'FPR12', repeat('b', 64), 1, 1);

-- 1. The table ------------------------------------------------------------------------------------------------------------------------------------------
select has_table('public', 'invoice_vat_summary', 'invoice_vat_summary exists');
select columns_are('public', 'invoice_vat_summary', array['id', 'tenant_id', 'invoice_id', 'position', 'vat_rate', 'vat_nature', 'taxable', 'tax', 'rounding',
  'accessory_costs', 'vat_chargeability', 'legal_reference', 'created_at', 'created_by'], 'with the planned columns');
select col_not_null('public', 'invoice_vat_summary', 'tenant_id', 'tenant_id is not null');
select col_hasnt_default('public', 'invoice_vat_summary', 'tenant_id', 'and has no default (the definer sets it)');
select ok((select relrowsecurity from pg_class where oid = 'public.invoice_vat_summary'::regclass), 'row level security is on');

-- 2. Rows (as the table owner) and the checks -------------------------------------------------------------------------------------------------------------
create function pg_temp.vs(p_tenant uuid, p_invoice uuid, p_pos int, p_rate numeric, p_nature text, p_taxable numeric, p_tax numeric,
                           p_rounding numeric default null, p_charge text default null) returns void language sql as $$
  insert into public.invoice_vat_summary (tenant_id, invoice_id, position, vat_rate, vat_nature, taxable, tax, rounding, vat_chargeability)
  values (p_tenant, p_invoice, p_pos, p_rate, p_nature, p_taxable, p_tax, p_rounding, p_charge)
$$;
select lives_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 1, 22, null, 100.00, 22.00, null, 'I') $$, 'a 22 % row is accepted');
select lives_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 2, 0, 'N4', 10.00, 0.00) $$, 'a 0 % row with a nature (N4) is accepted');
select lives_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 3, 10, null, 50.00, 5.00, -0.40, 'D') $$, 'a negative rounding is accepted');
select lives_ok($$ select pg_temp.vs('22222222-2222-4222-8222-222222222222', 'b2000000-0000-4000-8000-0000000000b2', 1, 22, null, 200.00, 44.00) $$, 'tenant B has a row of its own');
select throws_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 4, 22, 'N4', 1, 0.22) $$,
  '23514', 'new row for relation "invoice_vat_summary" violates check constraint "invoice_vat_summary_nature_ck"', 'a rate above 0 with a nature is refused');
select throws_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 4, 0, null, 1, 0) $$,
  '23514', 'new row for relation "invoice_vat_summary" violates check constraint "invoice_vat_summary_nature_ck"', 'a 0 % row without a nature is refused');
select throws_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 4, 0, 'N2', 1, 0) $$,
  '23514', 'new row for relation "invoice_vat_summary" violates check constraint "invoice_vat_summary_vat_nature_ck"', 'the generic nature N2 is refused');
select throws_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 4, 22, null, -1, 0) $$,
  '23514', 'new row for relation "invoice_vat_summary" violates check constraint "invoice_vat_summary_taxable_ck"', 'a negative taxable amount is refused');
select throws_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 4, 22, null, 1, -0.22) $$,
  '23514', 'new row for relation "invoice_vat_summary" violates check constraint "invoice_vat_summary_tax_ck"', 'a negative tax is refused');
select throws_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 0, 22, null, 1, 0.22) $$,
  '23514', 'new row for relation "invoice_vat_summary" violates check constraint "invoice_vat_summary_position_ck"', 'position 0 is refused');
select throws_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 4, 101, null, 1, 0.22) $$,
  '23514', 'new row for relation "invoice_vat_summary" violates check constraint "invoice_vat_summary_vat_rate_ck"', 'a rate above 100 is refused');
select throws_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 4, 22, null, 1, 0.22, null, 'S') $$,
  '23514', 'new row for relation "invoice_vat_summary" violates check constraint "invoice_vat_summary_chargeability_ck"', 'a chargeability other than I or D is refused');
select throws_ok($$ select pg_temp.vs('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 1, 22, null, 1, 0.22) $$,
  '23505', 'duplicate key value violates unique constraint "invoice_vat_summary_position_uq"', 'the same position twice on one invoice is refused');
select throws_ok($$ select pg_temp.vs('22222222-2222-4222-8222-222222222222', 'a2000000-0000-4000-8000-0000000000a2', 9, 22, null, 1, 0.22) $$,
  '23503', 'insert or update on table "invoice_vat_summary" violates foreign key constraint "invoice_vat_summary_invoice_fk"', 'a row of tenant B pointing at tenant A''s invoice is refused');
select throws_ok($$ insert into public.invoice_vat_summary (invoice_id, position, vat_rate, taxable, tax)
                    values ('a2000000-0000-4000-8000-0000000000a2', 9, 22, 1, 0.22) $$,
  '23502', null, 'a row without a tenant_id is refused (no default)');
select throws_ok($$ insert into public.invoice_vat_summary (tenant_id, invoice_id, position, vat_rate, taxable, tax, legal_reference)
                    values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 9, 22, 1, 0.22, '') $$,
  '23514', 'new row for relation "invoice_vat_summary" violates check constraint "invoice_vat_summary_legal_reference_ck"', 'an empty legal reference is refused');

-- 3. Append-only ----------------------------------------------------------------------------------------------------------------------------------------
select throws_ok($$ update public.invoice_vat_summary set tax = 0 where position = 1 $$, 'P0001', 'append_only', 'an update is refused, even for the table owner');
select throws_ok($$ delete from public.invoice_vat_summary where position = 1 $$, 'P0001', 'append_only', 'a delete is refused, even for the table owner');
select throws_ok($$ truncate public.invoice_vat_summary $$, 'P0001', 'append_only', 'a truncate is refused, even for the table owner');
select is((select count(*)::int from public.invoice_vat_summary), 4, 'the four accepted rows are all still there');

-- 4. Privileges and policies ----------------------------------------------------------------------------------------------------------------------------
select ok(has_table_privilege('authenticated', 'public.invoice_vat_summary', 'select') and has_table_privilege('service_role', 'public.invoice_vat_summary', 'select'),
  'authenticated and service_role can select');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role), unnest(array['insert', 'update', 'delete', 'truncate']) p(priv)
           where has_table_privilege(r.role, 'public.invoice_vat_summary', p.priv)), 0, 'no API role can insert, update, delete or truncate');
select ok(not has_table_privilege('anon', 'public.invoice_vat_summary', 'select'), 'anon cannot select');
select is((select count(*)::int from pg_policy where polrelid = 'public.invoice_vat_summary'::regclass), 1, 'there is exactly one policy');
select is((select polname::text || ':' || polcmd::text from pg_policy where polrelid = 'public.invoice_vat_summary'::regclass), 'invoice_vat_summary_select:r', 'a select policy');
select set_eq($$ select tgname::text from pg_trigger where tgrelid = 'public.invoice_vat_summary'::regclass and not tgisinternal $$,
  $$ values ('invoice_vat_summary_append_only'), ('invoice_vat_summary_no_truncate') $$, 'the two append-only triggers are the only ones');

-- 5. Who reads what -------------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text) to authenticated;
create function pg_temp.try_write(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;
grant execute on function pg_temp.try_write(text) to authenticated, service_role;

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select count(*)::int from public.invoice_vat_summary), 3, 'owner A reads tenant A''s three rows');
select is(pg_temp.try_write($$ insert into public.invoice_vat_summary (tenant_id, invoice_id, position, vat_rate, taxable, tax)
                              values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 8, 22, 1, 0.22) $$), '42501', 'owner A cannot insert (no grant)');
select is(pg_temp.try_write($$ delete from public.invoice_vat_summary $$), '42501', 'owner A cannot delete (no grant)');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select count(*)::int from public.invoice_vat_summary), 3, 'admin A reads tenant A''s three rows');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select count(*)::int from public.invoice_vat_summary), 0, 'chef A reads nothing');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from public.invoice_vat_summary), 0, 'waiter A reads nothing');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*)::int from public.invoice_vat_summary), 1, 'owner B reads only tenant B''s row');
reset role;
set local role service_role;
select is(pg_temp.try_write($$ insert into public.invoice_vat_summary (tenant_id, invoice_id, position, vat_rate, taxable, tax)
                              values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 8, 22, 1, 0.22) $$), '42501', 'the service role cannot insert (no grant)');
select is(pg_temp.try_write($$ update public.invoice_vat_summary set tax = 0 $$), '42501', 'the service role cannot update (no grant)');
reset role;

-- 6. The purge list (ADR-018) ---------------------------------------------------------------------------------------------------------------------------
select is(cardinality(app.demo_purge_tables()), 59, 'the purge list holds 59 names');
select is((select array_position(app.demo_purge_tables(), 'invoice') - array_position(app.demo_purge_tables(), 'invoice_vat_summary')), 1,
  'invoice_vat_summary is right before invoice');
select is(array_position(app.demo_purge_tables(), 'invoice_line') < array_position(app.demo_purge_tables(), 'invoice_vat_summary'), true, 'and after invoice_line');
select is((select count(*)::int from unnest(app.demo_purge_tables()) n where n = 'invoice_vat_summary'), 1, 'it is listed once');

-- 7. A demo reset removes its rows and keeps the others' -----------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e0000000-0000-4000-8000-00000000000e', 'founder-d@example.test'),
  ('e1000000-0000-4000-8000-0000000000e1', 'owner.demo@example.test'),
  ('e2000000-0000-4000-8000-0000000000e2', 'admin.demo@example.test');
select public.create_tenant_with_owner('Locale Demo (demo)', 'IT00000000099', 'e0000000-0000-4000-8000-00000000000e', 'Titolare Demo (demo)');
create temp table ctx as select (select id from public.tenant where vat_number = 'IT00000000099') as d;
select public.begin_demo_data((select d from ctx), 'e1000000-0000-4000-8000-0000000000e1', 'Titolare (demo)', 'e2000000-0000-4000-8000-0000000000e2', 'Supporto DigiAlto (demo)');
insert into public.invoice (id, tenant_id, status, file_path, file_mime, file_size_bytes, document_type, xml_format, xml_sha256, xml_body_index, xml_body_count)
  select 'd2000000-0000-4000-8000-0000000000d2', d, 'review', d || '/1998/d2000000-0000-4000-8000-0000000000d2.xml', 'application/xml', 1200, 'TD01', 'FPR12', repeat('d', 64), 1, 1 from ctx;
select pg_temp.vs((select d from ctx), 'd2000000-0000-4000-8000-0000000000d2', 1, 22, null, 100, 22);
select pg_temp.vs((select d from ctx), 'd2000000-0000-4000-8000-0000000000d2', 2, 0, 'N4', 10, 0);
select is((select count(*)::int from public.invoice_vat_summary where tenant_id = (select d from ctx)), 2, 'the demo tenant holds two rows before the reset');
create temp table before_other as select md5(string_agg(x::text, ',' order by x::text)) as m from public.invoice_vat_summary x where x.tenant_id <> (select d from ctx);
select lives_ok($$ select public.purge_demo_data_by_id((select d from ctx), 'Locale Demo (demo)') $$, 'the demo reset of that tenant runs (the invoice and its summary rows are deleted in list order)');
select is((select count(*)::int from public.invoice_vat_summary where tenant_id = (select d from ctx)), 0, 'its summary rows are gone');
select is((select md5(string_agg(x::text, ',' order by x::text)) from public.invoice_vat_summary x where x.tenant_id <> (select d from ctx)), (select m from before_other),
  'every other tenant''s rows are untouched, byte for byte');

select * from finish();
rollback;
