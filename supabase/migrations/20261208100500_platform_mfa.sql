-- SP3 step 9 (docs/plans/2026-11-15-sp3-console.md §3.3.5, §3.1.7; flags 3 and 4; Q-P5 as changed): the account-level second factor for platform staff, who have no venue
-- membership. FD31 makes the platform admin need aal2 everywhere, but today's second-factor procedures all need a membership of the token's tenant, so a fresh platform admin
-- could neither enrol nor pass its code. This migration adds, without changing any answer for an owner or an admin of a venue:
--  * platform.mfa_failure: platform staff's own wrong codes, for the lock. It reuses app.mfa_lock_failures() and app.mfa_lock_minutes(). Closed to every API role.
--  * public.mfa_enrol_check(text), re-created with the same signature, owner, grants and answers for owners and admins (pgTAP 342 and 349 stay green unchanged), and one new branch:
--    when app.membership_ungated() finds no owner or admin row and the caller has an ACTIVE platform.staff row, the same slot, limit and aal2 rules apply and the answer is
--    {"issuer": "Costì", "friendlyName": <slot name>}. Every other caller without a membership is still refused with 42501. The staff branch asks aal2 itself (app.require_aal2
--    only looks at memberships, so it would never raise for staff).
--  * public.platform_mfa_attempt_allowed(), public.platform_mfa_record_failure(text) and public.platform_mfa_record_enrolled(uuid), for an active staff row only (else 42501),
--    with or without a tenant claim. The first two keep public.mfa_attempt_allowed's lock rule and answer shape, keyed by auth_id; the third writes platform_admin.factor_enrolled
--    once per factor (the factor id is in the detail, so the audit itself is the once-per-factor record).
-- The factor id joins the audit's detail keys (platform.audit_detail_keys, step 2's migration), as an id like the others.

create table platform.mfa_failure (
  id bigint generated always as identity constraint platform_mfa_failure_pkey primary key,
  auth_id uuid not null constraint platform_mfa_failure_auth_id_fkey references platform.staff (auth_id),
  stage text not null constraint platform_mfa_failure_stage_check check (stage in ('login', 'enrol')),
  at timestamptz not null default now()
);
create index platform_mfa_failure_auth_at_idx on platform.mfa_failure (auth_id, at);
alter table platform.mfa_failure enable row level security;
revoke all on platform.mfa_failure from public, anon, authenticated, service_role;
revoke all on sequence platform.mfa_failure_id_seq from public, anon, authenticated, service_role;

create or replace function public.mfa_enrol_check(p_slot text) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  m record;
  v_name text;
  v_auth uuid;
  v_issuer text;
  v_staff boolean := false;
begin
  select * into m from app.membership_ungated();
  if found and m.role in ('owner', 'admin') then
    v_auth := m.auth_id;
    v_issuer := (select t.name from public.tenant t where t.id = m.tenant_id);
  elsif auth.uid() is not null and exists (select 1 from platform.staff s where s.auth_id = auth.uid() and s.is_active) then
    v_staff := true;
    v_auth := auth.uid();
    v_issuer := 'Costì';
  else
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  v_name := case p_slot when 'principale' then 'Principale' when 'riserva' then 'Riserva' end;
  if v_name is null then
    raise exception 'invalid_slot' using errcode = '22023';
  end if;
  -- Adding a factor to an account that already has one is a protected act (Supabase asks for aal2 as well).
  if app.mfa_has_verified_factor(v_auth) then
    if v_staff then
      if app.jwt_aal() <> 'aal2' then
        raise exception 'mfa_required' using errcode = 'P0001';
      end if;
    else
      perform app.require_aal2();
    end if;
  end if;
  if (select count(*) from auth.mfa_factors f where f.user_id = v_auth and f.status = 'verified' and f.factor_type = 'totp') >= app.mfa_max_factors() then
    raise exception 'mfa_factor_limit' using errcode = 'P0001';
  end if;
  if exists (select 1 from auth.mfa_factors f where f.user_id = v_auth and f.status = 'verified' and f.factor_type = 'totp' and f.friendly_name = v_name) then
    raise exception 'mfa_slot_taken' using errcode = 'P0001';
  end if;
  return jsonb_build_object('issuer', v_issuer, 'friendlyName', v_name);
end
$$;

create function public.platform_mfa_attempt_allowed() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_auth uuid := auth.uid();
  v_n integer;
  v_at timestamptz;
  v_window interval := make_interval(mins => app.mfa_lock_minutes());
  v_retry integer;
begin
  if v_auth is null or not exists (select 1 from platform.staff s where s.auth_id = v_auth and s.is_active) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select count(*) into v_n from platform.mfa_failure f where f.auth_id = v_auth and f.at > clock_timestamp() - v_window;
  if v_n < app.mfa_lock_failures() then
    return jsonb_build_object('allowed', true, 'retryAfterSeconds', 0);
  end if;
  -- The lock lifts when the failures in the window drop below the limit: the (n - limit + 1)th oldest has to age out.
  select f.at into v_at from platform.mfa_failure f
   where f.auth_id = v_auth and f.at > clock_timestamp() - v_window
   order by f.at, f.id offset v_n - app.mfa_lock_failures() limit 1;
  v_retry := greatest(1, ceil(extract(epoch from (v_at + v_window - clock_timestamp())))::integer);
  return jsonb_build_object('allowed', false, 'retryAfterSeconds', v_retry);
end
$$;

create function public.platform_mfa_record_failure(p_stage text) returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_auth uuid := auth.uid();
begin
  if v_auth is null or not exists (select 1 from platform.staff s where s.auth_id = v_auth and s.is_active) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_stage is null or p_stage not in ('login', 'enrol') then
    raise exception 'invalid_stage' using errcode = '22023';
  end if;
  insert into platform.mfa_failure (auth_id, stage) values (v_auth, p_stage);
end
$$;

create function public.platform_mfa_record_enrolled(p_factor uuid) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_auth uuid := auth.uid();
  v_name text;
begin
  if v_auth is null or not exists (select 1 from platform.staff s where s.auth_id = v_auth and s.is_active) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select f.friendly_name into v_name from auth.mfa_factors f
   where f.id = p_factor and f.user_id = v_auth and f.status = 'verified' and f.factor_type = 'totp';
  if not found then
    raise exception 'mfa_factor_not_verified' using errcode = 'P0001';
  end if;
  -- One account, one writer at a time: two calls for the same factor record it once.
  perform pg_advisory_xact_lock(hashtextextended('platform-mfa-audit:' || v_auth::text, 0));
  if exists (select 1 from platform.audit_event a where a.action = 'platform_admin.factor_enrolled' and a.detail ->> 'factorId' = p_factor::text) then
    return false;
  end if;
  perform platform.audit_write('console', 'platform_admin.factor_enrolled', null,
    jsonb_build_object('authId', v_auth, 'factorId', p_factor,
                       'slot', case v_name when 'Principale' then 'principale' when 'Riserva' then 'riserva' else 'altro' end));
  return true;
end
$$;

revoke all on function public.platform_mfa_attempt_allowed(), public.platform_mfa_record_failure(text), public.platform_mfa_record_enrolled(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.platform_mfa_attempt_allowed(), public.platform_mfa_record_failure(text), public.platform_mfa_record_enrolled(uuid) to authenticated;
