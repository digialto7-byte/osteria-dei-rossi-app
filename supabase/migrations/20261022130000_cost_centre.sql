-- M4: cost centres for non-stock invoice lines (M4 plan §3.2; an addition to project plan §3.5.2).
-- A small tenant table instead of free text or an enum: free text splits "Pulizie" and "pulizia"
-- in later reports, an enum needs a migration per new centre. Same pattern as location:
-- tenant_id and created_by default from the caller; no delete, only deactivation; owner/admin only
-- (chef and waiter have no reason to see how costs are booked). No seeded list.

create table public.cost_centre (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  name text not null check (length(btrim(name)) between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default app.app_user_id() references public.app_user (id),
  constraint cost_centre_tenant_id_id_uq unique (tenant_id, id)
);
create unique index cost_centre_name_uq on public.cost_centre (tenant_id, app.normalise_name(name));

alter table public.cost_centre enable row level security;

revoke all on public.cost_centre from anon, authenticated;
revoke delete, truncate on public.cost_centre from service_role;
grant select, insert (name), update (name, is_active) on public.cost_centre to authenticated;

create policy cost_centre_select on public.cost_centre
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy cost_centre_insert on public.cost_centre
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy cost_centre_update on public.cost_centre
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'))
  with check (tenant_id = (select app.tenant_id()));
