-- M22 step 9 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2 "Not replaced", §5; ADR-025): what M22 must not touch. The md5 of the source of every function below is the one on main 0c73030 (M0-M21), taken
-- with pg_proc.prosrc as pgTAP 222 does. The five functions M22 replaces on purpose are not here: app.plates_sold (pinned to its M22 text by 179), app.tenant_has_operational_data,
-- app.job_health_checks, app.demo_purge_tables and public.dashboard_summary (pinned below to their M22 shape). The alert registry and both audit_event checks are unchanged: M22 adds no
-- audit entity type, no audit action and no alert kind. tests/config/m22-preserves.test.ts is the cheaper early check on the SQL text of the M22 migrations.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- The purge list --------------------------------------------------------------------------------------------------------------------
select is((select array_agg(n order by o) from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n not in ('daily_kpi', 'dashboard_open', 'menu_push')),
          array['alert', 'audit_event',
                'staff_meal_confirmation', 'staff_meal_rule', 'batch_cost', 'batch_movement', 'batch_input', 'batch',
                'count_line', 'count_session', 'stock_movement', 'raw_lot',
                'price_history', 'payable', 'invoice_duplicate_decision', 'invoice_line', 'invoice',
                'ingredient_cost_basis', 'fixed_cost_period',
                'applied_op', 'kitchen_event', 'order_line_cost', 'order_line', 'table_session', 'dining_table', 'sale_settings', 'menu_item_price', 'menu_item',
                'recipe_price', 'recipe_line', 'recipe', 'recipe_key',
                'supplier_item', 'supplier', 'ingredient', 'location', 'cost_centre',
                'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment',
                'day_close',
                'app_user', 'tenant'],
          'the purge list is the one main (M21, then M19b''s kitchen_event) merged, minus daily_kpi and dashboard_open (and M23''s menu_push, step 1), in the same order');
select is((select count(*)::int from unnest(app.demo_purge_tables()) n where n in ('daily_kpi', 'dashboard_open')), 2, 'each of the two new tables is listed once');
select ok((select max(o) from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n in ('daily_kpi', 'dashboard_open'))
        < (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'app_user'), 'both come before app_user, which dashboard_open references');
select ok((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'day_close')
        < (select min(o) from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n in ('daily_kpi', 'dashboard_open')), 'and they follow day_close (M21)');

-- What M22 must not touch (md5 of prosrc taken on main 0c73030) -------------------------------------------------------------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'app_vs_register_json' and pronamespace = 'app'::regnamespace), '1,86f8d4a0b351affd4ad62039b1530a5c', 'app.app_vs_register_json: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'batch_requirements' and pronamespace = 'app'::regnamespace), '1,8aedb69bd2228232b512c72737038c77', 'app.batch_requirements: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_date' and pronamespace = 'app'::regnamespace), '1,091124d73dbb308b0915f7738e72e53c', 'app.business_date: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_session_at' and pronamespace = 'app'::regnamespace), '1,845becea17ad49fb545ea34367d9a01f', 'app.close_session_at: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'fixed_cost_at' and pronamespace = 'app'::regnamespace), '1,c9ab5b744d2fe7ba7103046cfc3fba8a', 'app.fixed_cost_at: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'freeze_line_cost' and pronamespace = 'app'::regnamespace), '1,0971d2a494e4c2d2f5603c9e60366ad9', 'app.freeze_line_cost: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'ledger_checks_body' and pronamespace = 'app'::regnamespace), '1,cb226f12ad010a3c293dfec5220c24db', 'app.ledger_checks_body: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'local_instant' and pronamespace = 'app'::regnamespace), '1,df6ae680e15686e2a0417bc186ce97d3', 'app.local_instant: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'next_cutoff' and pronamespace = 'app'::regnamespace), '1,3a41011c8b090bf45e61cf70f9da8296', 'app.next_cutoff: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'plate_cost_rows' and pronamespace = 'app'::regnamespace), '1,5051176976aaa0f679c57d73776f1d09', 'app.plate_cost_rows: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'session_bill_json' and pronamespace = 'app'::regnamespace), '1,cdab6e4573752bcae8c90612e386f9c4', 'app.session_bill_json: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_table' and pronamespace = 'public'::regnamespace), '1,883534f4a8466e0eeef298d805c10b29', 'public.close_table: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'count_variance' and pronamespace = 'public'::regnamespace), '1,fd9c6cfd0dc7a7d6633c40ec955233d4', 'public.count_variance: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'count_variance_costs' and pronamespace = 'public'::regnamespace), '1,7b9c074dc2a535fcf529374ab4d4478c', 'public.count_variance_costs: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'fire_course' and pronamespace = 'public'::regnamespace), '1,83ac74bc4f6a90819913e66747f4f6b6', 'public.fire_course: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'stock_reconciliation' and pronamespace = 'public'::regnamespace), '1,a7545efb367138a699b9b4fd9a52a1f4', 'public.stock_reconciliation: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'today_counts' and pronamespace = 'public'::regnamespace), '1,7ff7871c5ef75b08075c58438802bb39', 'public.today_counts: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'void_line' and pronamespace = 'public'::regnamespace), '1,5d175ff95794d3bce2b55d26491989df', 'public.void_line: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'waste_costs' and pronamespace = 'public'::regnamespace), '1,f2ffad769bef372c1fc109e53f68cc2a', 'public.waste_costs: one definition, unchanged');

-- Shared lists and checks ----------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still has 15 kinds (M22 adds none)');
select is((select md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '09b9c6302f3c9c7c4265a70f73212d40', 'and every row is unchanged');
select is((select string_agg(md5(pg_get_constraintdef(oid)), ',' order by conname::text collate "C") from pg_constraint
            where conrelid = 'public.audit_event'::regclass and conname in ('audit_event_entity_type_check', 'audit_event_action_check')),
          'e34afece68d41c1a99baf21f7d0a51b0,32f535da0c689f7fa047ecd84e9ab13f', 'both audit_event checks are unchanged (M22 adds no entity type and no action)');
select is((select string_agg(jobname, ',' order by jobname) from cron.job), 'alert-rules,auth-purge,extract-invoices,kpi-rollup,ledger-invariants', 'the cron jobs are main''s four plus kpi-rollup');

-- The five replaced functions keep their name and signature ----------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc where proname = 'dashboard_summary' and pronamespace = 'public'::regnamespace and pronargs = 0), 1, 'public.dashboard_summary(): one definition, no argument');
select is((select count(*)::int from pg_proc where proname = 'job_health_checks' and pronamespace = 'app'::regnamespace), 1, 'app.job_health_checks: one definition');
select is((select count(*)::int from pg_proc where proname = 'tenant_has_operational_data' and pronamespace = 'app'::regnamespace), 1, 'app.tenant_has_operational_data: one definition');
select is((select count(*)::int from pg_proc where proname = 'plates_sold' and pronamespace = 'app'::regnamespace), 1, 'app.plates_sold: one definition');

select * from finish();
rollback;
