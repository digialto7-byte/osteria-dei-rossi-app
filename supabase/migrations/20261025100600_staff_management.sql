-- M11 step 7: staff and device management for the owner and admin (M11 plan §3.1.8, §3.1.9, §3.2).
-- Every procedure: role check first (app.require_staff_manager), search_path = '', tenant from the session,
-- execute to `authenticated` only. The Supabase Auth admin calls (create the auth user, set its password) are
-- made by the route between these procedures; they are never made from Postgres. No PIN and nothing derived
-- from one is passed to any procedure below.

create function public.assert_staff_manager() returns void
  language plpgsql stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_staff_manager();
end
$$;

-- Chef and waiter rows of the tenant. There is deliberately no login time of any person here (project Q10).
create function public.staff_list()
  returns table (id uuid, display_name text, role public.app_role, login_method public.login_method,
                 is_active boolean, locked_until timestamptz)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_staff_manager();
  return query
    select u.id, u.display_name, u.role, u.login_method, u.is_active,
           case when u.login_method = 'pin' then app.user_lock_until(u.id, clock_timestamp()) end
      from public.app_user u
     where u.tenant_id = app.tenant_id() and u.role in ('chef', 'waiter')
     order by u.display_name, u.id;
end
$$;

-- The auth user must have been created by the route as staff-<id>@...; it must not be linked yet.
create function public.create_staff(p_id uuid, p_auth_id uuid, p_display_name text, p_role public.app_role)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_name text := btrim(coalesce(p_display_name, ''));
  v_actor uuid;
begin
  perform app.require_staff_manager();
  v_tenant := app.tenant_id();
  v_actor := app.app_user_id();
  if p_role is null or p_role not in ('chef', 'waiter') then
    raise exception 'staff_role_invalid' using errcode = 'P0001';
  end if;
  if length(v_name) not between 1 and 60 then
    raise exception 'display_name_invalid' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users au
                  where au.id = p_auth_id and au.email like 'staff-' || v_id::text || '@%')
     or exists (select 1 from public.app_user u where u.auth_id = p_auth_id) then
    raise exception 'auth_user_invalid' using errcode = 'P0001';
  end if;

  insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, created_by)
    values (v_id, v_tenant, p_auth_id, p_role, v_name, 'pin', v_actor);
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_tenant, 'app_user', v_id, 'app_user.created',
            jsonb_build_object('display_name', v_name, 'role', p_role), v_actor);

  return jsonb_build_object('id', v_id, 'displayName', v_name, 'role', p_role, 'active', true);
end
$$;

create function public.update_staff(
  p_user uuid, p_display_name text default null, p_role public.app_role default null,
  p_active boolean default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_actor uuid;
  v_u public.app_user;
  v_name text := case when p_display_name is null then null else btrim(p_display_name) end;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_changed boolean := false;
begin
  perform app.require_staff_manager();
  v_tenant := app.tenant_id();
  v_actor := app.app_user_id();
  select * into v_u from public.app_user u
   where u.id = p_user and u.tenant_id = v_tenant and u.role in ('chef', 'waiter') for update;
  if not found then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;
  if p_display_name is null and p_role is null and p_active is null then
    raise exception 'nothing_to_change' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) not between 1 and 60 then
    raise exception 'display_name_invalid' using errcode = 'P0001';
  end if;
  if p_role is not null and p_role not in ('chef', 'waiter') then
    raise exception 'staff_role_invalid' using errcode = 'P0001';
  end if;

  if v_name is not null and v_name is distinct from v_u.display_name then
    v_before := v_before || jsonb_build_object('display_name', v_u.display_name);
    v_after := v_after || jsonb_build_object('display_name', v_name);
  end if;
  if p_role is not null and p_role is distinct from v_u.role then
    v_before := v_before || jsonb_build_object('role', v_u.role);
    v_after := v_after || jsonb_build_object('role', p_role);
  end if;
  if p_active is not null and p_active is distinct from v_u.is_active then
    v_changed := true;
  end if;
  if v_after = '{}'::jsonb and not v_changed then
    raise exception 'nothing_to_change' using errcode = 'P0001';
  end if;

  update public.app_user
     set display_name = coalesce(v_after ->> 'display_name', display_name),
         role = coalesce((v_after ->> 'role')::public.app_role, role),
         is_active = coalesce(p_active, is_active),
         deactivated_at = case when coalesce(p_active, is_active) then null
                               else coalesce(deactivated_at, clock_timestamp()) end
   where id = v_u.id;

  if v_after <> '{}'::jsonb then
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
      values (v_tenant, 'app_user', v_u.id, 'app_user.updated', v_before, v_after, v_actor);
  end if;
  if v_changed and not p_active then
    perform app.end_staff_sessions(null, v_u.id, 'deactivated', clock_timestamp());
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
      values (v_tenant, 'app_user', v_u.id, 'app_user.deactivated', v_actor);
  elsif v_changed then
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
      values (v_tenant, 'app_user', v_u.id, 'app_user.reactivated', v_actor);
  end if;

  select * into v_u from public.app_user u where u.id = p_user;
  return jsonb_build_object('id', v_u.id, 'displayName', v_u.display_name, 'role', v_u.role,
                            'active', v_u.is_active);
end
$$;

-- The target of a PIN change: an active `pin` chef or waiter of the tenant.
create function app.pin_change_target(p_user uuid) returns public.app_user
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_u public.app_user;
begin
  select * into v_u from public.app_user u
   where u.id = p_user and u.tenant_id = app.tenant_id() and u.role in ('chef', 'waiter');
  if not found then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;
  if not v_u.is_active then
    raise exception 'staff_inactive' using errcode = 'P0001';
  end if;
  if v_u.login_method <> 'pin' then
    raise exception 'staff_not_pin' using errcode = 'P0001';
  end if;
  return v_u;
end
$$;
revoke all on function app.pin_change_target(uuid) from public, anon, authenticated, service_role;

create function public.prepare_pin_change(p_user uuid) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_u public.app_user;
begin
  perform app.require_staff_manager();
  v_u := app.pin_change_target(p_user);
  return jsonb_build_object('authId', v_u.auth_id);
end
$$;

-- Called after the route set the new password in Supabase Auth. A pin_reset row ends the user's run of
-- failures (and so any lock); open sessions end. No before/after: nothing about the PIN is recorded.
create function public.record_pin_change(p_user uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_u public.app_user;
  v_now timestamptz := clock_timestamp();
begin
  perform app.require_staff_manager();
  v_u := app.pin_change_target(p_user);
  insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
    values (v_u.tenant_id, null, v_u.id, 'pin_reset', v_now, v_now);
  perform app.end_staff_sessions(null, v_u.id, 'pin_reset', v_now);
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
    values (v_u.tenant_id, 'app_user', v_u.id, 'app_user.pin_set', app.app_user_id());
end
$$;

-- Devices ------------------------------------------------------------------------------------------------------
create function app.device_json(p_d public.venue_device) returns jsonb
  language sql immutable
  set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_d.id, 'label', p_d.label,
    'status', case when p_d.revoked_at is not null then 'revocato'
                   when p_d.locked_at is not null then 'bloccato' else 'attivo' end,
    'enrolledAt', p_d.enrolled_at, 'lastLoginAt', p_d.last_login_at, 'lockedAt', p_d.locked_at)
$$;
revoke all on function app.device_json(public.venue_device) from public, anon, authenticated, service_role;

create function public.device_overview() returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_staff_manager();
  v_tenant := app.tenant_id();
  return jsonb_build_object(
    'devices', coalesce((select jsonb_agg(app.device_json(d) order by d.enrolled_at, d.id)
                           from public.venue_device d where d.tenant_id = v_tenant), '[]'::jsonb),
    'pendingCodes', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'label', e.label, 'expiresAt', e.expires_at)
                       order by e.expires_at, e.id)
        from public.device_enrolment e
       where e.tenant_id = v_tenant and e.used_at is null and e.expires_at > clock_timestamp()),
      '[]'::jsonb));
end
$$;

-- A state change, idempotent: a second revoke writes nothing new.
create function public.revoke_device(p_device uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_d public.venue_device;
  v_now timestamptz := clock_timestamp();
begin
  perform app.require_staff_manager();
  select * into v_d from public.venue_device d where d.id = p_device and d.tenant_id = app.tenant_id() for update;
  if not found then
    raise exception 'device_not_found' using errcode = 'P0002';
  end if;
  if v_d.revoked_at is null then
    update public.venue_device set revoked_at = v_now, revoked_by = app.app_user_id() where id = v_d.id;
    perform app.end_staff_sessions(v_d.id, null, 'device_revoked', v_now);
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
      values (v_d.tenant_id, 'venue_device', v_d.id, 'venue_device.revoked',
              jsonb_build_object('label', v_d.label), app.app_user_id());
    select * into v_d from public.venue_device d where d.id = p_device;
  end if;
  return app.device_json(v_d);
end
$$;

create function public.unlock_device(p_device uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_d public.venue_device;
begin
  perform app.require_staff_manager();
  select * into v_d from public.venue_device d where d.id = p_device and d.tenant_id = app.tenant_id() for update;
  if not found then
    raise exception 'device_not_found' using errcode = 'P0002';
  end if;
  if v_d.revoked_at is not null then
    raise exception 'device_revoked' using errcode = 'P0001';
  end if;
  if v_d.locked_at is not null then
    update public.venue_device set locked_at = null, unlocked_at = clock_timestamp() where id = v_d.id;
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
      values (v_d.tenant_id, 'venue_device', v_d.id, 'venue_device.unlocked',
              jsonb_build_object('label', v_d.label), app.app_user_id());
    select * into v_d from public.venue_device d where d.id = p_device;
  end if;
  return app.device_json(v_d);
end
$$;

revoke all on function public.assert_staff_manager(), public.staff_list(),
  public.create_staff(uuid, uuid, text, public.app_role),
  public.update_staff(uuid, text, public.app_role, boolean), public.prepare_pin_change(uuid),
  public.record_pin_change(uuid), public.device_overview(), public.revoke_device(uuid),
  public.unlock_device(uuid) from public, anon, authenticated, service_role;
grant execute on function public.assert_staff_manager(), public.staff_list(),
  public.create_staff(uuid, uuid, text, public.app_role),
  public.update_staff(uuid, text, public.app_role, boolean), public.prepare_pin_change(uuid),
  public.record_pin_change(uuid), public.device_overview(), public.revoke_device(uuid),
  public.unlock_device(uuid) to authenticated;
