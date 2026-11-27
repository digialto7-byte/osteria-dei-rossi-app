-- SP2 S4 (docs/plans/2026-11-26-sp02-memberships.md §3.3; ADR-038): a session chooses its tenant, and a login lists its own venues. Both work
-- without a tenant claim (that is when they are needed), so they cannot reach the gated helpers; pgTAP 341 names them on its exempt_session list
-- ("own identity only; no tenant data"). select_tenant works at aal1 on purpose: it only stores the choice; the #79 gate applies to every query
-- after the server refreshes the session. SP4 adds the platform admin's entry audit here.

-- The shortest time between two switches of one session to different tenants (a bound on Auth refreshes per person; plan risk R6).
create function app.tenant_switch_min_interval() returns interval
  language sql immutable
  set search_path = ''
as $$ select interval '3 seconds' $$;
revoke all on function app.tenant_switch_min_interval() from public, anon, authenticated, service_role;

create function public.select_tenant(p_tenant uuid) returns jsonb
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
revoke all on function public.select_tenant(uuid) from public, anon, service_role;
grant execute on function public.select_tenant(uuid) to authenticated;

-- The caller's own active memberships: [{tenantId, name, role}] by tenant name then id. No money, no other person.
create function public.my_memberships() returns jsonb
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tenantId', t.id, 'name', t.name, 'role', u.role) order by t.name, t.id), '[]'::jsonb)
    from public.app_user u
    join public.tenant t on t.id = u.tenant_id
   where u.auth_id = auth.uid()
     and u.is_active
$$;
revoke all on function public.my_memberships() from public, anon, service_role;
grant execute on function public.my_memberships() to authenticated;
