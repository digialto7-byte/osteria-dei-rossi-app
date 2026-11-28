-- SP3 step 11 (docs/plans/2026-11-15-sp3-console.md §3.3.3, §3.4.2; AT3, AT4, AT5): the console's metadata reads. Executable by platform_staff only, and each calls
-- app.require_console() first, so only the active platform admin in console mode, with a verified factor, at aal2, gets an answer. They return exactly the keys of the
-- shapes in src/lib/platform/api.ts (TenantSummary, TenantDetail, AuditRow) and nothing else: no invoice, price, cost, recipe, order, reservation, person name, address,
-- VAT number or legal name (AT5). Organisation data is read-only: nothing here writes it.
--  * platform.tenant_json(tenant)  the TenantSummary of one tenant. members counts active rows by role, without the platform admin's own admin row (so "4 persone" never
--                                  counts DigiAlto; a second, legacy admin row still counts); digialtoAttached says whether that own admin row is active;
--                                  lastActivityDate is the day, in the tenant's time zone, of its newest public.audit_event row.
--  * platform.audit_row_json(id)   the AuditRow of one platform audit row; tenantName is null for a platform-wide row and for a tenant that no longer exists.
--  * public.platform_tenants()      TenantSummary[], newest activity first (no activity last), then by name.
--  * public.platform_tenant(id)     {tenant: TenantDetail, activity: the tenant's last 10 platform audit rows, newest first}; an unknown id is P0002 tenant_not_found.
--  * public.platform_audit(...)     {rows, nextBefore}: 50 rows a page, newest first, between two Europe/Rome days (both required, in order, at most 366 days apart,
--                                  else 22023), optionally for one tenant and one action (an unknown action is 22023), before an id (the cursor).
--  * public.platform_open_tenant(id) {tenantId, attached}; writes console.tenant_opened only when the platform admin is attached (an admin row is active), since only
--                                  then does the console open the venue (409 digialto_not_attached otherwise, step 17).
-- The two helpers live in platform, closed to every role, and run only inside the definer functions.

create function platform.tenant_json(p_tenant uuid) returns jsonb
  language sql
  stable
  set search_path = ''
as $$
  with me as (
    select s.auth_id from platform.staff s where s.role = 'platform_admin' and s.is_active
  )
  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'organisation', jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'tenantCount', (select count(*)::int from public.tenant x where x.organisation_id = o.id)),
    'createdAt', to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'members', (
      select jsonb_build_object(
        'owner', count(*) filter (where m.role = 'owner')::int,
        'admin', count(*) filter (where m.role = 'admin')::int,
        'chef', count(*) filter (where m.role = 'chef')::int,
        'waiter', count(*) filter (where m.role = 'waiter')::int)
        from public.app_user m
       where m.tenant_id = t.id and m.is_active
         and not (m.role = 'admin' and m.auth_id is not distinct from (select me.auth_id from me))),
    'digialtoAttached', exists (
      select 1 from public.app_user m
       where m.tenant_id = t.id and m.is_active and m.role = 'admin' and m.auth_id = (select me.auth_id from me)),
    'lastActivityDate', (
      select to_char((max(a.created_at) at time zone t.timezone)::date, 'YYYY-MM-DD') from public.audit_event a where a.tenant_id = t.id))
    from public.tenant t
    join platform.organisation o on o.id = t.organisation_id
   where t.id = p_tenant
$$;

create function platform.audit_row_json(p_id bigint) returns jsonb
  language sql
  stable
  set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id,
    'at', to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'tenantId', a.tenant_id,
    'tenantName', t.name,
    'action', a.action,
    'origin', a.origin,
    'detail', a.detail)
    from platform.audit_event a
    left join public.tenant t on t.id = a.tenant_id
   where a.id = p_id
$$;
revoke all on function platform.tenant_json(uuid), platform.audit_row_json(bigint) from public, anon, authenticated, service_role;

create function public.platform_tenants() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_console();
  return coalesce((
    select jsonb_agg(j order by j ->> 'lastActivityDate' desc nulls last, j ->> 'name', j ->> 'id')
      from (select platform.tenant_json(t.id) as j from public.tenant t) x), '[]'::jsonb);
end
$$;

create function public.platform_tenant(p_tenant uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant jsonb;
begin
  perform app.require_console();
  v_tenant := platform.tenant_json(p_tenant);
  if v_tenant is null then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'tenant', v_tenant || jsonb_build_object(
      'timeZone', (select t.timezone from public.tenant t where t.id = p_tenant),
      'bookingSlug', (select r.public_slug from public.reservation_settings r where r.tenant_id = p_tenant)),
    'activity', coalesce((
      select jsonb_agg(platform.audit_row_json(a.id) order by a.id desc)
        from (select e.id from platform.audit_event e where e.tenant_id = p_tenant order by e.id desc limit 10) a), '[]'::jsonb));
end
$$;

create function public.platform_audit(p_from date, p_to date, p_tenant uuid, p_action text, p_before bigint) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_ids bigint[];
begin
  perform app.require_console();
  if p_from is null or p_to is null then
    raise exception 'audit_range_required' using errcode = '22023';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'audit_range_invalid' using errcode = '22023';
  end if;
  if p_action is not null and not (p_action = any (platform.audit_actions())) then
    raise exception 'audit_action_unknown' using errcode = '22023';
  end if;
  select coalesce(array_agg(e.id order by e.id desc), '{}') into v_ids
    from (select a.id from platform.audit_event a
           where a.at >= (p_from::timestamp at time zone 'Europe/Rome')
             and a.at < ((p_to + 1)::timestamp at time zone 'Europe/Rome')
             and (p_tenant is null or a.tenant_id = p_tenant)
             and (p_action is null or a.action = p_action)
             and (p_before is null or a.id < p_before)
           order by a.id desc
           limit 51) e;
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(platform.audit_row_json(i) order by i desc) from unnest(v_ids[1:50]) i), '[]'::jsonb),
    'nextBefore', case when cardinality(v_ids) > 50 then to_jsonb(v_ids[50]) else 'null'::jsonb end);
end
$$;

create function public.platform_open_tenant(p_tenant uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant jsonb;
  v_attached boolean;
begin
  perform app.require_console();
  v_tenant := platform.tenant_json(p_tenant);
  if v_tenant is null then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  v_attached := (v_tenant ->> 'digialtoAttached')::boolean;
  if v_attached then
    perform platform.audit_write('console', 'console.tenant_opened', p_tenant, jsonb_build_object('tenantId', p_tenant));
  end if;
  return jsonb_build_object('tenantId', p_tenant, 'attached', v_attached);
end
$$;

revoke all on function public.platform_tenants(), public.platform_tenant(uuid), public.platform_audit(date, date, uuid, text, bigint), public.platform_open_tenant(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.platform_tenants(), public.platform_tenant(uuid), public.platform_audit(date, date, uuid, text, bigint), public.platform_open_tenant(uuid)
  to platform_staff;
