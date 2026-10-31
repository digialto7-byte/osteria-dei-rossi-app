-- Demo data (ADR-018, plan docs/plans/2026-10-31-m22-kpi-reporting.md §3.1.10, §3.2): M22 adds public.daily_kpi and public.dashboard_open (both carry
-- tenant_id). They join the purge list immediately after day_close and before app_user, which dashboard_open references (the list is in delete order).
-- daily_kpi's delete guard is app.append_only (already honouring app.demo_purge_allows); dashboard_open has no guard. The list is the one of
-- 20261111100400 (M19b, with kitchen_event) plus the two names. create or replace keeps the owner and the grants (closed to every API role).
-- The plan files this migration under step 9; it is created with step 1 because pgTAP 194 (every tenant table is listed) and the demo rule of
-- app.tenant_has_operational_data (231) need the list from the moment the tables exist. Its number stays the plan's.
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
    'applied_op', 'kitchen_event', 'order_line_cost', 'order_line', 'table_session', 'dining_table', 'sale_settings', 'menu_item_price', 'menu_item',
    -- recipes
    'recipe_price', 'recipe_line', 'recipe', 'recipe_key',
    -- master data
    'supplier_item', 'supplier', 'ingredient', 'location', 'cost_centre',
    -- staff login; venue_device and device_enrolment reference each other (deleted together)
    'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment',
    -- M21: the register entries of the end of the day (they point at the users only)
    'day_close',
    -- M22: the frozen daily sales facts (tenant only) and the weekly dashboard opens (they point at the users)
    'daily_kpi', 'dashboard_open',
    -- last: the demo users. 'tenant' is listed because it carries a tenant_id (pgTAP 194), but the reset never deletes it
    'app_user', 'tenant'
  ]::text[]
$$;
