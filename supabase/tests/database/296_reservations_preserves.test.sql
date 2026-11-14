-- Reservations A7 (docs/plans/2026-11-08-reservations.md §3.2 "Unchanged on purpose", §5 A7; ADR-032): what PR1 must not touch. The md5 of prosrc of every function the plan lists as
-- unchanged was taken on the merged tree before PR1 (main with M25c, A5 and the cron fix); the cron jobs, the alert registry and the job check are those of main; PR1 grants nothing to anon;
-- the audit checks are pinned to their A2 text (the one deliberate change); the public tables are the M25c list plus the nine of A1.
-- public.open_table and public.tables_list are pinned in their A7b form (re-pinned on purpose): the founder's Q-R6 answer (joined tables) replaces both in 20261124100650.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Not replaced (md5 of prosrc taken on the merged tree before PR1) ------------------------------------------------------------------------------------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_table' and pronamespace = 'public'::regnamespace), '1,883534f4a8466e0eeef298d805c10b29', 'public.close_table: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_session_at' and pronamespace = 'app'::regnamespace), '1,845becea17ad49fb545ea34367d9a01f', 'app.close_session_at: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'table_session_guard' and pronamespace = 'app'::regnamespace), '1,8baaaca12626d00b229d3409939aaf82', 'app.table_session_guard: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'session_services' and pronamespace = 'app'::regnamespace), '1,2d51f85415887d0858bd9b1ce75b6c1b', 'app.session_services: one definition, unchanged (a seated reservation is an ordinary session)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'session_service_one' and pronamespace = 'app'::regnamespace), '1,02d12b5ca3259dcdd01f08b8f18dab0e', 'app.session_service_one: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_service_split' and pronamespace = 'app'::regnamespace), '1,b66dbeb720b0dfed3c663e72e5b67461', 'app.kpi_service_split: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'app_vs_register_json' and pronamespace = 'app'::regnamespace), '1,86f8d4a0b351affd4ad62039b1530a5c', 'app.app_vs_register_json: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'enter_day_close' and pronamespace = 'public'::regnamespace), '1,12bea6d6dc388226b5a87cf9bbe8277e', 'public.enter_day_close: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'rollup_daily_kpi' and pronamespace = 'app'::regnamespace), '1,31c95a4a73e9fc116d212fa941939f98', 'app.rollup_daily_kpi: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op_dispatch' and pronamespace = 'app'::regnamespace), '1,43cfcbb590e039e1990b44a341b54b62', 'app.apply_op_dispatch: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op' and pronamespace = 'public'::regnamespace), '1,5b6710a9fe6eca1c7d44ae84d880db5e', 'public.apply_op: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'default_service_periods' and pronamespace = 'app'::regnamespace), '1,ba8c29fa4e644bbb3d140f4641a68307', 'app.default_service_periods: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_date' and pronamespace = 'app'::regnamespace), '1,091124d73dbb308b0915f7738e72e53c', 'app.business_date: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_day_cutoff' and pronamespace = 'app'::regnamespace), '1,fc1b2056218acfc22e97b49e39adc7a0', 'app.business_day_cutoff: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'tenant_has_operational_data' and pronamespace = 'app'::regnamespace), '1,c5bb9875af9aae5b14b31a062d486c83', 'app.tenant_has_operational_data: one definition, unchanged (saved settings count as data through the purge list)');
select is((select count(*)::int from pg_proc where proname = 'purge_demo_data_core' and pronamespace = 'app'::regnamespace), 1, 'app.purge_demo_data_core: one definition (it reads the purge list, it is not replaced)');

-- open_table and tables_list: replaced on purpose by A7b (founder Q-R6, joined tables); the pins are the A7b bodies, 296b proves the behaviour ------------------------------------------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'open_table' and pronamespace = 'public'::regnamespace), '1,f85ea9303f6c1be6184a940d75f4c0fe', 'public.open_table: one definition, re-pinned on purpose to the A7b text (adds table_joined, Q-R6; pgTAP 296b proves the behaviour)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'tables_list' and pronamespace = 'public'::regnamespace), '1,f9dc48f18477964c93416dcc1f9cfdbe', 'public.tables_list: one definition, re-pinned on purpose to the A7b text (adds the joined status and joinedTo.overtime for the booking seated on the lead''s open session, lead 2026-11-08; re-pinned again on purpose after review; pgTAP 296b proves the behaviour)');

-- Shared lists and checks ------------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still has 15 kinds (PR1 adds none)');
select is((select md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '09b9c6302f3c9c7c4265a70f73212d40', 'and every row is unchanged');
select is((select string_agg(jobname, ',' order by jobname) from cron.job where jobname not in ('reservation-mail', 'reservation-retention', 'mfa-failure-retention')), 'alert-rules,auth-purge,extract-invoices,kpi-rollup,ledger-invariants', 'the cron jobs of main are unchanged (PR1 adds none; PR2''s two are pinned in 299, 300 and 301)');
select is((select md5(regexp_replace(pg_get_constraintdef(oid), ', ''(reservation-(mail|retention)|mfa-failure-retention)''::text', '', 'g')) from pg_constraint where conname = 'job_run_job_check'), '9a60b99c761a655c11433a7c2121a61a', 'job_run_job_check is the PR1 list: PR2 only appends reservation-mail and reservation-retention (pinned in 299 and 300)');
select is((select string_agg(md5(pg_get_constraintdef(oid)), ',' order by conname::text collate "C") from pg_constraint
            where conrelid = 'public.audit_event'::regclass and conname in ('audit_event_entity_type_check', 'audit_event_action_check')),
          '014e2adc1b25094e2196b7f889851fef,72e5b28132df039351b652a126ed03a3', 'the two audit checks are the A2 text: the M25c lists plus reservation_settings and reservation_settings.changed'); -- md5 re-pinned on purpose by P2-1 A3 (six MFA audit actions)
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname ~* 'cost|margin|price'), 14, 'the cost-named public functions are unchanged: no new name matches cost, margin or price');
select is((select string_agg(tablename::text, ',' order by tablename::text collate "C") from pg_tables where schemaname = 'public'),
          'alert,app_user,applied_op,audit_event,auth_attempt,batch,batch_cost,batch_input,batch_movement,cost_centre,count_line,count_session,daily_kpi,dashboard_open,day_close,device_enrolment,dining_table,dining_table_booking,fixed_cost_period,ingredient,ingredient_cost_basis,invoice,invoice_duplicate_decision,invoice_line,invoice_vat_summary,kitchen_event,location,menu_item,menu_item_price,menu_push,order_line,order_line_cost,payable,price_history,raw_lot,recipe,recipe_key,recipe_line,recipe_price,reservation,reservation_contact,reservation_email,reservation_event,reservation_settings,reservation_table,sale_settings,service_override,service_schedule,staff_meal_confirmation,staff_meal_rule,staff_session,stock_movement,supplier,supplier_item,table_group,table_group_member,table_session,tenant,venue_device',
          'the public tables are the M25c list plus the nine reservation tables');
select is((select count(*)::int from pg_tables where schemaname = 'public' and tablename ~ 'reservation|table_group|dining_table_booking'), 9, 'and those are the only nine new ones');
select is((select cardinality(app.demo_purge_tables())), 59, 'the purge list holds 59 names (58 and invoice_vat_summary, P2-7 S3, changed on purpose)');

-- PR1 grants nothing to anon, and no table privilege to any API role beyond select ------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ 'reserv|table_group|table_booking|staff_reservation'
            and p.proname not in ('reservation_page', 'reservation_slots', 'request_reservation', 'reservation_cancel_view', 'cancel_reservation') and has_function_privilege('anon', p.oid, 'execute')), 0,
          'no reservation function of PR1 in public is executable by anon (the anon wrappers are PR2''s own, listed here by name and pinned in 297 and 301)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ 'reserv|table_group|table_booking|staff_reservation' and p.proname not in ('reservation_mail_claim', 'reservation_mail_finish') and has_function_privilege('service_role', p.oid, 'execute')), 0, 'nor by service_role (PR2''s mail claim and finish are service_role only, pinned in 299)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ 'reserv|table_group|table_booking|staff_reservation' and has_function_privilege('authenticated', p.oid, 'execute')), 19,
          'the 18 staff functions of PR1 (A2: 6, A5: 7, A5b: 1, A6: 3, A7b: split_reservation_tables 1) plus P2-2 S6''s booked-covers function (counts only, chef included) are executable by authenticated');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and (p.proname ~ 'reserv|table_group|table_booking|staff_reservation|request_invalid')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'no app function of the feature is executable by an API role');
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.proname ~ 'reserv|table_group|table_booking|staff_reservation|request_invalid' and not p.prosecdef), 0, 'every function of the feature is a definer');
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.proname ~ 'reserv|table_group|table_booking|staff_reservation|request_invalid' and not coalesce(p.proconfig @> array['search_path=""'], false)), 0, 'with an empty search_path');

select * from finish();
rollback;
