-- M23 step 1 (docs/plans/2026-10-31-m23-push-forecast.md §3.1, §3.2; ADR-026): the push history.
--
--   public.menu_push            an append-only log, one row per start or stop of a push, written only by public.push_menu_item (a definer, a later
--                               migration) in the same transaction as the menu_item.push_until / push_price columns it mirrors. A start carries its
--                               push_until, an optional temporary price and a snapshot of the batch recipe keys the plate used at that moment; a
--                               stop carries nothing. Updates, deletes and truncates are refused (the demo reset may delete, as for every ledger).
--                               Owner and admin read it through RLS; nobody holds a write grant. The temporary price never enters menu_item_price.
--   app.menu_push_periods       the start rows with their effective end, computed at read time: the earlier of push_until and the next row of the
--                               same item (lead). Never stored. Overlap rule: started_at < p_to and effective_end > p_from.
--   app.push_default_until      "push today" ends at the end of the current business day (Q157): the DST-safe cut-off end of M22.

create table public.menu_push (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  menu_item_id uuid not null,
  action text not null check (action in ('start', 'stop')),
  push_until timestamptz,
  push_price numeric(12, 2) check (push_price > 0 and push_price <= 10000),
  batch_keys uuid[] not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  constraint menu_push_item_fkey foreign key (tenant_id, menu_item_id) references public.menu_item (tenant_id, id),
  constraint menu_push_user_fkey foreign key (tenant_id, created_by) references public.app_user (tenant_id, id),
  constraint menu_push_shape_ck check (
    (action = 'start' and push_until is not null)
    or (action = 'stop' and push_until is null and push_price is null and batch_keys = '{}')
  )
);

create index menu_push_item_idx on public.menu_push (tenant_id, menu_item_id, created_at, id);
create index menu_push_time_idx on public.menu_push (tenant_id, created_at);

create trigger menu_push_append_only before update or delete on public.menu_push
  for each row execute function app.append_only();
create trigger menu_push_no_truncate before truncate on public.menu_push
  for each statement execute function app.append_only_truncate();

alter table public.menu_push enable row level security;
revoke all on public.menu_push from anon, authenticated, service_role;
grant select on public.menu_push to authenticated, service_role;
create policy menu_push_select on public.menu_push for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

-- The lead() runs over every row of the item (starts and stops) before the start rows are picked, so a stop ends the start before it.
create function app.menu_push_periods(p_tenant uuid, p_from timestamptz, p_to timestamptz)
  returns table (menu_item_id uuid, started_at timestamptz, effective_end timestamptz, push_price numeric, batch_keys uuid[])
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select r.menu_item_id, r.created_at, r.effective_end, r.push_price, r.batch_keys
    from (
      select m.menu_item_id, m.action, m.created_at, m.push_price, m.batch_keys,
             least(m.push_until, lead(m.created_at) over (partition by m.menu_item_id order by m.created_at, m.id)) as effective_end
        from public.menu_push m
       where m.tenant_id = p_tenant
    ) r
   where r.action = 'start'
     and r.created_at < p_to
     and r.effective_end > p_from
   order by r.menu_item_id, r.created_at
$$;

create function app.push_default_until(p_tenant uuid, p_at timestamptz) returns timestamptz
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select app.kpi_cutoff_end(p_tenant, app.business_date(p_tenant, p_at))
$$;

revoke all on function app.menu_push_periods(uuid, timestamptz, timestamptz), app.push_default_until(uuid, timestamptz)
  from public, anon, authenticated, service_role;
