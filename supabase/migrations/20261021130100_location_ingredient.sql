-- M1: storage locations and ingredients (plan §3.5.1). Pattern for every master-data table:
-- tenant_id and created_by default from the caller's active membership and cannot be set by
-- the caller (column grants); unique (tenant_id, id) is the target of composite foreign keys,
-- so a row can never reference another tenant's row (FK checks ignore RLS); no delete, only
-- deactivation through is_active (plan §3.6 rule 5).

create table public.location (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  name text not null check (length(btrim(name)) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default app.app_user_id() references public.app_user (id),
  constraint location_tenant_id_id_uq unique (tenant_id, id)
);
create unique index location_name_uq on public.location (tenant_id, app.normalise_name(name));

create table public.ingredient (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  -- Not updatable (column grants): changing it would corrupt every later ledger row.
  base_unit public.base_unit not null,
  category text check (length(category) <= 60),
  is_stock boolean not null default true,
  allergens public.allergen[] not null default '{}',
  default_shelf_life_days smallint check (default_shelf_life_days > 0),
  -- Reorder settings: created in M1, edited from M16.
  min_level numeric(12, 4) check (min_level >= 0),
  target_level numeric(12, 4) check (target_level >= 0),
  is_critical boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default app.app_user_id() references public.app_user (id),
  constraint ingredient_tenant_id_id_uq unique (tenant_id, id),
  constraint ingredient_levels_ck check (target_level is null or min_level is null
                                         or target_level >= min_level)
);
create unique index ingredient_name_uq on public.ingredient (tenant_id, app.normalise_name(name));

alter table public.location enable row level security;
alter table public.ingredient enable row level security;

revoke all on public.location, public.ingredient from anon, authenticated;
revoke delete, truncate on public.location, public.ingredient from service_role;

grant select, insert (name), update (name, is_active) on public.location to authenticated;
grant select,
  insert (name, base_unit, category, is_stock, allergens, default_shelf_life_days,
          min_level, target_level, is_critical),
  update (name, category, is_stock, allergens, default_shelf_life_days,
          min_level, target_level, is_critical, is_active)
  on public.ingredient to authenticated;

create policy location_select on public.location
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
create policy location_insert on public.location
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy location_update on public.location
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'))
  with check (tenant_id = (select app.tenant_id()));

create policy ingredient_select on public.ingredient
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
create policy ingredient_insert on public.ingredient
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy ingredient_update on public.ingredient
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'))
  with check (tenant_id = (select app.tenant_id()));
