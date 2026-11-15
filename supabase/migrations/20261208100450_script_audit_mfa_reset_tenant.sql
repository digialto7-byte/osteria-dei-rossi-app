-- SP3 step 5 follow-up (lead, 2026-11-15): the script.mfa_reset audit row carries its tenant, resolved server-side inside the same write. public.mfa_reset_service_begin answers the
-- auth id only (pgTAP 343 pins that answer, so it stays), which left the row without a tenant. public.platform_record_script_run (same signature, owner and grants, create or
-- replace) now resolves the tenant of a script.mfa_reset row from detail.appUserId (app_user -> tenant_id):
--  * no appUserId in the detail: 22023 app_user_required; an appUserId that is not a uuid or names no app_user: P0002 app_user_not_found; nothing is written in either case;
--  * a tenant passed by the caller that disagrees with the app_user's own: 22023 tenant_mismatch, nothing written (the script never passes one, and cannot choose it);
--  * every other action is unchanged.
-- sessionsRevoked is NOT recorded: the revoking step is mfa_reset_service_begin, whose answer is pinned unchanged by 343 (lead's branch for a pinned answer).

create or replace function public.platform_record_script_run(p_action text, p_tenant uuid, p_detail jsonb) returns bigint
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_user text;
  v_tenant uuid := p_tenant;
  v_found uuid;
begin
  if p_action is null or left(p_action, 7) <> 'script.' then
    raise exception 'invalid_script_action' using errcode = '22023';
  end if;
  if p_action = 'script.mfa_reset' then
    v_user := p_detail ->> 'appUserId';
    if v_user is null then
      raise exception 'app_user_required' using errcode = '22023';
    end if;
    if v_user !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'app_user_not_found' using errcode = 'P0002';
    end if;
    select u.tenant_id into v_found from public.app_user u where u.id = v_user::uuid;
    if not found then
      raise exception 'app_user_not_found' using errcode = 'P0002';
    end if;
    if p_tenant is not null and p_tenant is distinct from v_found then
      raise exception 'tenant_mismatch' using errcode = '22023';
    end if;
    v_tenant := v_found;
  end if;
  return platform.audit_write('script', p_action, v_tenant, p_detail);
end
$$;
