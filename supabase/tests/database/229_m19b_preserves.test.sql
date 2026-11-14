-- M19b steps 7 and 9 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.2, §5; ADR-024): what M19b must not touch. Step 7: kitchen_event joins the demo purge list
-- immediately before order_line_cost, so it is deleted before the order lines, the sessions and the users it references, and the list is otherwise the M21 list. Step 9: the procedures, helpers, lists and checks of M17-M21 are byte for byte what they were.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- The purge list -------------------------------------------------------------------------------------------------------------------
select is((select array_agg(n order by o) from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n not in ('kitchen_event', 'daily_kpi', 'dashboard_open', 'menu_push', 'service_override', 'service_schedule', 'reservation_email', 'reservation_event', 'reservation_table', 'reservation_contact', 'reservation', 'table_group_member', 'table_group', 'dining_table_booking', 'reservation_settings')),
          array['alert', 'audit_event',
                'staff_meal_confirmation', 'staff_meal_rule', 'batch_cost', 'batch_movement', 'batch_input', 'batch',
                'count_line', 'count_session', 'stock_movement', 'raw_lot',
                'price_history', 'payable', 'invoice_duplicate_decision', 'invoice_line', 'invoice',
                'ingredient_cost_basis', 'fixed_cost_period',
                'applied_op', 'order_line_cost', 'order_line', 'table_session', 'dining_table', 'sale_settings', 'menu_item_price', 'menu_item',
                'recipe_price', 'recipe_line', 'recipe', 'recipe_key',
                'supplier_item', 'supplier', 'ingredient', 'location', 'cost_centre',
                'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment',
                'day_close',
                'app_user', 'tenant'],
          'the purge list is the one M21 merged plus kitchen_event, in the same order (M22''s daily_kpi and dashboard_open are left out: M22 merge; M23''s menu_push too, step 1; M25c''s service_override and service_schedule too, step 1), and the nine reservation tables of the reservations feature (A1)');
select is((select count(*)::int from unnest(app.demo_purge_tables()) n where n = 'kitchen_event'), 1, 'kitchen_event is listed once');
select is((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'kitchen_event') + 1,
          (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'order_line_cost'), 'kitchen_event is listed immediately before order_line_cost');
select ok((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'kitchen_event')
        < least((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'order_line'),
                (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'table_session'),
                (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'app_user')),
        'and so before order_line, table_session and app_user, which it references');

-- What M19b must not touch (md5 of prosrc taken on the tree before M19b's migrations, i.e. main with M21 merged, 0c73030) -----------------------
-- re-pinned on purpose by P2-0b A4 (was 83ac74bc4f6a90819913e66747f4f6b6)
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'fire_course' and pronamespace = 'public'::regnamespace), '1,da02adc28182bd691664b5d890339b6d', 'public.fire_course: one definition, re-pinned on purpose by P2-0b A4');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'void_line' and pronamespace = 'public'::regnamespace), '1,5d175ff95794d3bce2b55d26491989df', 'public.void_line: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_table' and pronamespace = 'public'::regnamespace), '1,883534f4a8466e0eeef298d805c10b29', 'public.close_table: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'session_bill' and pronamespace = 'public'::regnamespace), '1,79d824714f8b3b26aa79dbb92cf48833', 'public.session_bill: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'order_view' and pronamespace = 'public'::regnamespace), '1,44a075d2755ea0a66cb585eb0fd401b0', 'public.order_view: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'tables_list' and pronamespace = 'public'::regnamespace), '1,f9dc48f18477964c93416dcc1f9cfdbe', 'public.tables_list: one definition, re-pinned on purpose by reservations (A7b, joinedTo.overtime limited to the booking seated on the lead''s open session)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op' and pronamespace = 'public'::regnamespace), '1,5b6710a9fe6eca1c7d44ae84d880db5e', 'public.apply_op: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op_dispatch' and pronamespace = 'app'::regnamespace), '1,43cfcbb590e039e1990b44a341b54b62', 'app.apply_op_dispatch: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_session_at' and pronamespace = 'app'::regnamespace), '1,845becea17ad49fb545ea34367d9a01f', 'app.close_session_at: one definition, unchanged');
-- order_line_json: re-pinned on purpose by P2-0b A3 (the value below is its definition after that step)
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'order_line_json' and pronamespace = 'app'::regnamespace), '1,43d4be8ca3857ea169503ac63ea1b78f', 'app.order_line_json: one definition, re-pinned on purpose by P2-0b A3');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'order_line_guard' and pronamespace = 'app'::regnamespace), '1,8565b2a85167dc17b683b10c6ed05154', 'app.order_line_guard: one definition, re-pinned on purpose by P2-0b A1 (was 0be1a328ad7b827a4292f2276950a259)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'require_kitchen_reader' and pronamespace = 'app'::regnamespace), '1,8ae61ca46d37ea7e3e9178f8a7c987c4', 'app.require_kitchen_reader: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_date' and pronamespace = 'app'::regnamespace), '1,091124d73dbb308b0915f7738e72e53c', 'app.business_date: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'sync_op_kinds' and pronamespace = 'app'::regnamespace), '1,6b730013524c0b221afa005927fb092f', 'app.sync_op_kinds: one definition, unchanged');
-- re-pinned on purpose by P2-0b A4 (was cb226f12ad010a3c293dfec5220c24db)
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'ledger_checks_body' and pronamespace = 'app'::regnamespace), '1,f6d517a90ca6c7c359374ee0d7d7b170', 'app.ledger_checks_body: one definition, re-pinned on purpose by P2-0b A4');

-- What M19b replaces on purpose: the board read, pinned to its M19b text (changing it again is a decision, not a drive-by)
-- re-pinned on purpose by P2-0b A5 (was 5d6b9927d39c5351533a5b8b5e109f5a)
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kitchen_ticket_rows' and pronamespace = 'app'::regnamespace), '1,962c2144f46fbc972931a5b5190589c4', 'app.kitchen_ticket_rows: one definition, re-pinned on purpose by P2-0b A5');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kitchen_tickets' and pronamespace = 'public'::regnamespace), '1,a42b896d6e92d4cf2fa224c3e010e2e4', 'public.kitchen_tickets: one definition, the M19b text');

-- Kitchen marks are not offline ops (AT12), nothing else is added to the check constraints or the registries ------------------------------------
select is((select app.sync_op_kinds()), array['open_table', 'add_line', 'edit_line', 'remove_line', 'fire', 'void_line']::text[], 'AT12: app.sync_op_kinds() is still the six of M20: kitchen writes are not op kinds');
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still holds 15 kinds');
select is((select md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '09b9c6302f3c9c7c4265a70f73212d40', 'and every row is the one before M19b (md5)');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.audit_event'::regclass and conname = 'audit_event_entity_type_check'),
          '72e5b28132df039351b652a126ed03a3', 'audit_event_entity_type_check re-pinned on purpose by reservations (A2)');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.audit_event'::regclass and conname = 'audit_event_action_check'),
          'd36b8fd905268f5673e99e9379f43cd5', 'audit_event_action_check re-pinned on purpose by reservations (A2)'); -- md5 re-pinned on purpose by P2-1 A3 (six MFA audit actions)

-- New objects --------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(tablename::text, ',' order by tablename::text collate "C") from pg_tables where schemaname = 'public'),
          'alert,app_user,applied_op,audit_event,auth_attempt,batch,batch_cost,batch_input,batch_movement,cost_centre,count_line,count_session,daily_kpi,dashboard_open,day_close,device_enrolment,dining_table,dining_table_booking,fixed_cost_period,ingredient,ingredient_cost_basis,invoice,invoice_duplicate_decision,invoice_line,kitchen_event,location,menu_item,menu_item_price,menu_push,order_line,order_line_cost,payable,price_history,raw_lot,recipe,recipe_key,recipe_line,recipe_price,reservation,reservation_contact,reservation_email,reservation_event,reservation_settings,reservation_table,sale_settings,service_override,service_schedule,staff_meal_confirmation,staff_meal_rule,staff_session,stock_movement,supplier,supplier_item,table_group,table_group_member,table_session,tenant,venue_device',
          'the public tables are those of M21 plus kitchen_event (and M22''s daily_kpi and dashboard_open: M22 merge; M23''s menu_push, step 1)');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('kitchen_mark_line', 'kitchen_set_ticket')),
          'kitchen_mark_line,kitchen_set_ticket', 'the public functions M19b adds are kitchen_mark_line and kitchen_set_ticket');
select is((select md5(string_agg(proname::text, ',' order by proname::text collate "C")) from pg_proc
            where pronamespace = 'public'::regnamespace
              and proname not in ('finish_pin_change', 'mfa_accounts', 'set_mfa_enforcement', 'mfa_reset_service_begin', 'mfa_reset_service_failed', 'mfa_gate', 'mfa_status', 'mfa_attempt_allowed', 'mfa_record_failure', 'mfa_enrol_check', 'mfa_record_enrolled', 'mfa_unenrol_check', 'mfa_record_unenrolled', 'weight_settings', 'set_weight_settings', 'kitchen_mark_line', 'kitchen_set_ticket', 'avt_report', 'kpi_items', 'kpi_report', 'record_dashboard_open', 'unmapped_items', 'push_menu_item', 'push_list', 'forecast', 'discards_vs_push', 'business_date_of', 'kpi_services', 'day_services', 'service_periods', 'set_service_periods', 'set_session_service', 'reservation_settings', 'set_reservation_settings', 'table_booking', 'set_table_booking', 'create_table_group', 'deactivate_table_group', 'accept_reservation', 'decline_reservation', 'move_reservation', 'assign_reservation_tables', 'mark_reservation', 'seat_reservation', 'erase_reservation_contact', 'create_staff_reservation', 'reservations_day', 'reservation_detail', 'reservations_pending_count', 'split_reservation_tables', 'reservation_page', 'reservation_slots', 'request_reservation', 'reservation_cancel_view', 'cancel_reservation', 'reservation_mail_claim', 'reservation_mail_finish', 'trace_lot_search', 'lot_capture', 'trace_lot')),
          '88008d44fe26ffc8ca1de35dc7a1a74e',
          'and the other public functions are exactly those of M21 (md5 of the sorted names; the five M22 adds are left out: M22 merge; M23''s push_menu_item, push_list, forecast and discards_vs_push too, steps 2 to 5; A5''s business_date_of, the waste-costs default range; M25c''s five service functions, steps 3 to 5; the reservations feature''s public functions, A2 on; P2-0b A2''s weight_settings and set_weight_settings, added to the list on purpose; P2-2''s trace functions, added on purpose as each step lands)');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc
            where pronamespace = 'app'::regnamespace and proname like 'kitchen%' and proname not in ('kitchen_ticket_rows')),
          'kitchen_board_json,kitchen_line_done,kitchen_ticket_key,kitchen_ticket_lock,kitchen_ticket_open_lines,kitchen_ticket_state', 'and the app helpers M19b adds are the six of step 2 and the board json');
select is((select count(*)::int from pg_proc where pronamespace = 'app'::regnamespace and proname = 'require_kitchen_marker'), 1, 'plus app.require_kitchen_marker');

select * from finish();
rollback;
