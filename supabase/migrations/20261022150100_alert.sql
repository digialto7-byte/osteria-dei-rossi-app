-- M6 step 3: the alert table, the kind registry and the helpers around them (M6 plan §3.1, §3.2;
-- ADR-006; project plan §3.5.1).
--
-- An alert is append-only except for one set-once step: acknowledged_at / acknowledged_by go from
-- null to a value, once. The database holds structured data only (kind + payload); messages are
-- rendered per kind and per locale in TypeScript. Costs stay away from the chef in three layers:
-- the registry flag and its check constraints, the payload key guard (raise_alert, step 4) and RLS.

create type public.alert_severity as enum ('info', 'warning', 'critical');

-- Registry of alert kinds. Reference data without a tenant, outside `public`, no API role has any
-- privilege on it (like app.job_run). A new kind is an insert here in the milestone that raises it.
create table app.alert_kind (
  kind text primary key check (kind ~ '^[a-z][a-z0-9_]{2,40}$'),
  cost_bearing boolean not null,
  default_severity public.alert_severity not null,
  default_audience public.app_role[] not null,
  constraint alert_kind_audience_ck
    check (default_audience <@ '{owner,admin,chef}'::public.app_role[]),
  constraint alert_kind_cost_audience_ck
    check (not (cost_bearing and 'chef'::public.app_role = any (default_audience)))
);
alter table app.alert_kind enable row level security;
revoke all on app.alert_kind from public, anon, authenticated, service_role;

insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience) values
  ('test_alert', false, 'info', '{owner,admin}'),
  ('test_alert_kitchen', false, 'info', '{owner,admin,chef}');

-- The calendar date at the tenant's venue (Europe/Rome by default) for a moment in time. Daylight
-- saving comes from the time zone database (app.venue_date); there is no trading-day cut-off.
create function app.alert_business_date(p_tenant uuid, p_at timestamptz) returns date
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tz text;
begin
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  return app.venue_date(p_at, v_tz);
end
$$;

-- Every key, at any depth (objects and arrays), that looks like money. Payload convention: a money
-- value sits under a key ending in _eur; the other words catch a key that forgot it.
create function app.payload_money_keys(p_payload jsonb) returns text[]
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
    select k.key
      from walk w
      cross join lateral jsonb_object_keys(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) k (key)
  )
  select coalesce(array_agg(distinct key order by key), '{}'::text[])
    from keys
   where key ~* '(_eur$|cost|price|prezz|margin|amount|importo)'
$$;

revoke all on function app.alert_business_date(uuid, timestamptz), app.payload_money_keys(jsonb)
  from public, anon, authenticated, service_role;

-- An acknowledgement may only name a user of the same tenant (composite foreign key below).
alter table public.app_user add constraint app_user_tenant_id_id_uq unique (tenant_id, id);

create table public.alert (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  kind text not null references app.alert_kind (kind),
  -- What the alert is about. No foreign key: alerts outlive and point at many tables. A tenant-level
  -- alert uses entity_type 'tenant' and the tenant id.
  entity_type text not null check (entity_type ~ '^[a-z][a-z_]{1,40}$'),
  entity_id uuid,
  -- The venue calendar date it counts for: one alert per kind and entity per business date.
  business_date date not null,
  severity public.alert_severity not null,
  audience_roles public.app_role[] not null,
  -- Copied from the registry when the alert is raised.
  cost_bearing boolean not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  -- Null when a scheduled job raised it.
  created_by uuid references public.app_user (id),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  constraint alert_acknowledger_fk foreign key (tenant_id, acknowledged_by)
    references public.app_user (tenant_id, id),
  constraint alert_audience_ck
    check (audience_roles @> '{owner,admin}'::public.app_role[]
           and audience_roles <@ '{owner,admin,chef}'::public.app_role[]),
  constraint alert_cost_audience_ck
    check (not (cost_bearing and 'chef'::public.app_role = any (audience_roles))),
  constraint alert_payload_ck
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8192),
  constraint alert_ack_ck check ((acknowledged_at is null) = (acknowledged_by is null))
);

-- Dedup: the same alert on the same business date is stored once. raise_alert inserts with
-- ON CONFLICT DO NOTHING (no conflict target). NULLS NOT DISTINCT is a backstop for a null entity.
create unique index alert_dedup_uq
  on public.alert (tenant_id, kind, entity_type, entity_id, business_date) nulls not distinct;
create index alert_tenant_created_idx on public.alert (tenant_id, created_at desc, id desc);
create index alert_tenant_open_idx on public.alert (tenant_id, created_at desc)
  where acknowledged_at is null;

-- Nothing about an alert changes after insert except a set-once acknowledgement. Fires for every
-- role, the migration owner included.
create function app.alert_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'acknowledged_at' - 'acknowledged_by')
       is distinct from (to_jsonb(old) - 'acknowledged_at' - 'acknowledged_by')
     or (old.acknowledged_at is not null
         and (new.acknowledged_at is distinct from old.acknowledged_at
              or new.acknowledged_by is distinct from old.acknowledged_by))
  then
    raise exception 'alert_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.alert_guard() from public, anon;

create trigger alert_guard
  before update on public.alert
  for each row execute function app.alert_guard();
create trigger alert_no_delete
  before delete on public.alert
  for each row execute function app.append_only();
create trigger alert_no_truncate
  before truncate on public.alert
  for each statement execute function app.append_only_truncate();

alter table public.alert enable row level security;

-- Written only by app.raise_alert and public.acknowledge_alert (definer procedures).
revoke all on public.alert from anon, authenticated, service_role;
grant select on public.alert to authenticated;

-- Owner and admin read every alert of the tenant. The chef reads only the alerts meant for the
-- kitchen, and never a cost-bearing one (the founder's decision: the chef sees no € figures).
-- Waiters have no policy.
create policy alert_select on public.alert
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and (
      (select app.role()) in ('owner', 'admin')
      or ((select app.role()) = 'chef'
          and 'chef'::public.app_role = any (audience_roles)
          and not cost_bearing)
    )
  );
