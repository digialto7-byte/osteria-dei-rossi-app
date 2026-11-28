-- SP3 step 13 (docs/plans/2026-11-15-sp3-console.md §3.1.5, §3.3.2; AT3, AT12): the console mode switches.
--  * platform.console_session: one row per session in console mode. Session state, not a ledger: written by select_console, deleted by platform_leave_console,
--    select_tenant and the auth purge (step 22). Only the hook reads it (supabase_auth_admin; step 14). No foreign key to auth.sessions (as app.session_tenant).
--  * public.select_console(): the active platform admin with a verified factor at aal2 puts this session in console mode: its venue selection is deleted and its
--    console row stored; console.entered is written when the row is new. Executable by authenticated only (a console token cannot call it again).
--  * public.platform_leave_console(): the way out inside one session (a console token cannot call select_tenant): deletes the caller's own row of this session and
--    writes console.left when there was one. Executable by platform_staff only.
--  * public.select_tenant(uuid): SP2's body (20261207100200_select_tenant.sql) with one added statement once the session is known: this session's console row is
--    deleted, so a session is in one mode at a time. Every SP2 answer is unchanged (pgTAP 432).

create table platform.console_session (
  session_id uuid constraint platform_console_session_pkey primary key,
  auth_id uuid not null constraint platform_console_session_auth_id_fkey references platform.staff (auth_id),
  selected_at timestamptz not null default now()
);
alter table platform.console_session enable row level security;
revoke all on platform.console_session from public, anon, authenticated, service_role, platform_staff;
grant select on platform.console_session to supabase_auth_admin;
create policy console_session_read_by_auth_hook on platform.console_session
  for select to supabase_auth_admin using (true);

create function public.select_console() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_auth uuid := auth.uid();
  v_session uuid;
  v_added integer;
begin
  if v_auth is null then
    raise exception 'not_platform_staff' using errcode = '42501';
  end if;
  begin
    v_session := (auth.jwt() ->> 'session_id')::uuid;
  exception when others then
    v_session := null;
  end;
  if v_session is null then
    raise exception 'session_missing' using errcode = 'P0001';
  end if;
  if not exists (select 1 from platform.staff s where s.auth_id = v_auth and s.role = 'platform_admin' and s.is_active) then
    raise exception 'not_platform_staff' using errcode = '42501';
  end if;
  if not app.mfa_has_verified_factor(v_auth) then
    raise exception 'mfa_factor_required' using errcode = 'P0001';
  end if;
  if app.jwt_aal() <> 'aal2' then
    raise exception 'mfa_required' using errcode = 'P0001';
  end if;

  delete from app.session_tenant s where s.session_id = v_session;
  insert into platform.console_session (session_id, auth_id) values (v_session, v_auth)
    on conflict (session_id) do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform platform.audit_write('console', 'console.entered', null, '{}'::jsonb);
  end if;
  return jsonb_build_object('changed', v_added > 0);
end
$$;
revoke all on function public.select_console() from public, anon, service_role, platform_staff;
grant execute on function public.select_console() to authenticated;

create function public.platform_leave_console() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_auth uuid := auth.uid();
  v_session uuid;
  v_gone integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'platform_staff' or v_auth is null then
    raise exception 'console_required' using errcode = '42501';
  end if;
  begin
    v_session := (auth.jwt() ->> 'session_id')::uuid;
  exception when others then
    v_session := null;
  end;
  if v_session is null then
    raise exception 'session_missing' using errcode = 'P0001';
  end if;

  delete from platform.console_session c where c.session_id = v_session and c.auth_id = v_auth;
  get diagnostics v_gone = row_count;
  if v_gone > 0 then
    perform platform.audit_write('console', 'console.left', null, '{}'::jsonb);
  end if;
  return jsonb_build_object('changed', v_gone > 0);
end
$$;
revoke all on function public.platform_leave_console() from public, anon, authenticated, service_role;
grant execute on function public.platform_leave_console() to platform_staff;

create or replace function public.select_tenant(p_tenant uuid) returns jsonb
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_auth uuid := auth.uid();
  v_session uuid;
  v_prev_tenant uuid;
  v_prev_at timestamptz;
  v_had_row boolean;
begin
  -- The caller and its session first.
  if v_auth is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  begin
    v_session := (auth.jwt() ->> 'session_id')::uuid;
  exception when others then
    v_session := null;
  end;
  if v_session is null then
    raise exception 'session_missing' using errcode = 'P0001';
  end if;
  -- SP3 step 13: choosing a venue ends this session's console mode. A refusal below rolls this back with the rest.
  delete from platform.console_session c where c.session_id = v_session;
  -- A PIN login is bound to one tenant and one device (ADR-010): it never selects.
  if auth.jwt() ->> 'login' = 'pin'
     or exists (select 1 from public.app_user u where u.auth_id = v_auth and u.login_method = 'pin') then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  -- The same answer for an unknown tenant, a tenant without a membership and an inactive membership.
  if not exists (select 1 from public.app_user u where u.auth_id = v_auth and u.tenant_id = p_tenant and u.is_active) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select s.tenant_id, s.selected_at into v_prev_tenant, v_prev_at
    from app.session_tenant s
   where s.session_id = v_session
     for update;
  v_had_row := found;
  if v_had_row and v_prev_tenant = p_tenant then
    return jsonb_build_object('tenantId', p_tenant, 'changed', false);
  end if;
  if v_had_row and v_prev_at > now() - app.tenant_switch_min_interval() then
    raise exception 'tenant_switch_too_soon' using errcode = 'P0001';
  end if;

  insert into app.session_tenant (session_id, auth_id, tenant_id, selected_at)
    values (v_session, v_auth, p_tenant, now())
    on conflict (session_id) do update
      set auth_id = excluded.auth_id, tenant_id = excluded.tenant_id, selected_at = excluded.selected_at;
  return jsonb_build_object('tenantId', p_tenant, 'changed', true);
end
$$;
