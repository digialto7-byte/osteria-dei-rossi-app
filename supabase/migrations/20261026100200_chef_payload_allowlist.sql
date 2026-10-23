-- M12 step 2: the chef-payload allow-list (M12 plan §3.1.8, §3.2; ADR-011; M7 plan §8 (a)).
--
-- Founder decision Q16 = V6: the chef never sees a euro figure. The M6 money guards only look for
-- money-like keys and euro values. A chef-audience alert (the first with data is M12's negative_stock;
-- M16 and M19 follow) must hold ids, quantities, dates, units and codes only, never text that could hide a
-- figure or a name. app.chef_payload_allowed is that rule; app.raise_alert applies it as its LAST guard,
-- when the final audience includes the chef, so every older guard keeps its position and its error code
-- (pgTAP 044, 045, 046 run unchanged). Owner-only payloads are neither loosened nor tightened.
--
-- The rule: every key at any depth ends in _id, _key, _qty, _count, _hours, _days, _date or _at (after a
-- lower-case snake_case stem) or is exactly `unit`; every string value, at any depth, is a token: a uuid,
-- YYYY-MM-DD, an ISO instant, or a code [a-z0-9_]{1,40} (units kg, l, pz, g, ml are codes).
-- src/server/alerts/chef-payload.ts mirrors this rule; both are tested with the same vector table.

create function app.chef_payload_allowed(p_payload jsonb) returns boolean
  language sql immutable
  set search_path = ''
as $$
  with recursive walk (node) as (
    select p_payload
    union all
    select c.value
      from walk w
     cross join lateral (
        select o.value
          from jsonb_each(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) o
        union all
        select a.value
          from jsonb_array_elements(case when jsonb_typeof(w.node) = 'array' then w.node else '[]'::jsonb end) a
     ) c
  ),
  bad_keys as (
    select 1
      from walk w
     cross join lateral jsonb_object_keys(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) k (key)
     where not (k.key ~ '^[a-z][a-z0-9_]{0,40}(_id|_key|_qty|_count|_hours|_days|_date|_at)$' or k.key = 'unit')
  ),
  bad_values as (
    select 1
      from walk w
     where jsonb_typeof(w.node) = 'string'
       and not (
         (w.node #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or (w.node #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or (w.node #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
         or (w.node #>> '{}') ~ '^[a-z0-9_]{1,40}$')
  )
  select p_payload is not null
     and not exists (select 1 from bad_keys)
     and not exists (select 1 from bad_values)
$$;
revoke all on function app.chef_payload_allowed(jsonb) from public, anon, authenticated, service_role;

-- The seven P0001 messages of app.raise_alert that mean "this alert is refused". try_raise_alert (not
-- replaced; its md5 is pinned in pgTAP 076) reads this list, so it absorbs the new code like the six old ones.
create or replace function app.alert_guard_codes() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array['unknown_alert_kind', 'alert_audience_invalid', 'alert_audience_cost',
               'alert_payload_cost_key', 'alert_payload_invalid', 'alert_payload_cost_value',
               'alert_payload_not_allowed']
$$;

-- app.raise_alert: the definition of 20261022150600 (the last migration that replaced it), verbatim,
-- plus ONE new guard after every existing one. create or replace keeps the ACLs of M6 (no API role).
create or replace function app.raise_alert(
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
  -- money-like key at any depth and no string value with a euro sign or EUR; the payload is an object
  -- of at most 8 KB.
  if v_kind.cost_bearing and 'chef'::public.app_role = any (v_audience) then
    raise exception 'alert_audience_cost' using errcode = 'P0001';
  end if;
  if not v_kind.cost_bearing and app.payload_money_keys(p_payload) <> '{}'::text[] then
    raise exception 'alert_payload_cost_key' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_typeof(p_payload), '') <> 'object' or octet_length(p_payload::text) > 8192 then
    raise exception 'alert_payload_invalid' using errcode = 'P0001';
  end if;
  if not v_kind.cost_bearing and app.payload_has_money_value(p_payload) then
    raise exception 'alert_payload_cost_value' using errcode = 'P0001';
  end if;
  -- 3e. M12: a chef-audience payload holds ids, quantities, dates, units and codes only. Last guard.
  if 'chef'::public.app_role = any (v_audience) and not app.chef_payload_allowed(p_payload) then
    raise exception 'alert_payload_not_allowed' using errcode = 'P0001';
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
