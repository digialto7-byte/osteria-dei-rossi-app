-- M19b steps 7 and 9 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.2, §5; ADR-024): what M19b must not touch. Step 7 (this part): kitchen_event joins the demo purge list
-- immediately before order_line_cost, so it is deleted before the order lines, the sessions and the users it references, and the list is otherwise the M21 list.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

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

select * from finish();
rollback;
