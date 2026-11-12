-- M25c step 7 (docs/plans/2026-11-01-m25c-services.md §3.2 "Not replaced", §5 step 7; ADR-031): what M25c must not touch. The md5 of prosrc of every function the plan lists as
-- "Not replaced" was taken on the merged tree before M25c (main with M25a and M25b); the built-in default is pinned to its step-1 text (changing it would re-assign the history of
-- every tenant that never saved a schedule); the shared lists and checks are the ones of main; the public tables are the M24 list plus the two service tables.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Not replaced (md5 of prosrc taken on the merged tree before M25c) -------------------------------------------------------------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'open_table' and pronamespace = 'public'::regnamespace), '1,f85ea9303f6c1be6184a940d75f4c0fe', 'public.open_table: one definition, re-pinned on purpose by reservations (A7b)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_table' and pronamespace = 'public'::regnamespace), '1,883534f4a8466e0eeef298d805c10b29', 'public.close_table: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_session_at' and pronamespace = 'app'::regnamespace), '1,845becea17ad49fb545ea34367d9a01f', 'app.close_session_at: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'table_session_guard' and pronamespace = 'app'::regnamespace), '1,8baaaca12626d00b229d3409939aaf82', 'app.table_session_guard: one definition, unchanged');
-- re-pinned on purpose by P2-0b A5 (was 31e1429659cc61dbf0322d76f4447111)
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_sales_lines' and pronamespace = 'app'::regnamespace), '1,eb43977f6869f7ac3f42c01c1639e426', 'app.kpi_sales_lines: one definition, re-pinned on purpose by P2-0b A5');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_session_rows' and pronamespace = 'app'::regnamespace), '1,e6bbe3e779a3a0f09f610bc17372c14d', 'app.kpi_session_rows: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_day_row' and pronamespace = 'app'::regnamespace), '1,eebf9baaacb29540e80d8defcdd97486', 'app.kpi_day_row: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_range_agg' and pronamespace = 'app'::regnamespace), '1,d847dbb971b541d3427fb9af955d07f9', 'app.kpi_range_agg: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_block' and pronamespace = 'app'::regnamespace), '1,e3a40678cf339abaf967741568ced94c', 'app.kpi_block: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_report_json' and pronamespace = 'app'::regnamespace), '1,ae74a1891d249fc6697080a1224bd6ae', 'app.kpi_report_json: one definition, unchanged');
-- re-pinned on purpose by P2-0b A5 (was ea89ef0b3fc1b9411dc7cbb8e42744c0)
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_items_json' and pronamespace = 'app'::regnamespace), '1,ed655aa140a1edac9da73d061b5b9f92', 'app.kpi_items_json: one definition, re-pinned on purpose by P2-0b A5');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'rollup_daily_kpi' and pronamespace = 'app'::regnamespace), '1,31c95a4a73e9fc116d212fa941939f98', 'app.rollup_daily_kpi: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'app_vs_register_json' and pronamespace = 'app'::regnamespace), '1,86f8d4a0b351affd4ad62039b1530a5c', 'app.app_vs_register_json: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'enter_day_close' and pronamespace = 'public'::regnamespace), '1,12bea6d6dc388226b5a87cf9bbe8277e', 'public.enter_day_close: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'dashboard_summary_at' and pronamespace = 'app'::regnamespace), '1,02176ec1947b9b350444bca62f470257', 'app.dashboard_summary_at: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'dashboard_summary' and pronamespace = 'public'::regnamespace), '1,3ce16815802322af2ed2ab48d1f3f818', 'public.dashboard_summary: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'forecast_json' and pronamespace = 'app'::regnamespace), '1,2c0b68813edd6b361161bf8df9dce444', 'app.forecast_json: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'tenant_has_operational_data' and pronamespace = 'app'::regnamespace), '1,c5bb9875af9aae5b14b31a062d486c83', 'app.tenant_has_operational_data: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_date' and pronamespace = 'app'::regnamespace), '1,091124d73dbb308b0915f7738e72e53c', 'app.business_date: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_day_cutoff' and pronamespace = 'app'::regnamespace), '1,fc1b2056218acfc22e97b49e39adc7a0', 'app.business_day_cutoff: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op_dispatch' and pronamespace = 'app'::regnamespace), '1,43cfcbb590e039e1990b44a341b54b62', 'app.apply_op_dispatch: one definition, unchanged');

-- The built-in default is pinned -----------------------------------------------------------------------------------------------------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'default_service_periods' and pronamespace = 'app'::regnamespace), '1,ba8c29fa4e644bbb3d140f4641a68307', 'app.default_service_periods: one definition, as written in step 1');
select is(md5(app.default_service_periods()::text), md5('[{"key": "pranzo", "name": "Pranzo", "startsAt": "11:00"}, {"key": "cena", "name": "Cena", "startsAt": "16:00"}]'::jsonb::text), 'and its value is Pranzo from 11:00 and Cena from 16:00');

-- Shared lists and checks ----------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still has 15 kinds (M25c adds none)');
select is((select md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '09b9c6302f3c9c7c4265a70f73212d40', 'and every row is unchanged');
select is((select string_agg(md5(pg_get_constraintdef(oid)), ',' order by conname::text collate "C") from pg_constraint
            where conrelid = 'public.audit_event'::regclass and conname in ('audit_event_entity_type_check', 'audit_event_action_check')),
          '411933f9b791f868814a7cfbea85f03a,72e5b28132df039351b652a126ed03a3', 'both audit_event checks re-pinned on purpose by reservations (A2); M25c itself adds no entity type and no action'); -- md5 re-pinned on purpose by P2-1 A3 (six MFA audit actions)
select is((select md5(regexp_replace(pg_get_constraintdef(oid), ', ''reservation-(mail|retention)''::text', '', 'g')) from pg_constraint where conname = 'job_run_job_check'), '9a60b99c761a655c11433a7c2121a61a', 'job_run_job_check is unchanged (M25c adds no job)');
select is((select string_agg(jobname, ',' order by jobname) from cron.job where jobname not in ('reservation-mail', 'reservation-retention')), 'alert-rules,auth-purge,extract-invoices,kpi-rollup,ledger-invariants', 'the cron jobs are unchanged (M25c adds none)');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname ~* 'cost|margin|price'),
          'batch_costs,cost_settings,count_variance_costs,enter_fixed_costs,fixed_cost_status,ingredient_costs,plate_costs,plate_margins_pct,raw_waste_costs,recipe_cost_at,recipe_costs,set_ingredient_cost_basis,update_cost_settings,waste_costs', 'the cost-named public functions are unchanged: no new name matches cost, margin or price');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc where pronamespace = 'public'::regnamespace
            and proname in ('day_services', 'kpi_services', 'service_periods', 'set_service_periods', 'set_session_service')),
          'day_services,kpi_services,service_periods,set_service_periods,set_session_service', 'the five public functions of M25c exist');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname ~* 'service' and proname not in ('mfa_reset_service_begin', 'mfa_reset_service_failed')), 5, 'and they are the only public functions with "service" in the name (P2-1''s two break-glass twins mfa_reset_service_begin and mfa_reset_service_failed, service role only, are left out on purpose)');
select is((select string_agg(tablename::text, ',' order by tablename::text collate "C") from pg_tables where schemaname = 'public'),
          'alert,app_user,applied_op,audit_event,auth_attempt,batch,batch_cost,batch_input,batch_movement,cost_centre,count_line,count_session,daily_kpi,dashboard_open,day_close,device_enrolment,dining_table,dining_table_booking,fixed_cost_period,ingredient,ingredient_cost_basis,invoice,invoice_duplicate_decision,invoice_line,kitchen_event,location,menu_item,menu_item_price,menu_push,order_line,order_line_cost,payable,price_history,raw_lot,recipe,recipe_key,recipe_line,recipe_price,reservation,reservation_contact,reservation_email,reservation_event,reservation_settings,reservation_table,sale_settings,service_override,service_schedule,staff_meal_confirmation,staff_meal_rule,staff_session,stock_movement,supplier,supplier_item,table_group,table_group_member,table_session,tenant,venue_device', 'the public tables are the M24 list plus service_override and service_schedule');
select is((select count(*)::int from pg_tables where schemaname = 'public' and tablename ~ 'service'), 2, 'and those are the only two new ones');

select * from finish();
rollback;
