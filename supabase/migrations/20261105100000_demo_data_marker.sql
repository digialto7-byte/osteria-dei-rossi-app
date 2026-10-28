-- Demo data step 1 (docs/plans/2026-10-24-demo-data.md §0, ADR-018 revision 1): the demo goes INTO an existing tenant, which is
-- marked by tenant.demo_data_since while the demo data is in it.
--
-- 1. The marker is set only by public.begin_demo_data (service role) and only on a tenant that holds no operational data (any
--    row in a data table: invoices, stock, batches, counts, recipes, menu, tables, master data, ...). The trigger
--    tenant_demo_marker_guard refuses every other change of the column, for every role (the migration owner and service_role
--    included), and refuses to mark a tenant that holds data even when the write setting is present. So a tenant with real data
--    can never become resettable. It is cleared only by the reset (20261105100300), which sets the same transaction-local setting.
--    The trigger fires on INSERT too, so a new tenant row cannot be created already marked.
-- 2. app.tenant_is_demo(uuid) is true while the marker is set. app.tenant_has_operational_data(uuid) is the rule behind 1. Both
--    are closed to API roles.
-- 3. app.demo_state keeps what the reset needs: the tenant's settings from before the demo (the cost rules change them) and the
--    two users begin_demo_data creates. No API privilege.
-- 4. audit_event_action_check is re-created as the union of every earlier value plus 'tenant.demo_data_loaded' and
--    'tenant.demo_data_removed'. Last re-created by 20261031100000_menu_tables_core.sql (M17);
--    tests/config/check-constraint-union.test.ts keeps this honest. audit_event_entity_type_check needs no new value.

alter table public.tenant add column demo_data_since timestamptz;

create table app.demo_state (
  tenant_id uuid primary key,
  owner_user uuid not null,
  admin_user uuid not null,
  settings_before jsonb not null
);
alter table app.demo_state enable row level security;
revoke all on app.demo_state from public, anon, authenticated, service_role;

create function app.tenant_is_demo(p_tenant uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce((select t.demo_data_since is not null from public.tenant t where t.id = p_tenant), false)
$$;
revoke all on function app.tenant_is_demo(uuid) from public, anon, authenticated, service_role;

-- True when the tenant has a row in any data table of app.demo_purge_tables(). Users, audit rows, alerts, devices, sessions and
-- login attempts do not count: a new tenant has its owner and a founder may have enrolled a phone before the demo.
create function app.tenant_has_operational_data(p_tenant uuid) returns boolean
  language plpgsql stable security definer
  set search_path = ''
as $$
declare
  t text;
  found_row boolean;
begin
  foreach t in array app.demo_purge_tables() loop
    continue when t in ('tenant', 'app_user', 'audit_event', 'alert', 'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment');
    execute format('select exists (select 1 from public.%I where tenant_id = $1)', t) into found_row using p_tenant;
    if found_row then
      return true;
    end if;
  end loop;
  return false;
end
$$;
revoke all on function app.tenant_has_operational_data(uuid) from public, anon, authenticated, service_role;

create function app.tenant_demo_marker_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  -- A new tenant row never carries the marker: only begin_demo_data marks, and only a tenant that exists and is empty.
  if tg_op = 'INSERT' then
    if new.demo_data_since is not null then
      raise exception 'demo_marker_immutable' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.demo_data_since is distinct from old.demo_data_since then
    if coalesce(current_setting('app.demo_marker_write', true), '') <> new.id::text then
      raise exception 'demo_marker_immutable' using errcode = 'P0001';
    end if;
    if old.demo_data_since is null and app.tenant_has_operational_data(new.id) then
      raise exception 'tenant_has_operational_data' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.tenant_demo_marker_guard() from public, anon, authenticated;

create trigger tenant_demo_marker_guard before insert or update on public.tenant
  for each row execute function app.tenant_demo_marker_guard();

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
                      'menu_item.created', 'menu_item.updated', 'dining_table.created',
                      'dining_table.updated', 'table_session.covers_changed', 'sale_settings.changed',
                      'tenant.demo_data_loaded', 'tenant.demo_data_removed'));

-- Marks the tenant, adds a demo owner and a demo admin next to its own users, and writes one audit row, in one transaction.
-- Service role only: the grant is the role gate (the pattern of create_tenant_with_owner); pgTAP 190 and 195 pin it. SECURITY
-- DEFINER because no API role may insert into audit_event or mark a tenant. The tenant's own users are never read or changed.
-- Both new users are 'email' accounts. The seed needs a real owner session to call the owner procedures, so the demo owner has
-- a random password held in the seed's memory only and rotated away at the end; neither address can receive mail. Only an admin
-- may create an admin, so the demo admin row cannot come from the owner's session either.
create function public.begin_demo_data(
  p_tenant uuid,
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
  v_marker timestamptz;
  v_settings jsonb;
  v_owner uuid;
  v_admin uuid;
begin
  select t.demo_data_since, t.settings into v_marker, v_settings from public.tenant t where t.id = p_tenant for update;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0001';
  end if;
  if v_marker is not null then
    raise exception 'demo_data_exists' using errcode = 'P0001';
  end if;
  if app.tenant_has_operational_data(p_tenant) then
    raise exception 'tenant_has_operational_data' using errcode = 'P0001';
  end if;

  -- now() is the transaction start, so the users and the audit row written below are at or after the marker.
  perform set_config('app.demo_marker_write', p_tenant::text, true);
  update public.tenant set demo_data_since = now() where id = p_tenant;
  perform set_config('app.demo_marker_write', '', true);

  insert into public.app_user (tenant_id, auth_id, role, display_name, login_method)
    values (p_tenant, p_owner_auth, 'owner', p_owner_name, 'email')
    returning id into v_owner;
  update public.app_user set created_by = v_owner where id = v_owner;
  insert into public.app_user (tenant_id, auth_id, role, display_name, login_method, created_by)
    values (p_tenant, p_admin_auth, 'admin', p_admin_name, 'email', v_owner)
    returning id into v_admin;

  insert into app.demo_state (tenant_id, owner_user, admin_user, settings_before)
    values (p_tenant, v_owner, v_admin, v_settings);
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
    values (p_tenant, 'tenant', p_tenant, 'tenant.demo_data_loaded', v_owner);
  return p_tenant;
end
$$;
revoke all on function public.begin_demo_data(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_demo_data(uuid, uuid, text, uuid, text) to service_role;
