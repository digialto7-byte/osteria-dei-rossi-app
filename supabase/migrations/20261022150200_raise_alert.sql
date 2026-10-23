-- M6 step 4: app.raise_alert, the one entry point every alert rule uses (M6 plan §3.1, §3.2, §3.5).
--
-- Lives in schema `app` and takes the tenant as a parameter: rules run from pg_cron with no JWT, so
-- the tenant cannot come from the token. Safety comes from privileges: no API role can execute it.
-- Only definer procedures owned by the migration owner call it (M8's approve_invoice passes
-- app.tenant_id(); the hourly rules pass the tenant they loop over), inside their own transaction.
--
-- Returns (alert_id, inserted). The same alert (tenant, kind, entity, business date) is stored once;
-- a repeat returns the first one's id with inserted = false.
create function app.raise_alert(
  p_tenant uuid,
  p_kind text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb default '{}',
  p_severity public.alert_severity default null,
  p_audience public.app_role[] default null,
  p_at timestamptz default now(),
  p_business_date date default null
) returns table (alert_id uuid, inserted boolean)
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_kind app.alert_kind;
  v_audience public.app_role[];
  v_date date;
  v_id uuid;
begin
  -- 1. The kind and the tenant must exist.
  select * into v_kind from app.alert_kind k where k.kind = p_kind;
  if not found then
    raise exception 'unknown_alert_kind' using errcode = 'P0001';
  end if;
  perform 1 from public.tenant t where t.id = p_tenant;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;

  -- 2. Audience: what was asked (or the kind's default) plus the owner, who always receives it;
  -- de-duplicated in a fixed order. Only owner and chef are recipients: waiter, admin and a null
  -- role are refused.
  v_audience := coalesce(p_audience, v_kind.default_audience) || '{owner}'::public.app_role[];
  if exists (
    select 1 from unnest(v_audience) r
     where r is null or r not in ('owner', 'chef')
  ) then
    raise exception 'alert_audience_invalid' using errcode = 'P0001';
  end if;
  select array_agg(r order by case r when 'owner' then 1 else 2 end)
    into v_audience
    from (select distinct r from unnest(v_audience) r) d;

  -- 3. Cost guards: a cost-bearing alert never reaches the chef; a non-cost payload carries no
  -- money-like key at any depth; the payload is an object of at most 8 KB.
  if v_kind.cost_bearing and 'chef'::public.app_role = any (v_audience) then
    raise exception 'alert_audience_cost' using errcode = 'P0001';
  end if;
  if not v_kind.cost_bearing and app.payload_money_keys(p_payload) <> '{}'::text[] then
    raise exception 'alert_payload_cost_key' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_typeof(p_payload), '') <> 'object' or octet_length(p_payload::text) > 8192 then
    raise exception 'alert_payload_invalid' using errcode = 'P0001';
  end if;

  -- 4. The venue calendar date, unless the caller fixes it (M9's weekly digest uses the Monday).
  v_date := coalesce(p_business_date, app.alert_business_date(p_tenant, p_at));

  -- 5. Insert; a repeat of the dedup key does nothing (no conflict target: the unique index
  -- alert_dedup_uq and the primary key are the only ones). created_by is the signed-in user, only
  -- when the alert is for their own tenant (a caller's bug cannot name a foreign user).
  insert into public.alert (tenant_id, kind, entity_type, entity_id, business_date, severity,
      audience_roles, cost_bearing, payload, created_by)
    values (p_tenant, p_kind, p_entity_type, p_entity_id, v_date,
            coalesce(p_severity, v_kind.default_severity), v_audience, v_kind.cost_bearing, p_payload,
            case when (select app.tenant_id()) = p_tenant then (select app.app_user_id()) end)
    on conflict do nothing
    returning id into v_id;
  if v_id is not null then
    alert_id := v_id;
    inserted := true;
    return next;
    return;
  end if;

  -- 6. Not inserted: the alert that is already there. If its inserting transaction was still open,
  -- ON CONFLICT waited for it, so the row is visible to this new statement.
  select a.id into v_id
    from public.alert a
   where a.tenant_id = p_tenant and a.kind = p_kind and a.entity_type = p_entity_type
     and a.entity_id is not distinct from p_entity_id and a.business_date = v_date;
  alert_id := v_id;
  inserted := false;
  return next;
end
$$;

revoke all on function app.raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity,
  public.app_role[], timestamptz, date) from public, anon, authenticated, service_role;

-- The registered kinds and their cost flag, for the integration parity check against the TypeScript
-- registry (src/server/alerts/kinds.ts). service_role only.
create function public.alert_kind_list() returns table (kind text, cost_bearing boolean)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select k.kind, k.cost_bearing from app.alert_kind k order by k.kind
$$;
revoke all on function public.alert_kind_list() from public, anon, authenticated, service_role;
grant execute on function public.alert_kind_list() to service_role;
