-- Demo data (ADR-018, plan §3.9): M19b added public.kitchen_event (tenant_id; composite foreign keys to order_line, table_session and app_user).
-- It joins the purge list immediately before order_line_cost, so it is deleted before the order lines, the sessions and the users it points at
-- (the list is in delete order). Its delete guard is app.append_only (kitchen_event_append_only, 20261111100000), which already honours
-- app.demo_purge_allows, so no guard needs a new branch. The list is the one of 20261110100400 plus 'kitchen_event'; create or replace keeps
-- the owner and the grants (closed to every API role). pgTAP 194 keeps the list complete, 193 purges a demo tenant with kitchen events and
-- leaves R1 and R2 byte for byte, 222 and 229 pin the order.
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
    -- M17/M18/M19/M20 tables and menu: the record of the offline operations first (it points at the users only), the kitchen events
    -- (M19b: they point at order lines, sessions and users), the frozen cost of a
    -- sent line and the order lines before the sessions and menu items they point at (the cost row also points at a recipe),
    -- sessions before tables, prices before items, items before the recipe keys
    'applied_op', 'kitchen_event', 'order_line_cost', 'order_line', 'table_session', 'dining_table', 'sale_settings', 'menu_item_price', 'menu_item',
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
