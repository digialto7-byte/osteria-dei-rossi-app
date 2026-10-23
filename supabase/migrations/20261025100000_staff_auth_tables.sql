-- M11 step 1: staff PIN login tables (M11 plan §3.2; ADR-010).
-- A PIN account is a Supabase auth user; the PIN itself is verified by Supabase Auth and never reaches
-- any table below. These tables hold devices, single-use enrolment codes, the outcome of each login
-- attempt (outcome only: no PIN, no hash of a PIN) and staff sessions.
--
-- auth_attempt, staff_session, device_enrolment and app.enrol_failure are security logs of personal
-- data, not ledgers: a daily retention job (step 9) may delete rows past retention, and nothing else
-- can (guard triggers below, no DELETE grant for any API role).

create type public.login_method as enum ('email', 'pin');
create type public.auth_attempt_outcome as enum ('pending', 'success', 'failure', 'error', 'pin_reset');
create type public.staff_session_end as enum
  ('logout', 'device_revoked', 'device_locked', 'pin_reset', 'deactivated');

-- Existing users, the owner, admins and every fixture stay 'email'. Only public.create_staff (step 7)
-- makes 'pin' rows; the M0 INSERT grant does not include this column.
alter table public.app_user
  add column login_method public.login_method not null default 'email',
  add constraint app_user_login_method_ck check (login_method = 'email' or role in ('chef', 'waiter'));
-- (tenant_id, id) is already unique since M6 (app_user_tenant_id_id_uq): the target of the composite keys below.
grant select (id, login_method) on public.app_user to supabase_auth_admin;

-- Devices ------------------------------------------------------------------------------------------------------
create table public.venue_device (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  label text not null check (length(btrim(label)) between 1 and 60),
  -- sha256 of the device token held in the browser's cookie; the token itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- The foreign key to device_enrolment is added in 20261025100200_enrolment.sql.
  enrolment_id uuid unique,
  enrolled_at timestamptz not null default clock_timestamp(),
  last_login_at timestamptz,
  locked_at timestamptz,
  unlocked_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint venue_device_tenant_id_id_uq unique (tenant_id, id),
  constraint venue_device_created_by_fk foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id),
  constraint venue_device_revoked_by_fk foreign key (tenant_id, revoked_by)
    references public.app_user (tenant_id, id),
  constraint venue_device_revoked_ck check ((revoked_at is null) = (revoked_by is null))
);
create index venue_device_tenant_revoked_idx on public.venue_device (tenant_id, revoked_at);

create table public.device_enrolment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  label text not null check (length(btrim(label)) between 1 and 60),
  -- sha256 of the 8-character code; the code is shown once to the owner and never stored.
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  device_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint device_enrolment_tenant_id_id_uq unique (tenant_id, id),
  constraint device_enrolment_device_fk foreign key (tenant_id, device_id)
    references public.venue_device (tenant_id, id),
  constraint device_enrolment_created_by_fk foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id),
  constraint device_enrolment_used_ck check ((used_at is null) = (device_id is null))
);
create index device_enrolment_tenant_idx on public.device_enrolment (tenant_id, expires_at);

-- Login attempts ------------------------------------------------------------------------------------------------
create table public.auth_attempt (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  -- Null only for 'pin_reset' rows (an owner's reset has no device).
  device_id uuid,
  -- Null = the user id presented did not name an active PIN account of the device's tenant.
  app_user_id uuid,
  outcome public.auth_attempt_outcome not null default 'pending',
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  constraint auth_attempt_device_fk foreign key (tenant_id, device_id)
    references public.venue_device (tenant_id, id),
  constraint auth_attempt_user_fk foreign key (tenant_id, app_user_id)
    references public.app_user (tenant_id, id),
  constraint auth_attempt_finished_ck check ((outcome = 'pending') = (finished_at is null)),
  constraint auth_attempt_reset_ck check ((outcome = 'pin_reset') = (device_id is null))
);
comment on table public.auth_attempt is 'No PIN, no hash of a PIN, no password: outcome only.';
create index auth_attempt_user_idx on public.auth_attempt (app_user_id, started_at desc);
create index auth_attempt_device_idx on public.auth_attempt (device_id, started_at desc);

create table public.staff_session (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  app_user_id uuid not null,
  device_id uuid not null,
  -- The Supabase Auth session id (the access token's session_id claim).
  auth_session_id uuid not null unique,
  started_at timestamptz not null default clock_timestamp(),
  ends_at timestamptz not null,
  ended_at timestamptz,
  end_reason public.staff_session_end,
  constraint staff_session_user_fk foreign key (tenant_id, app_user_id)
    references public.app_user (tenant_id, id),
  constraint staff_session_device_fk foreign key (tenant_id, device_id)
    references public.venue_device (tenant_id, id),
  constraint staff_session_ended_ck check ((ended_at is null) = (end_reason is null))
);
create index staff_session_device_open_idx on public.staff_session (device_id) where ended_at is null;
create index staff_session_user_open_idx on public.staff_session (app_user_id) where ended_at is null;

-- Failed enrolment redemptions per hashed client IP (rate limit). Cross-tenant like app.job_run: outside
-- `public`, RLS on, no policy, no API privilege. Kept 1 day.
create table app.enrol_failure (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default clock_timestamp()
);
create index enrol_failure_ip_at_idx on app.enrol_failure (ip_hash, at desc);

-- Guards ----------------------------------------------------------------------------------------------------------
-- Deletion is retention, not ledger editing: only app.purge_auth_data (step 9) sets app.auth_purge.
create function app.auth_attempt_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.auth_purge', true), '') <> 'on' then
      raise exception 'auth_attempt_immutable' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.outcome <> 'pending' or new.outcome not in ('success', 'failure', 'error')
     or (new.id, new.tenant_id, new.device_id, new.app_user_id, new.started_at)
        is distinct from (old.id, old.tenant_id, old.device_id, old.app_user_id, old.started_at) then
    raise exception 'auth_attempt_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create function app.staff_session_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.auth_purge', true), '') <> 'on' then
      raise exception 'staff_session_immutable' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.ended_at is not null or new.ended_at is null or new.end_reason is null
     or (new.id, new.tenant_id, new.app_user_id, new.device_id, new.auth_session_id, new.started_at,
         new.ends_at)
        is distinct from (old.id, old.tenant_id, old.app_user_id, old.device_id, old.auth_session_id,
                          old.started_at, old.ends_at) then
    raise exception 'staff_session_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create function app.device_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'venue_device_immutable' using errcode = 'P0001';
  end if;
  if (new.id, new.tenant_id, new.label, new.token_hash, new.enrolment_id, new.enrolled_at, new.created_at,
      new.created_by)
     is distinct from (old.id, old.tenant_id, old.label, old.token_hash, old.enrolment_id, old.enrolled_at,
                       old.created_at, old.created_by)
     or (old.revoked_at is not null
         and (new.revoked_at, new.revoked_by) is distinct from (old.revoked_at, old.revoked_by)) then
    raise exception 'venue_device_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create function app.enrolment_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.auth_purge', true), '') <> 'on' or old.used_at is not null then
      raise exception 'device_enrolment_immutable' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if (new.id, new.tenant_id, new.label, new.code_hash, new.expires_at, new.created_at, new.created_by)
     is distinct from (old.id, old.tenant_id, old.label, old.code_hash, old.expires_at, old.created_at,
                       old.created_by)
     or (old.used_at is not null
         and (new.used_at, new.device_id) is distinct from (old.used_at, old.device_id)) then
    raise exception 'device_enrolment_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create function app.auth_table_no_truncate() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'truncate_refused' using errcode = 'P0001';
end
$$;
revoke all on function app.auth_attempt_guard(), app.staff_session_guard(), app.device_guard(),
  app.enrolment_guard(), app.auth_table_no_truncate() from public, anon;

create trigger auth_attempt_guard before update or delete on public.auth_attempt
  for each row execute function app.auth_attempt_guard();
create trigger staff_session_guard before update or delete on public.staff_session
  for each row execute function app.staff_session_guard();
create trigger venue_device_guard before update or delete on public.venue_device
  for each row execute function app.device_guard();
create trigger device_enrolment_guard before update or delete on public.device_enrolment
  for each row execute function app.enrolment_guard();
create trigger auth_attempt_no_truncate before truncate on public.auth_attempt
  for each statement execute function app.auth_table_no_truncate();
create trigger staff_session_no_truncate before truncate on public.staff_session
  for each statement execute function app.auth_table_no_truncate();
create trigger venue_device_no_truncate before truncate on public.venue_device
  for each statement execute function app.auth_table_no_truncate();
create trigger device_enrolment_no_truncate before truncate on public.device_enrolment
  for each statement execute function app.auth_table_no_truncate();

-- RLS and grants ------------------------------------------------------------------------------------------------------
alter table public.venue_device enable row level security;
alter table public.device_enrolment enable row level security;
alter table public.auth_attempt enable row level security;
alter table public.staff_session enable row level security;
alter table app.enrol_failure enable row level security;

revoke all on public.venue_device, public.device_enrolment, public.auth_attempt, public.staff_session,
  app.enrol_failure from public, anon, authenticated, service_role;

-- Owner and admin read devices and codes, without the hash columns.
grant select (id, tenant_id, label, enrolment_id, enrolled_at, last_login_at, locked_at, unlocked_at,
              revoked_at, revoked_by, created_at, created_by)
  on public.venue_device to authenticated;
grant select (id, tenant_id, label, expires_at, used_at, device_id, created_at, created_by)
  on public.device_enrolment to authenticated;
create policy venue_device_select on public.venue_device
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy device_enrolment_select on public.device_enrolment
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

-- The access token hook reads these (step 6). It is the only reader besides the definer procedures.
grant select on public.auth_attempt, public.staff_session to supabase_auth_admin;
grant select (id, revoked_at, locked_at) on public.venue_device to supabase_auth_admin;
create policy auth_attempt_read_by_auth_hook on public.auth_attempt
  for select to supabase_auth_admin using (true);
create policy staff_session_read_by_auth_hook on public.staff_session
  for select to supabase_auth_admin using (true);
create policy venue_device_read_by_auth_hook on public.venue_device
  for select to supabase_auth_admin using (true);

-- Audit lists ------------------------------------------------------------------------------------------------------------
-- Widened with every existing value kept (latest list: 20261024100000_payable_status.sql).
alter table public.audit_event
  drop constraint audit_event_entity_type_check,
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_entity_type_check
    check (entity_type in ('invoice', 'ingredient', 'recipe', 'tenant', 'payable', 'app_user',
                           'venue_device', 'device_enrolment')),
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed', 'payable.payment_reversed',
                      'app_user.created', 'app_user.updated', 'app_user.deactivated',
                      'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created',
                      'venue_device.enrolled', 'venue_device.revoked', 'venue_device.unlocked'));
