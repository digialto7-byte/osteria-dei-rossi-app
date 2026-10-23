-- M6 code-review round 1 follow-up.
-- 20261022150400 and 20261022150500 are already pushed, so nothing is edited there; this migration
-- replaces functions with `create or replace` (same signatures) and adds one helper.
--
-- 1. app.run_alert_rules: `exception when others` recorded only rule_failed, so the SQLSTATE was lost.
--    It now also raises a warning with the SQLSTATE before recording the run. SQLSTATE only: the message,
--    detail and context of the error may carry payload text, so they are never read. The warning goes
--    to the database log; the job_run record is unchanged (rule_failed, items 0) and the function still
--    returns normally, so the record survives.

create or replace function app.run_alert_rules(p_at timestamptz default now()) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_run bigint := app.job_run_begin('alert-rules');
  v_items integer;
  v_failed boolean := false;
begin
  begin
    v_items := app.alert_rules_body(p_at);
  exception when others then
    v_failed := true;
    raise warning 'alert rule failed: %', sqlstate;
  end;
  perform app.job_run_end(v_run, not v_failed, case when v_failed then 'rule_failed' end,
    case when v_failed then 0 else coalesce(v_items, 0) end);
end
$$;

-- 2. Money-guard hardening, before kinds with a chef audience arrive (M12, M16, M19).
--
--    a. app.payload_money_keys also matches total, totale, valore, imponibile, iva and vat. The first four
--       match anywhere in a key (case-insensitive), like cost and price. iva and vat match as words only
--       (the key is the word, or the word is delimited by a non-letter or a camelCase capital), because
--       "attiva", "relativa" or "elevation" are not money. Same output order as 20261022150500 (C collation).
--       tests/server/alerts/templates.test.ts mirrors this rule: keep the two in agreement.
--    b. app.payload_has_money_value: true when any string value, at any depth, contains the euro sign or the
--       word EUR/euro (case-insensitive, as a word: "10 EUR", "10eur", "50 euro"; not "Euroricambi").
--       Numbers are not strings and keys are not looked at (a. covers keys).
--    c. app.raise_alert refuses a NON-cost kind whose payload has such a value, with the new P0001 code
--       alert_payload_cost_value (distinct from alert_payload_cost_key, so a log tells key from value).
--       Cost-bearing kinds are unchanged: their audience never includes the chef, and they keep money.
--       The check runs after the "payload is an object of at most 8 KB" check, so a scalar payload is
--       reported as alert_payload_invalid.

create or replace function app.payload_money_keys(p_payload jsonb) returns text[]
  language sql immutable
  set search_path = ''
as $$
  with recursive walk (node) as (
    select p_payload
    union all
    select c.child
      from walk w
      cross join lateral (
        select e.value as child
          from jsonb_each(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) e
        union all
        select a.value
          from jsonb_array_elements(case when jsonb_typeof(w.node) = 'array' then w.node else '[]'::jsonb end) a
      ) c
  ),
  keys as (
    select distinct k.key
      from walk w
      cross join lateral jsonb_object_keys(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) k (key)
     where k.key ~* '(_eur$|cost|price|prezz|margin|amount|importo|total|valore|imponibile)'
        or k.key ~ '(^|[^A-Za-z])([Ii][Vv][Aa]|[Vv][Aa][Tt])([^a-z]|$)'
        or k.key ~ '[a-z](Iva|IVA|Vat|VAT)([^a-z]|$)'
  )
  select coalesce(array_agg(key order by key collate "C"), '{}'::text[]) from keys
$$;

create function app.payload_has_money_value(p_payload jsonb) returns boolean
  language sql immutable
  set search_path = ''
as $$
  select jsonb_path_exists(p_payload,
    'strict $.** ? (@.type() == "string" && @ like_regex "€|(^|[^a-z])eur(os?)?([^a-z]|$)" flag "i")')
$$;
revoke all on function app.payload_has_money_value(jsonb) from public, anon, authenticated, service_role;

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
