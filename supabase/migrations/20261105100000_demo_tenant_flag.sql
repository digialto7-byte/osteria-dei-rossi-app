-- Demo data step 1 (docs/plans/2026-10-24-demo-data.md §3.1-§3.2; ADR-018): the demo is its own tenant, flagged by
-- tenant.is_demo.
--
-- 1. The flag is set only when the tenant is created (public.create_demo_tenant) and no role can ever change it, so a real
--    tenant can never become purgeable and the demo can never become "real". The trigger holds for every role, the
--    migration owner and service_role included.
-- 2. At most one demo tenant exists (partial unique index).
-- 3. app.tenant_is_demo(uuid) is the lookup the purge guards use (closed to API roles).
-- 4. audit_event_action_check is re-created as the union of every earlier value plus 'tenant.demo_created'. Last
--    re-created by 20261030100000_rules_settings.sql; tests/config/check-constraint-union.test.ts keeps this honest.
--    audit_event_entity_type_check needs no new value ('tenant' is already allowed).

alter table public.tenant add column is_demo boolean not null default false;

create unique index tenant_one_demo_uq on public.tenant ((true)) where is_demo;

create function app.tenant_is_demo_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.is_demo is distinct from old.is_demo then
    raise exception 'tenant_is_demo_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.tenant_is_demo_guard() from public, anon;

create trigger tenant_is_demo_guard before update on public.tenant
  for each row execute function app.tenant_is_demo_guard();

create function app.tenant_is_demo(p_tenant uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce((select t.is_demo from public.tenant t where t.id = p_tenant), false)
$$;
revoke all on function app.tenant_is_demo(uuid) from public, anon, authenticated, service_role;

alter table public.audit_event
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed', 'payable.payment_reversed',
                      'app_user.created', 'app_user.updated', 'app_user.deactivated',
                      'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created',
                      'venue_device.enrolled', 'venue_device.revoked', 'venue_device.unlocked',
                      'count_session.closed', 'count_session.cancelled', 'ingredient.critical_changed',
                      'staff_meal_rule.created', 'staff_meal_rule.updated',
                      'ingredient.rules_changed', 'supplier.delivery_changed', 'recipe.rules_changed',
                      'tenant.demo_created'));

-- The demo tenant, its owner and its admin, and one audit row, in one transaction. Service role only: the grant is the
-- role gate (the same pattern as create_tenant_with_owner); pgTAP 190 and 195 pin it. SECURITY DEFINER because no API
-- role may insert into audit_event. Both users are 'email' accounts: the admin has no way to sign in (the seed never
-- gives it a usable login), and only an admin may create another admin, so the row cannot come from the owner's session.
create function public.create_demo_tenant(
  p_name text,
  p_vat text,
  p_owner_auth uuid,
  p_owner_name text,
  p_admin_auth uuid,
  p_admin_name text
) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_owner uuid;
begin
  if exists (select 1 from public.tenant t where t.is_demo) then
    raise exception 'demo_tenant_exists' using errcode = 'P0001';
  end if;

  insert into public.tenant (name, vat_number, is_demo)
    values (p_name, p_vat, true)
    returning id into v_tenant;
  insert into public.app_user (tenant_id, auth_id, role, display_name, login_method)
    values (v_tenant, p_owner_auth, 'owner', p_owner_name, 'email')
    returning id into v_owner;
  insert into public.app_user (tenant_id, auth_id, role, display_name, login_method, created_by)
    values (v_tenant, p_admin_auth, 'admin', p_admin_name, 'email', v_owner);
  update public.tenant set created_by = v_owner where id = v_tenant;
  update public.app_user set created_by = v_owner where id = v_owner;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
    values (v_tenant, 'tenant', v_tenant, 'tenant.demo_created', v_owner);
  return v_tenant;
end
$$;
revoke all on function public.create_demo_tenant(text, text, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_demo_tenant(text, text, uuid, text, uuid, text) to service_role;
