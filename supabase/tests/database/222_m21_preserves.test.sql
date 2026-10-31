-- M21 steps 7 and 9 (docs/plans/2026-10-30-m21-bill-close.md §3.2, §5; ADR-023): what M21 must not touch. Step 7: day_close joins the demo purge list
-- before app_user and the M20 list is otherwise unchanged. Step 9: the procedures, helpers, lists and checks of M17-M20 are byte for byte what they were.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- The purge list -------------------------------------------------------------------------------------------------------------------
select is((select array_agg(n order by o) from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n <> 'day_close'),
          array['alert', 'audit_event',
                'staff_meal_confirmation', 'staff_meal_rule', 'batch_cost', 'batch_movement', 'batch_input', 'batch',
                'count_line', 'count_session', 'stock_movement', 'raw_lot',
                'price_history', 'payable', 'invoice_duplicate_decision', 'invoice_line', 'invoice',
                'ingredient_cost_basis', 'fixed_cost_period',
                'applied_op', 'order_line_cost', 'order_line', 'table_session', 'dining_table', 'sale_settings', 'menu_item_price', 'menu_item',
                'recipe_price', 'recipe_line', 'recipe', 'recipe_key',
                'supplier_item', 'supplier', 'ingredient', 'location', 'cost_centre',
                'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment',
                'app_user', 'tenant'],
          'the purge list is the one M20 merged, minus day_close, in the same order');
select is((select count(*)::int from unnest(app.demo_purge_tables()) n where n = 'day_close'), 1, 'day_close is listed once');
select ok((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'day_close')
        < (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'app_user'), 'day_close is deleted before app_user, which it references');

-- What M21 must not touch (md5 of prosrc taken on the tree before M21's migrations, i.e. main with M20 merged) -----------------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op_dispatch' and pronamespace = 'app'::regnamespace), '1,43cfcbb590e039e1990b44a341b54b62', 'app.apply_op_dispatch: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_date' and pronamespace = 'app'::regnamespace), '1,091124d73dbb308b0915f7738e72e53c', 'app.business_date: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_day_cutoff' and pronamespace = 'app'::regnamespace), '1,fc1b2056218acfc22e97b49e39adc7a0', 'app.business_day_cutoff: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'ledger_checks_body' and pronamespace = 'app'::regnamespace), '1,cb226f12ad010a3c293dfec5220c24db', 'app.ledger_checks_body: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'sync_conflict_codes' and pronamespace = 'app'::regnamespace), '1,fecfd198f96ebf1fd63c00bbbee291ff', 'app.sync_conflict_codes: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'sync_op_kinds' and pronamespace = 'app'::regnamespace), '1,6b730013524c0b221afa005927fb092f', 'app.sync_op_kinds: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'add_order_line' and pronamespace = 'public'::regnamespace), '1,1ab3d828bef1a8bf7f1df7309201fd15', 'public.add_order_line: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op' and pronamespace = 'public'::regnamespace), '1,5b6710a9fe6eca1c7d44ae84d880db5e', 'public.apply_op: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'fire_course' and pronamespace = 'public'::regnamespace), '1,83ac74bc4f6a90819913e66747f4f6b6', 'public.fire_course: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kitchen_tickets' and pronamespace = 'public'::regnamespace), '1,a42b896d6e92d4cf2fa224c3e010e2e4', 'public.kitchen_tickets: one definition, re-pinned by M19b step 3');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'open_table' and pronamespace = 'public'::regnamespace), '1,24f56ad912aebaa23c8ffcb68d6c8744', 'public.open_table: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'order_view' and pronamespace = 'public'::regnamespace), '1,44a075d2755ea0a66cb585eb0fd401b0', 'public.order_view: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'remove_order_line' and pronamespace = 'public'::regnamespace), '1,708cb173aa732c179e6e7579284dea3e', 'public.remove_order_line: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'tables_list' and pronamespace = 'public'::regnamespace), '1,6a5ab297e24b04040eec2141162193f7', 'public.tables_list: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'update_order_line' and pronamespace = 'public'::regnamespace), '1,fcf0547e06f2312dd86d692d2ce57c3b', 'public.update_order_line: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'update_table_session' and pronamespace = 'public'::regnamespace), '1,98db33813b1a8e6106f2f44188d4bfb8', 'public.update_table_session: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'void_line' and pronamespace = 'public'::regnamespace), '1,5d175ff95794d3bce2b55d26491989df', 'public.void_line: one definition, unchanged');

-- Shared lists and checks ----------------------------------------------------------------------------------------------------------
select is(app.sync_op_kinds(), array['open_table', 'add_line', 'edit_line', 'remove_line', 'fire', 'void_line'], 'app.sync_op_kinds() is still M20''s six (close is not an op kind)');
select is(app.sync_conflict_codes(), array['session_closed', 'table_already_open'], 'app.sync_conflict_codes() is unchanged');
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still has 15 kinds (M21 adds none)');
select is((select md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '09b9c6302f3c9c7c4265a70f73212d40', 'and every row is unchanged');
select is((select string_agg(md5(pg_get_constraintdef(oid)), ',' order by conname::text collate "C") from pg_constraint
            where conrelid = 'public.audit_event'::regclass and conname in ('audit_event_entity_type_check', 'audit_event_action_check')),
          'e34afece68d41c1a99baf21f7d0a51b0,32f535da0c689f7fa047ecd84e9ab13f', 'both audit_event checks are unchanged (M21 adds no entity type and no action)');

-- The one function M21 replaces ------------------------------------------------------------------------------------------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'table_session_guard' and pronamespace = 'app'::regnamespace),
          '1,8baaaca12626d00b229d3409939aaf82', 'app.table_session_guard: one definition, pinned to its M21 text');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.table_session'::regclass and tgname = 'table_session_guard' and not tgisinternal), 1,
          'and its trigger keeps the name pgTAP 157 disables');

select * from finish();
rollback;
