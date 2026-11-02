-- M25c step 1 (docs/plans/2026-11-01-m25c-services.md §3.2; ADR-031): the storage of the service periods (Pranzo / Cena).
--
--   public.service_schedule   one row per saved version of a tenant's periods: 1 to 6 entries {key, name, startsAt}. A version applies to the
--                            sessions opened at or after its created_at. Append-only for every role (updates, deletes and truncates are refused;
--                            the demo reset may delete, as for every ledger). Owner and admin read it through RLS; nobody holds a write grant.
--   public.service_override  one row per move of a table to another service (service_key null = back to automatic). Append-only like the schedule.
--   app.service_max_periods, app.default_service_periods, app.service_periods_ok   the limit, the built-in default and the validator.
-- Nothing is written to existing tables: a table's service is derived at read time (ADR-031 decision 3), so there is no backfill.
-- app.default_service_periods() is pinned by pgTAP 286: changing it would re-assign the history of every tenant that never saved a schedule.

create function app.service_max_periods() returns integer
  language sql
  immutable
  security definer
  set search_path = ''
as $$ select 6 $$;

create function app.default_service_periods() returns jsonb
  language sql
  immutable
  security definer
  set search_path = ''
as $$
  select '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"16:00"}]'::jsonb
$$;

-- True when p is an array of 1..6 objects with exactly the keys key, name and startsAt; keys, names (case-insensitive) and starts are unique.
-- key: ^[a-z][a-z0-9_]{1,31}$ · name: trimmed, 1 to 30 characters · startsAt: HH:MM, 00:00 to 23:59.
create function app.service_periods_ok(p jsonb) returns boolean
  language plpgsql
  immutable
  security definer
  set search_path = ''
as $$
declare
  n integer;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    return false;
  end if;
  n := jsonb_array_length(p);
  if n < 1 or n > app.service_max_periods() then
    return false;
  end if;
  if exists (select 1 from jsonb_array_elements(p) x where jsonb_typeof(x) <> 'object') then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p) x
     where (select array_agg(k order by k collate "C") from jsonb_object_keys(x) k) is distinct from array['key', 'name', 'startsAt']
        or jsonb_typeof(x -> 'key') <> 'string' or jsonb_typeof(x -> 'name') <> 'string' or jsonb_typeof(x -> 'startsAt') <> 'string'
        or (x ->> 'key') !~ '^[a-z][a-z0-9_]{1,31}$'
        or (x ->> 'name') <> regexp_replace(x ->> 'name', '^\s+|\s+$', '', 'g')
        or char_length(x ->> 'name') not between 1 and 30
        or (x ->> 'startsAt') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ) then
    return false;
  end if;
  return (select count(distinct x ->> 'key') = n and count(distinct lower(x ->> 'name')) = n and count(distinct x ->> 'startsAt') = n
            from jsonb_array_elements(p) x);
end
$$;

revoke all on function app.service_max_periods(), app.default_service_periods(), app.service_periods_ok(jsonb)
  from public, anon, authenticated, service_role;

create table public.service_schedule (
  tenant_id uuid not null references public.tenant (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  periods jsonb not null check (app.service_periods_ok(periods)),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  primary key (tenant_id, id),
  constraint service_schedule_user_fkey foreign key (tenant_id, created_by) references public.app_user (tenant_id, id)
);
create index service_schedule_at_idx on public.service_schedule (tenant_id, created_at desc, seq desc);

create table public.service_override (
  tenant_id uuid not null references public.tenant (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  table_session_id uuid not null,
  -- null = back to automatic
  service_key text check (service_key ~ '^[a-z][a-z0-9_]{1,31}$'),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  primary key (tenant_id, id),
  constraint service_override_session_fkey foreign key (tenant_id, table_session_id) references public.table_session (tenant_id, id),
  constraint service_override_user_fkey foreign key (tenant_id, created_by) references public.app_user (tenant_id, id)
);
create index service_override_session_idx on public.service_override (tenant_id, table_session_id, created_at desc, seq desc);

create trigger service_schedule_append_only before update or delete on public.service_schedule
  for each row execute function app.append_only();
create trigger service_schedule_no_truncate before truncate on public.service_schedule
  for each statement execute function app.append_only_truncate();
create trigger service_override_append_only before update or delete on public.service_override
  for each row execute function app.append_only();
create trigger service_override_no_truncate before truncate on public.service_override
  for each statement execute function app.append_only_truncate();

alter table public.service_schedule enable row level security;
alter table public.service_override enable row level security;
revoke all on public.service_schedule, public.service_override from anon, authenticated, service_role;
grant select on public.service_schedule, public.service_override to authenticated, service_role;
create policy service_schedule_select on public.service_schedule for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy service_override_select on public.service_override for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
