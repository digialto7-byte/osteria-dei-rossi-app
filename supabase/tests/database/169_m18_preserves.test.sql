-- M18 step 9: M18 changes nothing of what earlier milestones built. The M17 status pipeline (table_status,
-- session_statuses, the M19 stub session_fired_lines, open_table, update_table_session, menu_item_price_at), the batch
-- helpers and procedures M18 reads or locks with (remaining_portions, batch_remaining, batch_settle_state, lock_batch_rows,
-- discard_batch, produce_batch), the business-date helper and the alert body are pinned by the md5 of their definitions
-- (the technique of 149 and 159); the audit checks, the alert registry, the cron jobs and the set of public functions
-- named cost, margin or price are unchanged. M18 adds no entity type, action, alert kind or job.
-- The M17 stub session_fired_lines was pinned here on purpose; M19 replaced it (same signature) and pins the new definition in 179.
-- The md5 values of the M17 functions were computed on the M17 SQL merged at caa23d7 (20261031100000-20261031100700);
-- the others on main 0bf2dad (as 159 has them). open_table was re-pinned on merging the M17 review fixes (470cdd3). If M17's SQL changes one of its functions, re-pin it here in the merge.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');

-- Exactly one definition of each (no overload, no second copy).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('app', 'table_status'), ('app', 'session_statuses'), ('app', 'session_fired_lines'),
              ('app', 'menu_item_price_at'), ('public', 'open_table'), ('public', 'update_table_session'),
              ('app', 'remaining_portions'), ('app', 'batch_remaining'), ('app', 'batch_settle_state'), ('app', 'lock_batch_rows'),
              ('public', 'discard_batch'), ('public', 'produce_batch'), ('app', 'business_date'), ('app', 'alert_rules_body'))),
  14, 'the 14 pinned functions have one definition each');

set local search_path = '';
create temp table pin_md5 on commit drop as
select 'table_status' as k, md5(pg_get_functiondef('app.table_status(boolean, timestamptz, timestamptz, integer)'::regprocedure)) as h
union all select 'session_statuses', md5(pg_get_functiondef('app.session_statuses(uuid, uuid[])'::regprocedure))
union all select 'menu_item_price_at', md5(pg_get_functiondef('app.menu_item_price_at(uuid, uuid[], timestamptz)'::regprocedure))
union all select 'open_table', md5(pg_get_functiondef('public.open_table(uuid, uuid, integer)'::regprocedure))
union all select 'update_table_session', md5(pg_get_functiondef('public.update_table_session(uuid, jsonb)'::regprocedure))
union all select 'remaining_portions', md5(pg_get_functiondef('app.remaining_portions(uuid, timestamptz)'::regprocedure))
union all select 'batch_remaining', md5(pg_get_functiondef('app.batch_remaining(uuid, uuid)'::regprocedure))
union all select 'batch_settle_state', md5(pg_get_functiondef('app.batch_settle_state(uuid, uuid, text)'::regprocedure))
union all select 'lock_batch_rows', md5(pg_get_functiondef('app.lock_batch_rows(uuid, uuid[])'::regprocedure))
union all select 'discard_batch', md5(pg_get_functiondef('public.discard_batch(uuid, numeric, text)'::regprocedure))
union all select 'produce_batch', md5(pg_get_functiondef('public.produce_batch(uuid, numeric, jsonb, integer, integer, uuid)'::regprocedure))
union all select 'business_date', md5(pg_get_functiondef('app.business_date(uuid, timestamptz)'::regprocedure))
union all select 'alert_rules_body', md5(pg_get_functiondef('app.alert_rules_body(timestamptz)'::regprocedure));
set local search_path = "$user", public, extensions;
select is((select h from pin_md5 where k = 'table_status'), '14ff5153ae8ce6629d7b8d3dcdfa4c06', 'app.table_status is the M17 definition (md5)');
select is((select h from pin_md5 where k = 'session_statuses'), '6b84a940fc0e3865dc2b3c40952fd608', 'app.session_statuses is the M17 definition (md5)');
select is((select h from pin_md5 where k = 'menu_item_price_at'), '63df8053c16d94a740cfca40cce504bc', 'app.menu_item_price_at is the M17 definition (md5)');
select is((select h from pin_md5 where k = 'open_table'), '67ba4ca64814c325762596300e8a5c63', 'public.open_table is the M17 definition (md5)');
select is((select h from pin_md5 where k = 'update_table_session'), '9d8b58496e1f6b9ac80b8be312159bac', 'public.update_table_session is the M17 definition (md5)');
select is((select h from pin_md5 where k = 'remaining_portions'), '101983b31ef237a52ae5abd08cfc8028', 'app.remaining_portions is the M16 definition (md5, as on main 0bf2dad)');
select is((select h from pin_md5 where k = 'batch_remaining'), 'b16c44da4636334a13c472221f5a8222', 'app.batch_remaining is the M15 definition (md5, as on main)');
select is((select h from pin_md5 where k = 'batch_settle_state'), 'b61fbddb11cc1faf457785379aeee9fe', 'app.batch_settle_state is the M15 definition (md5, as on main)');
select is((select h from pin_md5 where k = 'lock_batch_rows'), '18e8a7177076048f7ecccb3eb3bb4502', 'app.lock_batch_rows is the M15 definition (md5, as on main)');
select is((select h from pin_md5 where k = 'discard_batch'), 'ca7a329aa1cc3e74f04d2afebe740c21', 'public.discard_batch is the M15 definition (md5, as on main)');
select is((select h from pin_md5 where k = 'produce_batch'), 'beb3cb1d11d08cf5093bf79fe1d4d02e', 'public.produce_batch is unchanged (md5, as 159 pins it)');
select is((select h from pin_md5 where k = 'business_date'), '150a8a67166e74c83eb14d3a48be9af6', 'app.business_date is the M15 helper (md5, as 159 pins it)');
select is((select h from pin_md5 where k = 'alert_rules_body'), '2ac38ab6a9ae5ef83ccf94d7679ec387', 'app.alert_rules_body is the M16 body (md5, as 159 pins it)');

-- The shared check constraints and the alert registry: M18 adds nothing.
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'audit_event_entity_type_check'),
  '32f535da0c689f7fa047ecd84e9ab13f', 'the audit entity-type check is the M17 list (md5): M18 adds no entity type');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'audit_event_action_check'),
  -- M18 adds no action. The value is the M17 list plus tenant.demo_data_loaded and tenant.demo_data_removed (migration
  -- 20261105100000, demo data, ADR-018), which re-creates the check as the union; the M17-only value was b4dfa112...
  'e34afece68d41c1a99baf21f7d0a51b0', 'the audit action check is the M17 list plus the two demo-data actions (md5): M18 adds no action');
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still holds 15 kinds (M18 adds none)');
select is((select string_agg(jobname, ',' order by jobname) from cron.job), 'alert-rules,auth-purge,extract-invoices,ledger-invariants', 'the set of cron jobs is unchanged (no new job)');

-- No new public function named cost, margin or price.
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname ~* '(cost|margin|price)' and p.proname <> 'plate_margins_pct'),
  'batch_costs,cost_settings,count_variance_costs,enter_fixed_costs,fixed_cost_status,ingredient_costs,plate_costs,raw_waste_costs,recipe_cost_at,recipe_costs,set_ingredient_cost_basis,update_cost_settings,waste_costs',
  'the public functions named cost, margin or price are exactly the 13 of 059');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname in ('menu_list', 'order_view', 'add_order_line', 'update_order_line', 'remove_order_line')),
  'add_order_line,menu_list,order_view,remove_order_line,update_order_line', 'the five M18 public functions exist, one each');

-- M19 replaced the stub: it counts the fired order line of a real session (the md5 pin moved to 179); no API role can execute it.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  values ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1,
          'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  values ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001',
          'Tavolo 1 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24',
          'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by)
  values ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti',
          'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  values ('e1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001',
          '11000000-0000-4000-8000-000000000001', 'antipasti', 1, 5, 10, 'menu', now(), 'a1000000-0000-4000-8000-00000000000a',
          'a1000000-0000-4000-8000-00000000000a', now(), 'a1000000-0000-4000-8000-00000000000a');
select is((select fired_lines from app.session_fired_lines('11111111-1111-4111-8111-111111111111', array['14000000-0000-4000-8000-000000000001']::uuid[])), 1,
  'since M19 the function counts the fired order line of the session (the M17 stub returned no row; replaced on purpose, pinned in 179)');
select is((select status from app.session_statuses('11111111-1111-4111-8111-111111111111', array['14000000-0000-4000-8000-000000000001']::uuid[])), 'courses_sent',
  'so the status is courses_sent (the M17 stub kept it open until M19)');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'app.session_fired_lines(uuid, uuid[])', 'execute')), 0, 'no API role can execute it');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'session_fired_lines'
              and pg_get_function_identity_arguments(p.oid) = 'p_tenant uuid, p_session_ids uuid[]'), 1, 'app.session_fired_lines(uuid, uuid[]) exists once');

select * from finish();
rollback;
