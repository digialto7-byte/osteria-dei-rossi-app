-- M16 step 10: M16 changed nothing of what M6-M14 built except the body of the hourly job (re-pinned in 089, 098, 119). The alert
-- pipeline, the batch requirement expansion, the stock engine and the chef allow-list are pinned by the md5 of their definitions
-- (the technique of 098), each exists once, the cron schedule and the set of jobs are unchanged, and every M16 kind is non-cost.
-- The md5 values of batch_requirements and chef_payload_allowed were computed on main 80e6809 (the chain up to 20261028100500).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.n(p_schema text, p_name text) returns integer language sql stable as $$
  select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = p_schema and p.proname = p_name $$;

-- Exactly one definition of each (no overload, no second copy).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('app', 'raise_alert'), ('app', 'try_raise_alert'), ('app', 'run_alert_rules'),
              ('app', 'alert_rules_body'), ('app', 'batch_requirements'), ('app', 'post_stock_outflow'), ('app', 'chef_payload_allowed'))),
  7, 'raise_alert, try_raise_alert, run_alert_rules, alert_rules_body, batch_requirements, post_stock_outflow and chef_payload_allowed: one definition each');

set local search_path = '';
create temp table pin_md5 on commit drop as
select 'raise_alert' as k, md5(pg_get_functiondef('app.raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity, public.app_role[], timestamptz, date)'::regprocedure)) as h
union all select 'try_raise_alert', md5(pg_get_functiondef('app.try_raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity, public.app_role[], timestamptz, date, text)'::regprocedure))
union all select 'run_alert_rules', md5(pg_get_functiondef('app.run_alert_rules(timestamptz)'::regprocedure))
union all select 'post_stock_outflow', md5(pg_get_functiondef('app.post_stock_outflow(uuid, uuid, uuid, uuid, numeric, public.stock_movement_type, text, uuid, text, uuid, timestamptz, timestamptz, text)'::regprocedure))
union all select 'batch_requirements', md5(pg_get_functiondef('app.batch_requirements(uuid, uuid, timestamptz)'::regprocedure))
union all select 'chef_payload_allowed', md5(pg_get_functiondef('app.chef_payload_allowed(jsonb)'::regprocedure));
set local search_path = "$user", public, extensions;
select is((select h from pin_md5 where k = 'raise_alert'), '4cb45fc51c5fefa12eaa9945942ceb23', 'app.raise_alert is the M12 definition, as 119 pins it (md5)');
select is((select h from pin_md5 where k = 'try_raise_alert'), '5894b65bd641b328301b72a9bc30b282', 'app.try_raise_alert is the M8 definition, as 119 pins it (md5)');
select is((select h from pin_md5 where k = 'run_alert_rules'), '911fe833b447c706107f25d74cd15304', 'app.run_alert_rules is the M6 definition, as 119 pins it (md5)');
select is((select h from pin_md5 where k = 'post_stock_outflow'), 'b50e1690b47e3b3f89dd1da533c59463', 'app.post_stock_outflow is the M12 engine, as 128 pins it (md5)');
select is((select h from pin_md5 where k = 'batch_requirements'), '43d18009439c82b7bbf53d792c9c9687', 'app.batch_requirements is the M14 expansion (md5, computed on main 80e6809)');
select is((select h from pin_md5 where k = 'chef_payload_allowed'), '90cfdc224b67c5092a0f34e2d532ca4f', 'app.chef_payload_allowed is the M12 allow-list (md5, computed on main 80e6809)');

-- The cron schedule: the hourly job is unchanged and M16 added no job.
select is((select schedule || ' | ' || command from cron.job where jobname = 'alert-rules'), '0 * * * * | select app.run_alert_rules()', 'the alert-rules cron row is unchanged');
select is((select string_agg(jobname, ',' order by jobname) from cron.job), 'alert-rules,auth-purge,extract-invoices,ledger-invariants', 'and the set of cron jobs is unchanged (no new job)');

-- The body still starts with M9's two blocks and the runner still calls it.
select ok(pg_get_functiondef('app.alert_rules_body(timestamptz)'::regprocedure) ~ 'payable_reminders.*payables_digest', 'alert_rules_body still holds M9''s two blocks, in order');
select ok(pg_get_functiondef('app.run_alert_rules(timestamptz)'::regprocedure) ~ 'app\.alert_rules_body\(', 'app.run_alert_rules still calls app.alert_rules_body');

-- The M16 kinds: registered, none cost-bearing, no chef in a cost-bearing kind.
select is((select string_agg(k.kind || ':' || k.cost_bearing::text, ',' order by k.kind) from app.alert_kind k
            where k.kind in ('prep_due', 'prep_raw_short', 'purchase_due', 'raw_lot_expiring', 'batch_expiring')),
  'batch_expiring:false,prep_due:false,prep_raw_short:false,purchase_due:false,raw_lot_expiring:false', 'every M16 kind is cost_bearing false');
select is((select count(*)::int from app.alert_kind), 15, 'the registry holds the ten earlier kinds and the five of M16');

-- The M16 functions: only the four rules and their helpers in app, none executable by an API role; the public ones are the settings, the reads and the wrapper.
select is_empty(
  $$ select p.proname || ':' || r from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
      where p.pronamespace = 'app'::regnamespace
        and p.proname in ('iso_utc', 'next_delivery_window', 'usable_on_hand', 'weekday_consumption', 'forecast_qty', 'supplier_window', 'recipe_rules',
                          'require_rules_reader', 'require_rules_writer', 'rules_numeric', 'rules_int', 'rules_patch_ok', 'remaining_portions',
                          'raise_rule_alert', 'prep_rule', 'purchase_rule', 'expiry_rule')
        and has_function_privilege(r, p.oid, 'execute') $$,
  'no API role can execute any app function M16 added');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('set_ingredient_rules', 'set_supplier_delivery', 'set_recipe_rules', 'rules_ingredients', 'rules_suppliers', 'rules_recipes', 'alert_rules_run')),
  'alert_rules_run,rules_ingredients,rules_recipes,rules_suppliers,set_ingredient_rules,set_recipe_rules,set_supplier_delivery', 'the seven public functions of M16 exist');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('set_ingredient_rules', 'set_supplier_delivery', 'set_recipe_rules', 'rules_ingredients', 'rules_suppliers', 'rules_recipes', 'alert_rules_run')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 7, 'all seven are security definer with an empty search_path');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('set_ingredient_rules', 'set_supplier_delivery', 'set_recipe_rules', 'rules_ingredients', 'rules_suppliers', 'rules_recipes')
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
            and not has_function_privilege('service_role', p.oid, 'execute')),
  'rules_ingredients,rules_recipes,rules_suppliers,set_ingredient_rules,set_recipe_rules,set_supplier_delivery', 'the six user-facing ones are executable by authenticated only');

select * from finish();
rollback;
