-- Demo data (ADR-018, plan §3.9): M18 added public.order_line (tenant_id, composite foreign keys to table_session and menu_item,
-- and to app_user). It joins the purge list BEFORE table_session and menu_item. M18's own migrations are not edited. Its delete
-- guard is app.append_only (order_line_append_only, 20261101100000), which already honours app.demo_purge_allows, so no guard
-- needs a new branch; pgTAP 196 pins that. create or replace keeps the owner and the grants (closed to every API role).
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
    -- M17/M18 tables and menu: order lines before the sessions and menu items they point at, sessions before tables,
    -- prices before items, items before the recipe keys they point at
    'order_line', 'table_session', 'dining_table', 'sale_settings', 'menu_item_price', 'menu_item',
    -- recipes
    'recipe_price', 'recipe_line', 'recipe', 'recipe_key',
    -- master data
    'supplier_item', 'supplier', 'ingredient', 'location', 'cost_centre',
    -- staff login; venue_device and device_enrolment reference each other (deleted together)
    'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment',
    -- last: the demo users. 'tenant' is listed because it carries a tenant_id (pgTAP 194), but the reset never deletes it
    'app_user', 'tenant'
  ]::text[]
$$;
