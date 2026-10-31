-- M19b steps 7 and 9 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.2, §5; ADR-024): what M19b must not touch. Step 7: kitchen_event joins the demo purge list
-- immediately before order_line_cost, so it is deleted before the order lines, the sessions and the users it references, and the list is otherwise the M21 list. Step 9: the procedures, helpers, lists and checks of M17-M21 are byte for byte what they were.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- The purge list -------------------------------------------------------------------------------------------------------------------
select is((select array_agg(n order by o) from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n <> 'kitchen_event'),
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
          'the purge list is the one M21 merged plus kitchen_event, in the same order');
select is((select count(*)::int from unnest(app.demo_purge_tables()) n where n = 'kitchen_event'), 1, 'kitchen_event is listed once');
select is((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'kitchen_event') + 1,
          (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'order_line_cost'), 'kitchen_event is listed immediately before order_line_cost');
select ok((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'kitchen_event')
        < least((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'order_line'),
                (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'table_session'),
                (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'app_user')),
        'and so before order_line, table_session and app_user, which it references');

-- What M19b must not touch (md5 of prosrc taken on the tree before M19b's migrations, i.e. main with M21 merged, 0c73030) -----------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'fire_course' and pronamespace = 'public'::regnamespace), '1,83ac74bc4f6a90819913e66747f4f6b6', 'public.fire_course: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'void_line' and pronamespace = 'public'::regnamespace), '1,5d175ff95794d3bce2b55d26491989df', 'public.void_line: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_table' and pronamespace = 'public'::regnamespace), '1,883534f4a8466e0eeef298d805c10b29', 'public.close_table: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'session_bill' and pronamespace = 'public'::regnamespace), '1,79d824714f8b3b26aa79dbb92cf48833', 'public.session_bill: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'order_view' and pronamespace = 'public'::regnamespace), '1,44a075d2755ea0a66cb585eb0fd401b0', 'public.order_view: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'tables_list' and pronamespace = 'public'::regnamespace), '1,6a5ab297e24b04040eec2141162193f7', 'public.tables_list: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op' and pronamespace = 'public'::regnamespace), '1,5b6710a9fe6eca1c7d44ae84d880db5e', 'public.apply_op: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op_dispatch' and pronamespace = 'app'::regnamespace), '1,43cfcbb590e039e1990b44a341b54b62', 'app.apply_op_dispatch: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_session_at' and pronamespace = 'app'::regnamespace), '1,845becea17ad49fb545ea34367d9a01f', 'app.close_session_at: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'order_line_json' and pronamespace = 'app'::regnamespace), '1,d83e2de4b509c0dfc2a6f8969b1941d2', 'app.order_line_json: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'order_line_guard' and pronamespace = 'app'::regnamespace), '1,0be1a328ad7b827a4292f2276950a259', 'app.order_line_guard: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'require_kitchen_reader' and pronamespace = 'app'::regnamespace), '1,8ae61ca46d37ea7e3e9178f8a7c987c4', 'app.require_kitchen_reader: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_date' and pronamespace = 'app'::regnamespace), '1,091124d73dbb308b0915f7738e72e53c', 'app.business_date: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'sync_op_kinds' and pronamespace = 'app'::regnamespace), '1,6b730013524c0b221afa005927fb092f', 'app.sync_op_kinds: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'ledger_checks_body' and pronamespace = 'app'::regnamespace), '1,cb226f12ad010a3c293dfec5220c24db', 'app.ledger_checks_body: one definition, unchanged');

-- What M19b replaces on purpose: the board read, pinned to its M19b text (changing it again is a decision, not a drive-by)
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kitchen_ticket_rows' and pronamespace = 'app'::regnamespace), '1,5d6b9927d39c5351533a5b8b5e109f5a', 'app.kitchen_ticket_rows: one definition, the M19b text');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kitchen_tickets' and pronamespace = 'public'::regnamespace), '1,a42b896d6e92d4cf2fa224c3e010e2e4', 'public.kitchen_tickets: one definition, the M19b text');

-- Kitchen marks are not offline ops (AT12), nothing else is added to the check constraints or the registries ------------------------------------
select is((select app.sync_op_kinds()), array['open_table', 'add_line', 'edit_line', 'remove_line', 'fire', 'void_line']::text[], 'AT12: app.sync_op_kinds() is still the six of M20: kitchen writes are not op kinds');
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still holds 15 kinds');
select is((select md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '09b9c6302f3c9c7c4265a70f73212d40', 'and every row is the one before M19b (md5)');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.audit_event'::regclass and conname = 'audit_event_entity_type_check'),
          '32f535da0c689f7fa047ecd84e9ab13f', 'audit_event_entity_type_check is unchanged');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.audit_event'::regclass and conname = 'audit_event_action_check'),
          'e34afece68d41c1a99baf21f7d0a51b0', 'audit_event_action_check is unchanged');

-- New objects --------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(tablename::text, ',' order by tablename::text collate "C") from pg_tables where schemaname = 'public'),
          'alert,app_user,applied_op,audit_event,auth_attempt,batch,batch_cost,batch_input,batch_movement,cost_centre,count_line,count_session,day_close,device_enrolment,dining_table,fixed_cost_period,ingredient,ingredient_cost_basis,invoice,invoice_duplicate_decision,invoice_line,kitchen_event,location,menu_item,menu_item_price,order_line,order_line_cost,payable,price_history,raw_lot,recipe,recipe_key,recipe_line,recipe_price,sale_settings,staff_meal_confirmation,staff_meal_rule,staff_session,stock_movement,supplier,supplier_item,table_session,tenant,venue_device',
          'the public tables are those of M21 plus kitchen_event');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('kitchen_mark_line', 'kitchen_set_ticket')),
          'kitchen_mark_line,kitchen_set_ticket', 'the public functions M19b adds are kitchen_mark_line and kitchen_set_ticket');
select is((select md5(string_agg(proname::text, ',' order by proname::text collate "C")) from pg_proc
            where pronamespace = 'public'::regnamespace and proname not in ('kitchen_mark_line', 'kitchen_set_ticket')), '88008d44fe26ffc8ca1de35dc7a1a74e',
          'and the other public functions are exactly those of M21 (md5 of the sorted names)');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc
            where pronamespace = 'app'::regnamespace and proname like 'kitchen%' and proname not in ('kitchen_ticket_rows')),
          'kitchen_board_json,kitchen_line_done,kitchen_ticket_key,kitchen_ticket_lock,kitchen_ticket_open_lines,kitchen_ticket_state', 'and the app helpers M19b adds are the six of step 2 and the board json');
select is((select count(*)::int from pg_proc where pronamespace = 'app'::regnamespace and proname = 'require_kitchen_marker'), 1, 'plus app.require_kitchen_marker');

select * from finish();
rollback;
