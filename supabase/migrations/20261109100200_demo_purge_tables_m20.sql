-- Demo data (ADR-018, plan §3.9): M20 added public.applied_op (tenant_id; composite foreign keys to app_user and the tenant). It joins the
-- purge list before app_user (the list is in delete order) and, like the other ledgers, before order_line_cost: it references the users
-- only, so any place before 'app_user' works, and the head of the M17/M18/M19 group keeps the list readable. M20 adds no other table.
-- M20's own migrations are not edited. Its delete guard is app.append_only (applied_op_append_only, 20261109100000), which already
-- honours app.demo_purge_allows, so no guard needs a new branch; pgTAP 214 pins that and 193/194/196 keep the list and the guards
-- honest. The list is the one of 20261106100600 plus 'applied_op'. create or replace keeps the owner and the grants (closed to every
-- API role).
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
    -- last: the demo users. 'tenant' is listed because it carries a tenant_id (pgTAP 194), but the reset never deletes it
    'app_user', 'tenant'
  ]::text[]
$$;
