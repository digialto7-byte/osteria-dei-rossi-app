-- Demo data (ADR-018, plan §3.9): M21 added public.day_close (tenant_id; composite foreign key to app_user and the tenant). It joins the purge
-- list immediately before app_user, which it references (the list is in delete order). Its delete guard is app.append_only
-- (day_close_append_only, 20261110100000), which already honours app.demo_purge_allows, so no guard needs a new branch. table_session is
-- already listed: its new closing columns add no table. M21 adds no other table, and M20's migrations are not edited.
-- The list is the one of 20261109100200 plus 'day_close'. create or replace keeps the owner and the grants (closed to every API role).
-- pgTAP 194 keeps the list complete, 193 purges a demo tenant with register entries and leaves R1 and R2 byte for byte, 222 pins the order.
create or replace function app.demo_purge_tables() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array[
    -- alerts and audit
    'alert', 'audit_event',
    -- staff meals and batches
    'staff_meal_confirmation', 'staff_meal_rule', 'batch_cost', 'batch_movement', 'batch_input', 'batch',
    -- counts and stock
    'count_line', 'count_session', 'stock_movement', 'raw_lot',
    -- prices, payables and invoices
    'price_history', 'payable', 'invoice_duplicate_decision', 'invoice_line', 'invoice',
    -- cost settings
    'ingredient_cost_basis', 'fixed_cost_period',
    -- M17/M18/M19/M20 tables and menu: the record of the offline operations first (it points at the users only), the frozen cost of a
    -- sent line and the order lines before the sessions and menu items they point at (the cost row also points at a recipe),
    -- sessions before tables, prices before items, items before the recipe keys
    'applied_op', 'order_line_cost', 'order_line', 'table_session', 'dining_table', 'sale_settings', 'menu_item_price', 'menu_item',
    -- recipes
    'recipe_price', 'recipe_line', 'recipe', 'recipe_key',
    -- master data
    'supplier_item', 'supplier', 'ingredient', 'location', 'cost_centre',
    -- staff login; venue_device and device_enrolment reference each other (deleted together)
    'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment',
    -- M21: the register entries of the end of the day (they point at the users only)
    'day_close',
    -- last: the demo users. 'tenant' is listed because it carries a tenant_id (pgTAP 194), but the reset never deletes it
    'app_user', 'tenant'
  ]::text[]
$$;
