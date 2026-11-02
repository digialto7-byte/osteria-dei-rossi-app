-- M23 step 8 (docs/plans/2026-10-31-m23-push-forecast.md §3.2 "Not replaced", §5; ADR-026): what M23 must not touch. The md5 of the source of every function below is the one on the
-- M22 head 4f77afb (M23 re-creates none of them; the two it replaces on purpose are pinned by their own tests: app.dashboard_summary_at by 253, app.demo_purge_tables by 248 and
-- the preserve tests). The alert registry, both audit_event checks, the cron jobs, the job_run check and the menu_item push check are unchanged: M23 adds no audit entity type,
-- no audit action, no alert kind and no job. tests/config/m23-preserves.test.ts is the cheaper early check on the SQL text of the M23 migrations.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- The functions M23 reads or sits next to (md5 of prosrc taken on 4f77afb) ----------------------------------------------------------------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'expiry_rule' and pronamespace = 'app'::regnamespace), '1,4b2fd5089aa5086a84a004a8ef7c6ff0', 'app.expiry_rule: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'expiry_state' and pronamespace = 'app'::regnamespace), '1,16d9b8a59d25dc8260af585e65483c10', 'app.expiry_state: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_cutoff_end' and pronamespace = 'app'::regnamespace), '1,50b8df0dae218aaba51dfd61079fdec3', 'app.kpi_cutoff_end: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_sales_lines' and pronamespace = 'app'::regnamespace), '1,31e1429659cc61dbf0322d76f4447111', 'app.kpi_sales_lines: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_session_rows' and pronamespace = 'app'::regnamespace), '1,e6bbe3e779a3a0f09f610bc17372c14d', 'app.kpi_session_rows: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'live_batch_remaining' and pronamespace = 'app'::regnamespace), '1,8d80fb0a1d4541d57ac18637a1909927', 'app.live_batch_remaining: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'menu_item_availability' and pronamespace = 'app'::regnamespace), '1,2efc6df145a1c19d1bb43e004e03bdd5', 'app.menu_item_availability: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'menu_item_price_at' and pronamespace = 'app'::regnamespace), '1,baacb222b69403f7d69b02b960218533', 'app.menu_item_price_at: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'menu_items_json' and pronamespace = 'app'::regnamespace), '1,6369f2e3641ee83e2244a9c0d46abf0e', 'app.menu_items_json: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'menu_keys_ok' and pronamespace = 'app'::regnamespace), '1,c5b370a2f51f72901fe3649f0045584f', 'app.menu_keys_ok: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'menu_price' and pronamespace = 'app'::regnamespace), '1,aa8a8ce5c763f1ba5a23bbf9a4d6ed6a', 'app.menu_price: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'plate_batch_needs' and pronamespace = 'app'::regnamespace), '1,d0cb9ef21369cb3fddfc099325d37bb0', 'app.plate_batch_needs: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'plate_raw_needs' and pronamespace = 'app'::regnamespace), '1,f9263b4a8ccd2a8973dc02a75aafd2ec', 'app.plate_raw_needs: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'require_day_closer' and pronamespace = 'app'::regnamespace), '1,a6f7916607b7c3a1e00e0b156857d111', 'app.require_day_closer: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'require_menu_writer' and pronamespace = 'app'::regnamespace), '1,a47b8fcbbcd5e391b1909d4ed5bc2f2e', 'app.require_menu_writer: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'rollup_daily_kpi' and pronamespace = 'app'::regnamespace), '1,31c95a4a73e9fc116d212fa941939f98', 'app.rollup_daily_kpi: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'use_by_state' and pronamespace = 'app'::regnamespace), '1,df4a315792f84f6651b9485657974fa3', 'app.use_by_state: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'add_order_line' and pronamespace = 'public'::regnamespace), '1,1ab3d828bef1a8bf7f1df7309201fd15', 'public.add_order_line: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'dashboard_summary' and pronamespace = 'public'::regnamespace), '1,3ce16815802322af2ed2ab48d1f3f818', 'public.dashboard_summary: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'discard_batch' and pronamespace = 'public'::regnamespace), '1,ba14c526df29bf262fac470ab11ba219', 'public.discard_batch: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'fire_course' and pronamespace = 'public'::regnamespace), '1,83ac74bc4f6a90819913e66747f4f6b6', 'public.fire_course: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'menu_list' and pronamespace = 'public'::regnamespace), '1,b7b31bb221c91c60606ef99ea42ad92a', 'public.menu_list: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'update_menu_item' and pronamespace = 'public'::regnamespace), '1,620476a8b73c10d84a672d1e223f6f5f', 'public.update_menu_item: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'void_line' and pronamespace = 'public'::regnamespace), '1,5d175ff95794d3bce2b55d26491989df', 'public.void_line: one definition, unchanged');
-- A5 (20261117100000_batch_movement_business_date.sql): waste_costs was replaced on purpose, its batch side now counts by the business day of created_at. The pin is the new definition (pgTAP 257 proves the behaviour).
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'waste_costs' and pronamespace = 'public'::regnamespace), '1,f10d3bc1b843fd4237fb21d5ee63a301', 'public.waste_costs: one definition, unchanged');

-- Shared lists and checks ----------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still has 15 kinds (M23 adds none)');
select is((select md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '09b9c6302f3c9c7c4265a70f73212d40', 'and every row is unchanged');
select is((select string_agg(md5(pg_get_constraintdef(oid)), ',' order by conname::text collate "C") from pg_constraint
            where conrelid = 'public.audit_event'::regclass and conname in ('audit_event_entity_type_check', 'audit_event_action_check')),
          'e34afece68d41c1a99baf21f7d0a51b0,32f535da0c689f7fa047ecd84e9ab13f', 'both audit_event checks are unchanged (M23 adds no entity type and no action)');
select is((select string_agg(jobname, ',' order by jobname) from cron.job), 'alert-rules,auth-purge,extract-invoices,kpi-rollup,ledger-invariants', 'the cron jobs are unchanged: M23 adds no job');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'job_run_job_check'), '9a60b99c761a655c11433a7c2121a61a', 'the job_run job check is unchanged');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'menu_item_push_ck'), '3d3692eebaf2da87c39e180a613b30ac', 'menu_item_push_ck is unchanged (no price without an end)');
select is((select count(*)::int from pg_proc where proname = 'dashboard_summary' and pronamespace = 'public'::regnamespace and pronargs = 0), 1, 'public.dashboard_summary(): one definition, no argument');
select is((select count(*)::int from pg_proc where proname = 'dashboard_summary_at' and pronamespace = 'app'::regnamespace), 1, 'app.dashboard_summary_at: one definition (M23 replaced it with create or replace)');
select is((select count(*)::int from pg_proc where proname = 'demo_purge_tables' and pronamespace = 'app'::regnamespace), 1, 'app.demo_purge_tables: one definition');

select * from finish();
rollback;
