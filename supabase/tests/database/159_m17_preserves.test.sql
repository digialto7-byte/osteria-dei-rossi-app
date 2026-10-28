-- M17 step 9: M17 changed nothing of what M5-M16 built except app.plate_cost_rows (which it owns by the M8 section 3.8
-- contract, tested in 158). The alert pipeline, the invoice and batch procedures, the business-date helper and the recipe
-- cost engine are pinned by the md5 of their definitions (the technique of 149); the alert registry, the cron jobs and
-- the set of public functions named cost, margin or price are unchanged; and the M19 stub is pinned on purpose.
-- The md5 values were computed on main 0bf2dad (the chain up to 20261030100800).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');

-- Exactly one definition of each (no overload, no second copy).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('app', 'raise_alert'), ('app', 'try_raise_alert'), ('app', 'run_alert_rules'),
              ('app', 'alert_rules_body'), ('public', 'approve_invoice'), ('public', 'produce_batch'), ('app', 'business_date'),
              ('app', 'recipe_costs'))),
  8, 'raise_alert, try_raise_alert, run_alert_rules, alert_rules_body, approve_invoice, produce_batch, business_date and recipe_costs: one definition each');

set local search_path = '';
create temp table pin_md5 on commit drop as
select 'raise_alert' as k, md5(pg_get_functiondef('app.raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity, public.app_role[], timestamptz, date)'::regprocedure)) as h
union all select 'try_raise_alert', md5(pg_get_functiondef('app.try_raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity, public.app_role[], timestamptz, date, text)'::regprocedure))
union all select 'run_alert_rules', md5(pg_get_functiondef('app.run_alert_rules(timestamptz)'::regprocedure))
union all select 'alert_rules_body', md5(pg_get_functiondef('app.alert_rules_body(timestamptz)'::regprocedure))
union all select 'approve_invoice', md5(pg_get_functiondef('public.approve_invoice(uuid, uuid)'::regprocedure))
union all select 'produce_batch', md5(pg_get_functiondef('public.produce_batch(uuid, numeric, jsonb, integer, integer, uuid)'::regprocedure))
union all select 'business_date', md5(pg_get_functiondef('app.business_date(uuid, timestamptz)'::regprocedure))
union all select 'recipe_costs', md5(pg_get_functiondef('app.recipe_costs(uuid, uuid[], timestamptz)'::regprocedure));
set local search_path = "$user", public, extensions;
select is((select h from pin_md5 where k = 'raise_alert'), '4cb45fc51c5fefa12eaa9945942ceb23', 'app.raise_alert is the M12 definition (md5)');
select is((select h from pin_md5 where k = 'try_raise_alert'), '5894b65bd641b328301b72a9bc30b282', 'app.try_raise_alert is the M8 definition (md5)');
select is((select h from pin_md5 where k = 'run_alert_rules'), '911fe833b447c706107f25d74cd15304', 'app.run_alert_rules is the M6 definition (md5)');
select is((select h from pin_md5 where k = 'alert_rules_body'), '2ac38ab6a9ae5ef83ccf94d7679ec387', 'app.alert_rules_body is the M16 body, as 089 pins it (md5)');
select is((select h from pin_md5 where k = 'approve_invoice'), '6b4682a200fa7d7ad6cf848f37556812', 'public.approve_invoice is unchanged (md5, computed on main 0bf2dad)');
select is((select h from pin_md5 where k = 'produce_batch'), 'beb3cb1d11d08cf5093bf79fe1d4d02e', 'public.produce_batch is unchanged (md5, computed on main 0bf2dad)');
select is((select h from pin_md5 where k = 'business_date'), '150a8a67166e74c83eb14d3a48be9af6', 'app.business_date is the M15 helper (md5, computed on main 0bf2dad)');
select is((select h from pin_md5 where k = 'recipe_costs'), 'ba783c47b5cd1b0b5e7fd727773f2bde', 'app.recipe_costs is the M8 engine (md5, computed on main 0bf2dad)');

-- The alert registry and the cron jobs: M17 adds no kind and no job.
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still holds 15 kinds (M17 adds none)');
select is((select string_agg(jobname, ',' order by jobname) from cron.job), 'alert-rules,auth-purge,extract-invoices,ledger-invariants', 'the set of cron jobs is unchanged (no new job)');
select is((select schedule || ' | ' || command from cron.job where jobname = 'alert-rules'), '0 * * * * | select app.run_alert_rules()', 'and the alert-rules row');

-- The public functions named cost, margin or price are still the 13 of 059 (plate_margins_pct aside): no new price-named function.
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname ~* '(cost|margin|price)' and p.proname <> 'plate_margins_pct'),
  'batch_costs,cost_settings,count_variance_costs,enter_fixed_costs,fixed_cost_status,ingredient_costs,plate_costs,raw_waste_costs,recipe_cost_at,recipe_costs,set_ingredient_cost_basis,update_cost_settings,waste_costs',
  'the public functions named cost, margin or price are exactly the 13 of 059');

-- The M19 stub: exists once, returns no row for a real session, and no API role can execute it. M19 replaces this on
-- purpose and re-pins it here (its replacement must keep the signature and count the fired order lines).
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  values ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1,
          'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  values ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001',
          'Tavolo 1 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24',
          'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'session_fired_lines'
              and pg_get_function_identity_arguments(p.oid) = 'p_tenant uuid, p_session_ids uuid[]'), 1, 'app.session_fired_lines(uuid, uuid[]) exists once');
select is((select count(*)::int from app.session_fired_lines('11111111-1111-4111-8111-111111111111', array['14000000-0000-4000-8000-000000000001']::uuid[])), 0,
  'the M17 stub returns no row (M19 replaces it on purpose and re-pins here)');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'app.session_fired_lines(uuid, uuid[])', 'execute')), 0, 'no API role can execute the stub');

select * from finish();
rollback;
