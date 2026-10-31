-- Owner dashboard plan step 6 (docs/plans/2026-10-28-owner-dashboard.md §5): what the dashboard must NOT change.
--  * the functions it reads or calls are the ones from before this branch (source digests pinned; PR B's three as merged). A
--    milestone that changes one deliberately updates the digest in its own migration's test, so the change is visible;
--  * no new table (so app.demo_purge_tables() and 194 need nothing), no new alert kind, no new audit entity type or action;
--  * the cost-named public functions are unchanged (059 scans them): dashboard_summary is not cost-named.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- Pinned digests -----------------------------------------------------------------------------------------------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'today_counts' and pronamespace = 'public'::regnamespace), '1,7ff7871c5ef75b08075c58438802bb39', 'public.today_counts: one definition, unchanged (PR B''s, as merged)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'payable_is_overdue' and pronamespace = 'app'::regnamespace), '1,d2d5fa42ea79e869334b38a5b9f7b570', 'app.payable_is_overdue: one definition, unchanged (PR B''s, as merged)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'use_by_is_pending' and pronamespace = 'app'::regnamespace), '1,29438b2a51d431a7e4942bd9a53fd910', 'app.use_by_is_pending: one definition, unchanged (PR B''s, as merged)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'plate_cost_rows' and pronamespace = 'app'::regnamespace), '1,5051176976aaa0f679c57d73776f1d09', 'app.plate_cost_rows: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'plate_costs' and pronamespace = 'public'::regnamespace), '1,2c2da11e6ad92433228f873625d3debc', 'public.plate_costs: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'plate_margins_pct' and pronamespace = 'public'::regnamespace), '1,ba5647b24552e1479640bc682ad62946', 'public.plate_margins_pct: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'fixed_cost_status' and pronamespace = 'public'::regnamespace), '1,4ceabfd93d18a326859331376052f501', 'public.fixed_cost_status: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'waste_costs' and pronamespace = 'public'::regnamespace), '1,f2ffad769bef372c1fc109e53f68cc2a', 'public.waste_costs: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'raw_waste_costs' and pronamespace = 'public'::regnamespace), '1,e28c430cb29b7ab3d34fe7c1b80c9823', 'public.raw_waste_costs: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'payable_list' and pronamespace = 'public'::regnamespace), '1,3143f2862fad6a6ec076ccb5f70c6674', 'public.payable_list: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'batch_list' and pronamespace = 'public'::regnamespace), '1,7bd4160b02c0751cccaf47672d57813a', 'public.batch_list: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'stock_lots' and pronamespace = 'public'::regnamespace), '1,fac2496d69c66139d648253c839868f3', 'public.stock_lots: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'usable_on_hand' and pronamespace = 'app'::regnamespace), '1,8730662c9d7c4ade0559a379144aa66e', 'app.usable_on_hand: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'payable_reminder_rule' and pronamespace = 'app'::regnamespace), '1,caf44c21ceee8e35529d134da5147879', 'app.payable_reminder_rule: one definition, unchanged (keeps its inline 7; the dashboard''s app.payable_due_soon_days() is only a twin, pinned by the parity test)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'expiry_rule' and pronamespace = 'app'::regnamespace), '1,4b2fd5089aa5086a84a004a8ef7c6ff0', 'app.expiry_rule: one definition, unchanged');

-- No new table, kind or check -----------------------------------------------------------------------------------------------
select is((select string_agg(tablename::text, ',' order by tablename::text collate "C") from pg_tables where schemaname = 'public'),
          'alert,app_user,applied_op,audit_event,auth_attempt,batch,batch_cost,batch_input,batch_movement,cost_centre,count_line,count_session,day_close,device_enrolment,dining_table,fixed_cost_period,ingredient,ingredient_cost_basis,invoice,invoice_duplicate_decision,invoice_line,kitchen_event,location,menu_item,menu_item_price,order_line,order_line_cost,payable,price_history,raw_lot,recipe,recipe_key,recipe_line,recipe_price,sale_settings,staff_meal_confirmation,staff_meal_rule,staff_session,stock_movement,supplier,supplier_item,table_session,tenant,venue_device',
          'the public tables are those of main plus M20''s applied_op: the dashboard adds none (list updated by M20, plan step 7, by M21 for day_close, step 1, and by M19b for kitchen_event, step 1)');
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still holds 15 kinds (the dashboard adds none)');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.audit_event'::regclass and conname = 'audit_event_entity_type_check'),
          '32f535da0c689f7fa047ecd84e9ab13f', 'audit_event_entity_type_check is unchanged');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.audit_event'::regclass and conname = 'audit_event_action_check'),
          'e34afece68d41c1a99baf21f7d0a51b0', 'audit_event_action_check is unchanged');

-- Function lists (059 scans the cost-named ones) ----------------------------------------------------------------------------
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc
            where pronamespace = 'public'::regnamespace and proname ~* '(cost|margin|price)'),
          'batch_costs,cost_settings,count_variance_costs,enter_fixed_costs,fixed_cost_status,ingredient_costs,plate_costs,plate_margins_pct,raw_waste_costs,recipe_cost_at,recipe_costs,set_ingredient_cost_basis,update_cost_settings,waste_costs',
          'the cost-named public functions are unchanged (dashboard_summary is not among them)');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc
            where pronamespace = 'public'::regnamespace and proname like 'dashboard%'),
          'dashboard_summary', 'the dashboard adds exactly one public function');

select * from finish();
rollback;
