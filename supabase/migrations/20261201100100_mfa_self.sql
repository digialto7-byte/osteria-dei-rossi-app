-- P2-1 A3 (docs/plans/2026-11-12-p2-1-totp.md section 3.3, 3.3a, 5 A3; founder decisions of 2026-11-12: Q-T2 = V2): the self-service MFA procedures.
--
--   app.mfa_failure          each wrong code typed at sign-in or enrolment: tenant, account, stage, time. No code, no IP, no device. RLS on, no API
--                               privilege; written by mfa_record_failure, read by mfa_attempt_allowed. Deleted after 30 days by the retention job of
--                               20261201100500. Not an audit row (V2): the permanent audit log keeps enrolments, removals, resets and enforcement changes.
--   app.mfa_lock_failures/minutes, app.mfa_max_factors   the constants (5 failures in 15 minutes, 2 factors); TS twins in src/lib/auth/mfa-constants.ts.
--   app.mfa_gate_of             the same rule as the gate, as ok | challenge | enrol.
--   public.mfa_gate, mfa_status, mfa_attempt_allowed, mfa_record_failure, mfa_enrol_check, mfa_record_enrolled, mfa_unenrol_check, mfa_record_unenrolled
--                               the eight exempt procedures of T-4: each answers for the caller's own account only, through app.membership_ungated(), so
--                               they work while the account is gated at aal1. Owner and admin only (42501 otherwise), except mfa_gate, which answers ok
--                               to anyone else. Tenant and user come from the membership row, never from a parameter. No function takes a code or a secret.
--   audit_event_action_check    the union of every earlier action plus six: app_user.mfa_enrolled, mfa_unenrolled, mfa_reset, mfa_reset_failed,
--                               app_user.pin_set_failed (F13, written in 20261201100300) and tenant.mfa_enforcement_changed.
--                               The table is in schema app (like app.reservation_throttle: no API surface at all, nothing in the Data API), so
--                               app.demo_purge_tables is unchanged; a demo purge clears it through the foreign key (on delete cascade) to the users.
--                               pgTAP 194 lists it with the other app tables that carry a tenant_id (updated on purpose).
-- Errors carry codes and fixed names only.

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
                      'tenant.demo_data_loaded', 'tenant.demo_data_removed', 'reservation_settings.changed',
                      'app_user.mfa_enrolled', 'app_user.mfa_unenrolled', 'app_user.mfa_reset',
                      'app_user.mfa_reset_failed', 'app_user.pin_set_failed', 'tenant.mfa_enforcement_changed'));

create table app.mfa_failure (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  app_user_id uuid not null references public.app_user (id) on delete cascade,
  stage text not null check (stage in ('login', 'enrol')),
  at timestamptz not null default now()
);
create index mfa_failure_user_at_idx on app.mfa_failure (app_user_id, at);
create index mfa_failure_at_idx on app.mfa_failure (at);
alter table app.mfa_failure enable row level security;
revoke all on app.mfa_failure from public, anon, authenticated, service_role;

create function app.mfa_lock_failures() returns integer language sql immutable set search_path = '' as $$ select 5 $$;
create function app.mfa_lock_minutes() returns integer language sql immutable set search_path = '' as $$ select 15 $$;
create function app.mfa_max_factors() returns integer language sql immutable set search_path = '' as $$ select 2 $$;
revoke all on function app.mfa_lock_failures(), app.mfa_lock_minutes(), app.mfa_max_factors() from public, anon, authenticated, service_role;

create function app.mfa_gate_of(p_role public.app_role, p_tenant uuid, p_auth uuid) returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select case when not app.mfa_needs_aal2(p_role, p_tenant, p_auth) or app.jwt_aal() = 'aal2' then 'ok'
              when app.mfa_has_verified_factor(p_auth) then 'challenge'
              else 'enrol' end
$$;
revoke all on function app.mfa_gate_of(public.app_role, uuid, uuid) from public, anon, authenticated, service_role;

-- The gate for the caller: ok for anyone who is not an owner or admin, or who has no membership.
create function public.mfa_gate() returns text
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  m record;
begin
  select * into m from app.membership_ungated();
  if not found or m.role not in ('owner', 'admin') then
    return 'ok';
  end if;
  return app.mfa_gate_of(m.role, m.tenant_id, m.auth_id);
end
$$;

create function public.mfa_status() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  m record;
begin
  select * into m from app.membership_ungated();
  if not found or m.role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  return (select jsonb_build_object('role', m.role, 'mode', t.mfa_enforcement, 'hasVerifiedFactor', app.mfa_has_verified_factor(m.auth_id),
                                    'gate', app.mfa_gate_of(m.role, m.tenant_id, m.auth_id), 'issuer', t.name)
            from public.tenant t where t.id = m.tenant_id);
end
$$;

create function public.mfa_attempt_allowed() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  m record;
  v_n integer;
  v_at timestamptz;
  v_window interval := make_interval(mins => app.mfa_lock_minutes());
  v_retry integer;
begin
  select * into m from app.membership_ungated();
  if not found or m.role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select count(*) into v_n from app.mfa_failure f where f.app_user_id = m.app_user_id and f.at > clock_timestamp() - v_window;
  if v_n < app.mfa_lock_failures() then
    return jsonb_build_object('allowed', true, 'retryAfterSeconds', 0);
  end if;
  -- The lock lifts when the failures in the window drop below the limit: the (n - limit + 1)th oldest has to age out.
  select f.at into v_at from app.mfa_failure f
   where f.app_user_id = m.app_user_id and f.at > clock_timestamp() - v_window
   order by f.at, f.id offset v_n - app.mfa_lock_failures() limit 1;
  v_retry := greatest(1, ceil(extract(epoch from (v_at + v_window - clock_timestamp())))::integer);
  return jsonb_build_object('allowed', false, 'retryAfterSeconds', v_retry);
end
$$;

create function public.mfa_record_failure(p_stage text) returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  m record;
begin
  select * into m from app.membership_ungated();
  if not found or m.role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_stage is null or p_stage not in ('login', 'enrol') then
    raise exception 'invalid_stage' using errcode = '22023';
  end if;
  insert into app.mfa_failure (tenant_id, app_user_id, stage) values (m.tenant_id, m.app_user_id, p_stage);
end
$$;

create function public.mfa_enrol_check(p_slot text) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  m record;
  v_name text;
begin
  select * into m from app.membership_ungated();
  if not found or m.role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  v_name := case p_slot when 'principale' then 'Principale' when 'riserva' then 'Riserva' end;
  if v_name is null then
    raise exception 'invalid_slot' using errcode = '22023';
  end if;
  -- Adding a factor to an account that already has one is a protected act (Supabase asks for aal2 as well).
  if app.mfa_has_verified_factor(m.auth_id) then
    perform app.require_aal2();
  end if;
  if (select count(*) from auth.mfa_factors f where f.user_id = m.auth_id and f.status = 'verified' and f.factor_type = 'totp') >= app.mfa_max_factors() then
    raise exception 'mfa_factor_limit' using errcode = 'P0001';
  end if;
  if exists (select 1 from auth.mfa_factors f where f.user_id = m.auth_id and f.status = 'verified' and f.factor_type = 'totp' and f.friendly_name = v_name) then
    raise exception 'mfa_slot_taken' using errcode = 'P0001';
  end if;
  return jsonb_build_object('issuer', (select t.name from public.tenant t where t.id = m.tenant_id), 'friendlyName', v_name);
end
$$;

create function public.mfa_record_enrolled(p_factor uuid) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  m record;
  v_name text;
begin
  select * into m from app.membership_ungated();
  if not found or m.role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select f.friendly_name into v_name from auth.mfa_factors f
   where f.id = p_factor and f.user_id = m.auth_id and f.status = 'verified' and f.factor_type = 'totp';
  if not found then
    raise exception 'mfa_factor_not_verified' using errcode = 'P0001';
  end if;
  -- One account, one writer at a time: two calls for the same factor record it once.
  perform pg_advisory_xact_lock(hashtextextended('mfa-audit:' || m.app_user_id::text, 0));
  if exists (select 1 from public.audit_event a where a.tenant_id = m.tenant_id and a.entity_id = m.app_user_id and a.action = 'app_user.mfa_enrolled'
                and a.after ->> 'factorId' = p_factor::text) then
    return false;
  end if;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (m.tenant_id, 'app_user', m.app_user_id, 'app_user.mfa_enrolled',
            jsonb_build_object('factorId', p_factor, 'slot', case v_name when 'Principale' then 'principale' when 'Riserva' then 'riserva' else 'altro' end),
            m.app_user_id);
  return true;
end
$$;

create function public.mfa_unenrol_check(p_factor uuid) returns void
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  m record;
  v_status auth.factor_status;
begin
  select * into m from app.membership_ungated();
  if not found or m.role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select f.status into v_status from auth.mfa_factors f where f.id = p_factor and f.user_id = m.auth_id and f.factor_type = 'totp';
  if not found then
    raise exception 'mfa_factor_not_found' using errcode = 'P0001';
  end if;
  if v_status = 'verified' then
    perform app.require_aal2();
    if m.role = 'admin'
       and (select t.mfa_enforcement from public.tenant t where t.id = m.tenant_id) = 'required'
       and (select count(*) from auth.mfa_factors f where f.user_id = m.auth_id and f.status = 'verified' and f.factor_type = 'totp') <= 1 then
      raise exception 'mfa_last_factor' using errcode = 'P0001';
    end if;
  end if;
end
$$;

create function public.mfa_record_unenrolled(p_factor uuid) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  m record;
  v_slot text;
begin
  select * into m from app.membership_ungated();
  if not found or m.role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if exists (select 1 from auth.mfa_factors f where f.id = p_factor) then
    raise exception 'mfa_factor_still_present' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mfa-audit:' || m.app_user_id::text, 0));
  select a.after ->> 'slot' into v_slot from public.audit_event a
   where a.tenant_id = m.tenant_id and a.entity_id = m.app_user_id and a.action = 'app_user.mfa_enrolled' and a.after ->> 'factorId' = p_factor::text;
  if not found then
    return false; -- an abandoned, never verified factor is not audited
  end if;
  if exists (select 1 from public.audit_event a where a.tenant_id = m.tenant_id and a.entity_id = m.app_user_id and a.action = 'app_user.mfa_unenrolled'
                and a.after ->> 'factorId' = p_factor::text) then
    return false;
  end if;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (m.tenant_id, 'app_user', m.app_user_id, 'app_user.mfa_unenrolled', jsonb_build_object('factorId', p_factor, 'slot', v_slot), m.app_user_id);
  return true;
end
$$;

revoke all on function public.mfa_gate(), public.mfa_status(), public.mfa_attempt_allowed(), public.mfa_record_failure(text), public.mfa_enrol_check(text),
  public.mfa_record_enrolled(uuid), public.mfa_unenrol_check(uuid), public.mfa_record_unenrolled(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mfa_gate(), public.mfa_status(), public.mfa_attempt_allowed(), public.mfa_record_failure(text), public.mfa_enrol_check(text),
  public.mfa_record_enrolled(uuid), public.mfa_unenrol_check(uuid), public.mfa_record_unenrolled(uuid) to authenticated;
