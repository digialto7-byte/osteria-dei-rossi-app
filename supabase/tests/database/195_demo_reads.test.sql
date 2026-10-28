-- Demo data step 5 (migration 20261105100400_demo_reads.sql; ADR-018): demo_tenant_state and demo_tenant_row_counts (service
-- role only: counts, never rows), and the pinned grants of everything this branch adds. The scripts and the integration test
-- read the demo through these two functions, so the secret key never reads a recipe table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-0000000000a1', 'owner-r1@example.test'),
  ('a0000000-0000-4000-8000-0000000000a2', 'owner-r2@example.test'),
  ('f0000000-0000-4000-8000-0000000000f1', 'owner-t@example.test'),
  ('d0000000-0000-4000-8000-0000000000d1', 'owner-demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'admin-demo@example.test');
select public.create_tenant_with_owner('Locale Uno (demo)', 'IT00000000001', 'a0000000-0000-4000-8000-0000000000a1', 'Titolare Uno (demo)');
select public.create_tenant_with_owner('Locale Due (demo)', 'IT00000000002', 'a0000000-0000-4000-8000-0000000000a2', 'Titolare Due (demo)');
select public.create_tenant_with_owner('Locale Target (demo)', 'IT00000000003', 'f0000000-0000-4000-8000-0000000000f1', 'Titolare Target (demo)');
create temp table ctx as
  select (select id from public.tenant where vat_number = 'IT00000000001') as r1,
         (select id from public.tenant where vat_number = 'IT00000000002') as r2,
         (select id from public.tenant where vat_number = 'IT00000000003') as t;
create temp table keys as select array_agg(n order by n collate "C") as k, count(*)::int as c from unnest(array_append(app.demo_purge_tables(), 'alert_refusal')) n;
grant select on ctx, keys to public;
insert into public.location (tenant_id, name) select r1, 'Luogo ' || n || ' (demo)' from ctx, generate_series(1, 3) n;
insert into public.ingredient (tenant_id, name, base_unit) select r1, 'Ingrediente ' || n || ' (demo)', 'kg' from ctx, generate_series(1, 2) n;
insert into public.location (tenant_id, name) select r2, 'Luogo ' || n || ' (demo)' from ctx, generate_series(1, 2) n;
insert into app.alert_refusal (tenant_id, kind, caller, code, sqlstate) select r1, 'test_alert', 'alert_rules', 'unknown_alert_kind', 'P0001' from ctx, generate_series(1, 2);

-- demo_tenant_state -------------------------------------------------------------------------------------------------------------------------
set local role service_role;
select is((select public.demo_tenant_state(gen_random_uuid())), '{"exists": false}'::jsonb, 'an unknown tenant: {exists: false}');
select is((select public.demo_tenant_state(r1) - 'name' from ctx), (select jsonb_build_object('exists', true, 'tenantId', r1, 'demoSince', null, 'hasOperationalData', true, 'demoUsers', 0) from ctx),
          'an unmarked tenant with data: not marked, has operational data, no demo user');
select is((select public.demo_tenant_state(t) - 'name' from ctx), (select jsonb_build_object('exists', true, 'tenantId', t, 'demoSince', null, 'hasOperationalData', false, 'demoUsers', 0) from ctx),
          'an empty unmarked tenant: no data, ready to be marked');
reset role;
select public.begin_demo_data((select t from ctx), 'd0000000-0000-4000-8000-0000000000d1', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d2', 'Supporto DigiAlto (demo)');
set local role service_role;
select is((select (public.demo_tenant_state(t) ->> 'demoSince')::timestamptz = x.demo_data_since from ctx, public.tenant x where x.id = ctx.t), true, 'after begin_demo_data: demoSince is the marker');
select is((select public.demo_tenant_state(t) - 'demoSince' - 'name' from ctx), (select jsonb_build_object('exists', true, 'tenantId', t, 'hasOperationalData', false, 'demoUsers', 2) from ctx),
          'two demo users, and the demo users and the audit row are not operational data');
select is((select public.demo_tenant_state(t) ->> 'name' from ctx), 'Locale Target (demo)', 'the name is returned (the script needs it for the confirmation)');
select is((select array_agg(k order by k collate "C") from ctx, jsonb_object_keys(public.demo_tenant_state(ctx.t)) k), array['demoSince', 'demoUsers', 'exists', 'hasOperationalData', 'name', 'tenantId'], 'and nothing else (no VAT, no user)');

-- demo_tenant_row_counts ------------------------------------------------------------------------------------------------------------------
select is((select public.demo_tenant_row_counts(r1) ->> 'location' || ',' || (public.demo_tenant_row_counts(r1) ->> 'ingredient') || ',' || (public.demo_tenant_row_counts(r1) ->> 'tenant')
                  || ',' || (public.demo_tenant_row_counts(r1) ->> 'app_user') || ',' || (public.demo_tenant_row_counts(r1) ->> 'alert_refusal') from ctx),
          '3,2,1,1,2', 'counts for a real tenant: 3 locations, 2 ingredients, its tenant row, its owner, 2 refusals');
select is((select public.demo_tenant_row_counts(r2) ->> 'location' || ',' || (public.demo_tenant_row_counts(r2) ->> 'ingredient') || ',' || (public.demo_tenant_row_counts(r2) ->> 'alert_refusal') from ctx),
          '2,0,0', 'and for the other one: 2 locations, no ingredient, no refusal');
select is((select count(*)::int from jsonb_object_keys(public.demo_tenant_row_counts((select r1 from ctx)))), (select c from keys), 'one count per listed table, and alert_refusal');
select is((select bool_and(jsonb_typeof(value) = 'number') from jsonb_each(public.demo_tenant_row_counts((select r1 from ctx)))), true, 'every value is a number: no row data');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(public.demo_tenant_row_counts((select r1 from ctx))) k),
          (select k from keys), 'the keys are the purge list plus alert_refusal');
select is((select public.demo_tenant_row_counts('00000000-0000-0000-0000-000000000000') = (select jsonb_object_agg(k, 0) from jsonb_object_keys(public.demo_tenant_row_counts((select r1 from ctx))) k)), true, 'an unknown tenant: every count is 0');
reset role;

-- Grants, pinned -----------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(f.fn || '=' || coalesce((select string_agg(r.role, ',' order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
                                                       where has_function_privilege(r.role, f.fn, 'execute')), '-'), ' ' order by f.fn collate "C")
             from unnest(array[
               'public.begin_demo_data(uuid, uuid, text, uuid, text)', 'public.demo_stage_invoice(uuid, uuid, text, integer, uuid, jsonb)',
               'public.purge_demo_data(text)', 'public.purge_demo_data_by_id(uuid, text)', 'public.demo_purge_pending()',
               'public.demo_purge_cleanup_done(bigint, integer, integer)', 'public.demo_tenant_state(uuid)', 'public.demo_tenant_row_counts(uuid)']) f(fn)),
          'public.begin_demo_data(uuid, uuid, text, uuid, text)=service_role public.demo_purge_cleanup_done(bigint, integer, integer)=service_role '
          || 'public.demo_purge_pending()=service_role public.demo_stage_invoice(uuid, uuid, text, integer, uuid, jsonb)=service_role '
          || 'public.demo_tenant_row_counts(uuid)=service_role public.demo_tenant_state(uuid)=service_role '
          || 'public.purge_demo_data(text)=authenticated public.purge_demo_data_by_id(uuid, text)=service_role',
          'execute grants of the public functions: exactly as designed (only purge_demo_data is open to authenticated)');
select is((select string_agg(f.fn, ' ' order by f.fn collate "C") from unnest(array[
             'app.tenant_is_demo(uuid)', 'app.tenant_has_operational_data(uuid)', 'app.demo_purge_allows(uuid)', 'app.purge_demo_data_core(uuid, text, uuid)',
             'app.demo_purge_tables()', 'app.demo_tenant_counts(uuid)', 'app.tenant_demo_marker_guard()']) f(fn)
            where exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r(role) where has_function_privilege(r.role, f.fn, 'execute'))),
          null, 'the app-schema functions of this branch are closed to every API role');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('begin_demo_data', 'demo_stage_invoice', 'purge_demo_data', 'purge_demo_data_by_id', 'demo_purge_pending',
                                                         'demo_purge_cleanup_done', 'demo_tenant_state', 'demo_tenant_row_counts')
              and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])), 0, 'all eight are SECURITY DEFINER with search_path = ''''');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('tenant_is_demo', 'tenant_has_operational_data', 'demo_purge_allows', 'purge_demo_data_core', 'demo_purge_tables', 'demo_tenant_counts', 'tenant_demo_marker_guard')
              and p.proconfig is distinct from array['search_path=""']), 0, 'and the app-schema ones have search_path = ''''');

-- Table privileges: what the secret key and the app can do with tenant is unchanged by this branch (M0 baseline).
select is((select array_agg(p order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p where has_table_privilege('service_role', 'public.tenant', p)),
          array['INSERT', 'SELECT', 'UPDATE'], 'service_role on tenant: select, insert, update; no delete, no truncate');
select is((select array_agg(p order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p where has_table_privilege('authenticated', 'public.tenant', p)),
          array['SELECT'], 'authenticated on tenant: select only (demo_data_since is readable, never writable)');
select is((select count(*)::int from unnest(array['anon']) r(role) where has_table_privilege(r.role, 'public.tenant', 'select, insert, update, delete, truncate')), 0, 'anon: nothing on tenant');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p')
              and (has_table_privilege('service_role', c.oid, 'delete') or has_table_privilege('service_role', c.oid, 'truncate')
                   or has_table_privilege('authenticated', c.oid, 'delete') or has_table_privilege('authenticated', c.oid, 'truncate'))), 0,
          'no public table gained DELETE or TRUNCATE for service_role or authenticated');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_schema_privilege(r.role, 'app', 'create')), 0, 'no API role can create objects in schema app');

select * from finish();
rollback;
