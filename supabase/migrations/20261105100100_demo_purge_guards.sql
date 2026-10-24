-- Demo data step 2 (docs/plans/2026-10-24-demo-data.md §3.1.5; ADR-018): the append-only and staff-auth guards gain one
-- branch that allows a DELETE during the purge of a DEMO tenant, and nothing else.
--
-- app.demo_purge_allows(tenant) is true only when BOTH hold:
--   * the transaction-local setting app.demo_purge equals that tenant's id (not "on": a purge of tenant X can never delete
--     a row of tenant Y), and
--   * that tenant has is_demo = true (a flag no role can change, 20261105100000).
-- The setting is set only by app.purge_demo_tenant_core (next migrations), in its own transaction. Setting it from any
-- other place does nothing for a real tenant, and no API role has a DELETE grant in the first place.
--
-- What protects a real tenant: the setting alone does nothing (anyone can set it, but no API role has a DELETE grant, and the
-- guard also needs the tenant named by the setting to be a demo). The guards stay SECURITY INVOKER, and demo_purge_allows is
-- closed to every API role, so each guard looks at the setting first and calls demo_purge_allows only when it is set, in a
-- nested IF: PostgreSQL checks the EXECUTE privilege when an expression is set up, not when it is evaluated, so a single AND
-- would fail for service_role on every UPDATE (pgTAP 037). With no setting (every normal write) nothing changes.
--
-- Unchanged: UPDATE is still refused by the same logic as before; the TRUNCATE triggers are not touched;
-- app.auth_purge keeps its exact meaning (M11 retention); no grant changes. The rest of each body is verbatim.

create function app.demo_purge_allows(p_tenant uuid) returns boolean
  language plpgsql stable security definer
  set search_path = ''
as $$
begin
  -- The cheap tests first: a real tenant's path (no setting, or another tenant's id) never reaches the lookup.
  if p_tenant is null or coalesce(current_setting('app.demo_purge', true), '') <> p_tenant::text then
    return false;
  end if;
  return exists (select 1 from public.tenant t where t.id = p_tenant and t.is_demo);
end
$$;
revoke all on function app.demo_purge_allows(uuid) from public, anon, authenticated, service_role;

create or replace function app.append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.demo_purge', true), '') <> '' then
      if app.demo_purge_allows(nullif(to_jsonb(old) ->> 'tenant_id', '')::uuid) then
        return old;
      end if;
    end if;
  end if;
  raise exception 'append_only' using errcode = 'P0001';
end
$$;

create or replace function app.auth_attempt_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.demo_purge', true), '') <> '' then
      if app.demo_purge_allows(old.tenant_id) then
        return old;
      end if;
    end if;
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

create or replace function app.staff_session_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.demo_purge', true), '') <> '' then
      if app.demo_purge_allows(old.tenant_id) then
        return old;
      end if;
    end if;
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

create or replace function app.device_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.demo_purge', true), '') <> '' then
      if app.demo_purge_allows(old.tenant_id) then
        return old;
      end if;
    end if;
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

create or replace function app.enrolment_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.demo_purge', true), '') <> '' then
      if app.demo_purge_allows(old.tenant_id) then
        return old;
      end if;
    end if;
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
