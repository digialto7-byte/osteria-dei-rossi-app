-- M16 step 1: settings for the reorder, prep, purchase and expiry rules (ADR-015).
--
-- 1. Per-recipe rule settings live on the stable recipe_key, not on the immutable versions: changing a threshold
--    never creates a recipe version. The effective value is coalesce(key setting, current version's value). No API
--    role has a grant on these columns; the definer procedures of 20261030100200 write them.
-- 2. The direct column grants on the reorder fields are revoked, so every change goes through an audited procedure.
-- 3. A partial index for the 14-day consumption aggregate of the hourly rules.
-- 4. The two audit checks, re-created as the union of every earlier value plus M16's. Last re-created by
--    20261027100800_audit_checks_with_staff.sql. tests/config/check-constraint-union.test.ts keeps this honest.
alter table public.recipe_key
  add column rule_min_portions int
    constraint recipe_key_rule_min_portions_check check (rule_min_portions between 0 and 10000),
  add column rule_target_portions int
    constraint recipe_key_rule_target_portions_check check (rule_target_portions between 0 and 10000),
  add column rule_prep_time_min int
    constraint recipe_key_rule_prep_time_min_check check (rule_prep_time_min between 0 and 1440),
  add constraint recipe_key_rule_portions_ck
    check (rule_min_portions is null or rule_target_portions is null or rule_target_portions >= rule_min_portions);

revoke insert (min_level, target_level), update (min_level, target_level) on public.ingredient from authenticated;
revoke insert (lead_time_days, delivery_weekdays, order_cutoff_time),
       update (lead_time_days, delivery_weekdays, order_cutoff_time) on public.supplier from authenticated;

create index stock_movement_consumption_idx on public.stock_movement (tenant_id, effective_on)
  where type = 'consumption';

alter table public.audit_event
  drop constraint audit_event_entity_type_check,
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_entity_type_check
    check (entity_type in ('invoice', 'ingredient', 'recipe', 'tenant', 'payable', 'app_user',
                           'venue_device', 'device_enrolment', 'count_session', 'staff_meal_rule', 'supplier')),
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed', 'payable.payment_reversed',
                      'app_user.created', 'app_user.updated', 'app_user.deactivated',
                      'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created',
                      'venue_device.enrolled', 'venue_device.revoked', 'venue_device.unlocked',
                      'count_session.closed', 'count_session.cancelled', 'ingredient.critical_changed',
                      'staff_meal_rule.created', 'staff_meal_rule.updated',
                      'ingredient.rules_changed', 'supplier.delivery_changed', 'recipe.rules_changed'));
