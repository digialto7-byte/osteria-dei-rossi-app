-- P2-1 A4 (docs/plans/2026-11-12-p2-1-totp.md section 3.3, 3.7, 5 A4; founder decision Q-T1 = V1 of 2026-11-12: no in-app reset of an authenticator).
--
--   public.mfa_accounts()                 gated (owner, admin; a gated account gets 42501 like everywhere): the OTHER active owner and admin accounts of the
--                                         tenant as [{id, displayName, role, factorCount}], counts only, so a person can see that an admin has no factor and tell
--                                         DigiAlto. Read-only: there is no reset function for an authenticated user (pgTAP 350).
--   public.set_mfa_enforcement(tenant, mode, actor)   service role only (scripts/set-mfa-enforcement.ts). off | enrolled | required; required is refused with
--                                         P0001 admins_not_enrolled (DETAIL {"count": n}) while an active admin has no verified factor; the actor must be an active
--                                         admin of the tenant (P0001 actor_invalid); the same mode is a no-op; a change writes one audit row tenant.mfa_enforcement_changed.
--   public.mfa_reset_service_begin / _failed   the break-glass twins for scripts/mfa-reset.ts (service role only). begin deletes the target's auth.sessions (their refresh tokens cascade), writes app_user.mfa_reset with after {"sessions_revoked": n} (T-8: before the Auth
--                                         call) and returns {authId}; failed writes app_user.mfa_reset_failed, only within 5 minutes of the same actor's begin for that
--                                         target. The service role has no app.tenant_id(), so the tenant is the target's; the actor must be an active admin of it.
--   app.mfa_reset_pending_minutes()       the constant 5.
-- Errors carry fixed names and codes only. No function takes a code or a secret.

create function app.mfa_reset_pending_minutes() returns integer language sql immutable set search_path = '' as $$ select 5 $$;
revoke all on function app.mfa_reset_pending_minutes() from public, anon, authenticated, service_role;

create function public.mfa_accounts() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_me uuid;
begin
  perform app.require_staff_manager();
  v_tenant := app.tenant_id();
  v_me := app.app_user_id();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'displayName', u.display_name, 'role', u.role,
                                        'factorCount', (select count(*) from auth.mfa_factors f where f.user_id = u.auth_id and f.status = 'verified' and f.factor_type = 'totp'))
                     order by u.display_name, u.id)
      from public.app_user u
     where u.tenant_id = v_tenant and u.is_active and u.role in ('owner', 'admin') and u.id <> v_me), '[]'::jsonb);
end
$$;

create function public.set_mfa_enforcement(p_tenant uuid, p_mode text, p_actor uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_current text;
  v_missing integer;
begin
  if p_mode is null or p_mode not in ('off', 'enrolled', 'required') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if not exists (select 1 from public.app_user u where u.id = p_actor and u.tenant_id = p_tenant and u.role = 'admin' and u.is_active) then
    raise exception 'actor_invalid' using errcode = 'P0001';
  end if;
  select t.mfa_enforcement into v_current from public.tenant t where t.id = p_tenant for update;
  if p_mode = 'required' then
    select count(*) into v_missing from public.app_user u
     where u.tenant_id = p_tenant and u.role = 'admin' and u.is_active and not app.mfa_has_verified_factor(u.auth_id);
    if v_missing > 0 then
      raise exception 'admins_not_enrolled' using errcode = 'P0001', detail = jsonb_build_object('count', v_missing)::text;
    end if;
  end if;
  if v_current = p_mode then
    return jsonb_build_object('changed', false, 'mode', p_mode);
  end if;
  update public.tenant set mfa_enforcement = p_mode where id = p_tenant;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (p_tenant, 'tenant', p_tenant, 'tenant.mfa_enforcement_changed', jsonb_build_object('mode', v_current), jsonb_build_object('mode', p_mode), p_actor);
  return jsonb_build_object('changed', true, 'mode', p_mode);
end
$$;

create function public.mfa_reset_service_begin(p_user uuid, p_actor uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  t record;
  v_revoked integer;
begin
  select u.tenant_id, u.role, u.is_active, u.auth_id into t from public.app_user u where u.id = p_user;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.app_user a where a.id = p_actor and a.tenant_id = t.tenant_id and a.role = 'admin' and a.is_active) then
    raise exception 'actor_invalid' using errcode = 'P0001';
  end if;
  if t.role not in ('owner', 'admin') or not t.is_active then
    raise exception 'mfa_reset_target_invalid' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mfa-reset:' || t.tenant_id::text, 0));
  -- Sign-out (T-8): deleting the target's Auth sessions deletes their refresh tokens (on delete cascade), so no session of theirs can refresh. Deleting the factors
  -- does not do this on Supabase. This is the only write to an auth table in public or app (pgTAP 341); the audit row counts the sessions, no ids.
  delete from auth.sessions where user_id = t.auth_id;
  get diagnostics v_revoked = row_count;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (t.tenant_id, 'app_user', p_user, 'app_user.mfa_reset', jsonb_build_object('sessions_revoked', v_revoked), p_actor);
  return jsonb_build_object('authId', t.auth_id);
end
$$;

create function public.mfa_reset_service_failed(p_user uuid, p_actor uuid) returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select u.tenant_id into v_tenant from public.app_user u where u.id = p_user;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.app_user a where a.id = p_actor and a.tenant_id = v_tenant and a.role = 'admin' and a.is_active) then
    raise exception 'actor_invalid' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mfa-reset:' || v_tenant::text, 0));
  if not exists (select 1 from public.audit_event e
                  where e.tenant_id = v_tenant and e.entity_id = p_user and e.action = 'app_user.mfa_reset' and e.created_by = p_actor
                    and e.created_at > clock_timestamp() - make_interval(mins => app.mfa_reset_pending_minutes())) then
    raise exception 'mfa_reset_not_pending' using errcode = 'P0001';
  end if;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
    values (v_tenant, 'app_user', p_user, 'app_user.mfa_reset_failed', p_actor);
end
$$;

revoke all on function public.mfa_accounts(), public.set_mfa_enforcement(uuid, text, uuid), public.mfa_reset_service_begin(uuid, uuid),
  public.mfa_reset_service_failed(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mfa_accounts() to authenticated;
grant execute on function public.set_mfa_enforcement(uuid, text, uuid), public.mfa_reset_service_begin(uuid, uuid), public.mfa_reset_service_failed(uuid, uuid) to service_role;
