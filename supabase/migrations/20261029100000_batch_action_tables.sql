-- M15 step 1: the batch movement shapes, the batch waste reasons and the staff-meal tables (M15 plan §3.1.1, §3.1.7,
-- §3.2; ADR-014; project plan §3.5.1-3.5.2).
--
-- M14 allowed the 'produce' movement only. M15 adds three more shapes (count, waste, split); 'consume' stays refused
-- until M19, and no shape allows a reversal (founder Q51 default: a wrong action is corrected with a count). The
-- waste reasons of a batch are M12's list minus count_correction: a count is an adjustment, not a discard.
--
-- staff_meal_rule is configuration (one row per target ever, never deleted); staff_meal_confirmation is the append-only
-- record that a rule was confirmed on a business day, and its unique key is what makes "once per day" true under
-- concurrency. Nobody writes either table directly: no INSERT/UPDATE/DELETE grant, rows come from SECURITY DEFINER
-- procedures (steps 3-5).

-- The seven batch waste reasons. The TS list in src/server/batches/reasons.ts is pinned to this literal list by pgTAP
-- 130 and reasons.test.ts.
create function app.batch_waste_reason_codes() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array['spoilage', 'expired', 'over_production', 'plating_error', 'staff_meal', 'comp', 'breakage']
$$;
revoke all on function app.batch_waste_reason_codes() from public, anon, authenticated, service_role;

-- Every comparison on the type uses type::text. Each branch ends in a definite true or false (a waste reason is
-- tested with `is not null` first), because a check that evaluates to null would pass.
alter table public.batch_movement
  drop constraint batch_movement_m14_ck,
  add constraint batch_movement_shape_ck check (
    reverses_id is null
    and (
      (type::text = 'produce' and portions > 0 and reason_code is null and ref_type = 'batch' and ref_id = batch_id)
      or (type::text = 'count' and reason_code is null and ref_type = 'batch_adjust')
      or (type::text = 'waste' and portions < 0 and reason_code is not null
          and reason_code = any (app.batch_waste_reason_codes())
          and (ref_type = 'batch_discard' or (ref_type = 'staff_meal' and reason_code = 'staff_meal')))
      or (type::text = 'split' and reason_code is null and ref_type = 'batch_split'
          and ((portions < 0 and ref_id <> batch_id) or (portions > 0 and ref_id = batch_id)))
    ));

create table public.staff_meal_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  recipe_key uuid,
  ingredient_id uuid,
  -- Portions for a recipe, base units for an ingredient.
  default_count numeric(12, 4) not null check (default_count > 0 and default_count <= 1000),
  location_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default app.app_user_id(),
  constraint staff_meal_rule_target_ck check (num_nonnulls(recipe_key, ingredient_id) = 1),
  constraint staff_meal_rule_location_ck check (location_id is null or ingredient_id is not null),
  constraint staff_meal_rule_tenant_id_id_uq unique (tenant_id, id),
  constraint staff_meal_rule_recipe_uq unique (tenant_id, recipe_key),
  constraint staff_meal_rule_ingredient_uq unique (tenant_id, ingredient_id),
  constraint staff_meal_rule_recipe_fkey foreign key (tenant_id, recipe_key)
    references public.recipe_key (tenant_id, id),
  constraint staff_meal_rule_ingredient_fkey foreign key (tenant_id, ingredient_id)
    references public.ingredient (tenant_id, id),
  constraint staff_meal_rule_location_fkey foreign key (tenant_id, location_id)
    references public.location (tenant_id, id),
  constraint staff_meal_rule_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id),
  constraint staff_meal_rule_updated_by_fkey foreign key (tenant_id, updated_by)
    references public.app_user (tenant_id, id)
);

create table public.staff_meal_confirmation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  rule_id uuid not null,
  business_date date not null,
  count numeric(12, 4) not null check (count > 0 and count <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  constraint staff_meal_confirmation_tenant_id_id_uq unique (tenant_id, id),
  -- Once per rule and business day (founder Q49 default).
  constraint staff_meal_confirmation_day_uq unique (tenant_id, rule_id, business_date),
  constraint staff_meal_confirmation_rule_fkey foreign key (tenant_id, rule_id)
    references public.staff_meal_rule (tenant_id, id),
  constraint staff_meal_confirmation_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);

-- The target of a rule is a batch recipe or a stock ingredient, and never changes afterwards. Runs before the foreign
-- keys, so a key of another tenant is also reported as an invalid target.
create function app.staff_meal_rule_guard() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.tenant_id is distinct from old.tenant_id
       or new.recipe_key is distinct from old.recipe_key
       or new.ingredient_id is distinct from old.ingredient_id
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'staff_meal_rule_immutable' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.recipe_key is not null then
    perform 1 from public.recipe_key k
     where k.tenant_id = new.tenant_id and k.id = new.recipe_key and k.type = 'batch';
    if not found then
      raise exception 'staff_meal_target_invalid' using errcode = 'P0001';
    end if;
  end if;
  if new.ingredient_id is not null then
    perform 1 from public.ingredient i
     where i.tenant_id = new.tenant_id and i.id = new.ingredient_id and i.is_stock;
    if not found then
      raise exception 'staff_meal_target_invalid' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.staff_meal_rule_guard() from public, anon, authenticated, service_role;

create trigger staff_meal_rule_guard before insert or update on public.staff_meal_rule
  for each row execute function app.staff_meal_rule_guard();
create trigger staff_meal_rule_append_only before delete on public.staff_meal_rule
  for each row execute function app.append_only();
create trigger staff_meal_rule_no_truncate before truncate on public.staff_meal_rule
  for each statement execute function app.append_only_truncate();
create trigger staff_meal_confirmation_append_only before update or delete on public.staff_meal_confirmation
  for each row execute function app.append_only();
create trigger staff_meal_confirmation_no_truncate before truncate on public.staff_meal_confirmation
  for each statement execute function app.append_only_truncate();

alter table public.staff_meal_rule enable row level security;
alter table public.staff_meal_confirmation enable row level security;

revoke all on public.staff_meal_rule, public.staff_meal_confirmation from anon, authenticated, service_role;
grant select on public.staff_meal_rule, public.staff_meal_confirmation to authenticated;

-- Quantities only, no € value: the kitchen reads them; the waiter reads none (Q16, plan §3.11.2).
create policy staff_meal_rule_select on public.staff_meal_rule
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
create policy staff_meal_confirmation_select on public.staff_meal_confirmation
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));

-- The audit lists widen. Every value of 20261027100800_audit_checks_with_staff.sql (the union of M9, M11 and M13)
-- stays; the staff-meal rule entity and its two actions are added.
alter table public.audit_event
  drop constraint audit_event_entity_type_check,
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_entity_type_check
    check (entity_type in ('invoice', 'ingredient', 'recipe', 'tenant', 'payable', 'app_user',
                           'venue_device', 'device_enrolment', 'count_session', 'staff_meal_rule')),
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed', 'payable.payment_reversed',
                      'app_user.created', 'app_user.updated', 'app_user.deactivated',
                      'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created',
                      'venue_device.enrolled', 'venue_device.revoked', 'venue_device.unlocked',
                      'count_session.closed', 'count_session.cancelled', 'ingredient.critical_changed',
                      'staff_meal_rule.created', 'staff_meal_rule.updated'));
