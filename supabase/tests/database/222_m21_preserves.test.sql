-- M21 steps 7 and 9 (docs/plans/2026-10-30-m21-bill-close.md §3.2, §5; ADR-023): what M21 must not touch. Step 7: day_close joins the demo purge list
-- before app_user and the M20 list is otherwise unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

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

select * from finish();
rollback;
