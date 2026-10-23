-- M7 step 4: recipe tables (M7 plan §3.2; ADR-007). recipe_key is the stable identity (menu items
-- and sub-recipe lines point at it); recipe is one immutable row per version; recipe_line belongs
-- to a version; recipe_price holds the sale price and target GP% of a plate version.
-- Only SECURITY DEFINER procedures write these tables (no INSERT/UPDATE/DELETE grant for any API
-- role), and the append-only triggers (20261022140000) stop every other role as well, so history
-- cannot be rewritten by the migration owner or a wrong grant.

create type public.recipe_type as enum ('batch', 'plate', 'sub');
-- Recipe lines add the portion ('porz') to the measure units; a batch is used in portions.
create type public.recipe_unit as enum ('kg', 'g', 'l', 'ml', 'pz', 'porz');

create function app.recipe_unit_dimension(p_unit public.recipe_unit) returns text
  language sql immutable
  set search_path = ''
as $$
  select case p_unit
    when 'kg' then 'mass' when 'g' then 'mass'
    when 'l' then 'volume' when 'ml' then 'volume'
    when 'pz' then 'count'
    else 'portion'
  end
$$;
revoke all on function app.recipe_unit_dimension(public.recipe_unit) from public, anon;
grant execute on function app.recipe_unit_dimension(public.recipe_unit) to authenticated, service_role;

create table public.recipe_key (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  type public.recipe_type not null,
  -- Maintained only by the procedures: the version in force and its normalised name (for the
  -- unique name index and import matching).
  current_version integer not null check (current_version >= 1),
  name_norm text not null check (length(name_norm) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint recipe_key_tenant_id_id_uq unique (tenant_id, id),
  constraint recipe_key_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);
create unique index recipe_key_name_uq on public.recipe_key (tenant_id, name_norm);

create table public.recipe (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  recipe_key uuid not null,
  version integer not null check (version >= 1),
  -- Server clock, strictly increasing per key (set by the procedures, never by a client).
  valid_from timestamptz not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  output_qty numeric(12, 4) check (output_qty > 0 and output_qty <= 100000),
  output_unit public.base_unit,
  portions_per_batch integer check (portions_per_batch between 1 and 10000),
  shelf_life_hours integer check (shelf_life_hours between 1 and 8760),
  prep_time_min integer check (prep_time_min between 0 and 1440),
  min_portions integer check (min_portions between 0 and 10000),
  target_portions integer check (target_portions between 0 and 10000),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint recipe_tenant_id_id_uq unique (tenant_id, id),
  constraint recipe_key_version_uq unique (tenant_id, recipe_key, version),
  constraint recipe_recipe_key_fkey foreign key (tenant_id, recipe_key)
    references public.recipe_key (tenant_id, id),
  constraint recipe_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id),
  constraint recipe_output_ck check ((output_qty is null) = (output_unit is null)),
  constraint recipe_portions_ck
    check (target_portions is null or min_portions is null or target_portions >= min_portions)
);

create table public.recipe_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  recipe_id uuid not null,
  position smallint not null check (position between 1 and 100),
  ingredient_id uuid,
  -- Sub-recipes and batches are referenced by key, never by version: the reader resolves the version.
  sub_recipe_key uuid,
  -- The net, usable quantity; the raw quantity taken from stock is qty / yield_factor.
  qty numeric(12, 4) not null check (qty > 0 and qty <= 100000),
  unit public.recipe_unit not null,
  yield_factor numeric(6, 4) not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint recipe_line_yield_factor_check check (yield_factor > 0 and yield_factor <= 10),
  constraint recipe_line_target_ck check (num_nonnulls(ingredient_id, sub_recipe_key) = 1),
  constraint recipe_line_position_uq unique (tenant_id, recipe_id, position),
  constraint recipe_line_recipe_fkey foreign key (tenant_id, recipe_id)
    references public.recipe (tenant_id, id),
  constraint recipe_line_ingredient_fkey foreign key (tenant_id, ingredient_id)
    references public.ingredient (tenant_id, id),
  constraint recipe_line_sub_recipe_fkey foreign key (tenant_id, sub_recipe_key)
    references public.recipe_key (tenant_id, id),
  constraint recipe_line_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);
create index recipe_line_sub_recipe_idx on public.recipe_line (tenant_id, sub_recipe_key);
create index recipe_line_ingredient_idx on public.recipe_line (tenant_id, ingredient_id);

-- Sale price and target GP% of a plate version (ADR-003 split-table pattern). One immutable row
-- per plate version: a price change is a new version.
create table public.recipe_price (
  recipe_id uuid primary key,
  tenant_id uuid not null references public.tenant (id),
  sale_price numeric(12, 2) check (sale_price >= 0 and sale_price <= 100000),
  target_gp_pct numeric(5, 2) check (target_gp_pct >= 0 and target_gp_pct < 100),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint recipe_price_recipe_fkey foreign key (tenant_id, recipe_id)
    references public.recipe (tenant_id, id),
  constraint recipe_price_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);
comment on column public.recipe_price.sale_price is 'menu price per plate, VAT included (M7 Q3)';

-- Identity fields never change; the version counter grows by one at a time.
create function app.recipe_key_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
     or new.type is distinct from old.type or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by
     or (new.current_version <> old.current_version and new.current_version <> old.current_version + 1)
  then
    raise exception 'recipe_key_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- Backstop for the type rules the procedures check first (plan §3.1.4): which fields a version of
-- each type may or must have.
create function app.recipe_type_fields() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  t public.recipe_type;
  j jsonb := to_jsonb(new);
  col text;
  forbidden text[];
  required text[];
begin
  select k.type into t from public.recipe_key k
   where k.tenant_id = new.tenant_id and k.id = new.recipe_key;
  if not found then
    return new; -- the foreign key reports the missing key
  end if;
  forbidden := case t
    when 'plate' then array['output_qty', 'output_unit', 'portions_per_batch', 'shelf_life_hours',
                            'prep_time_min', 'min_portions', 'target_portions']
    when 'sub' then array['portions_per_batch', 'shelf_life_hours', 'min_portions', 'target_portions']
    else '{}'::text[] end;
  required := case t
    when 'batch' then array['output_qty', 'portions_per_batch', 'shelf_life_hours']
    when 'sub' then array['output_qty']
    else '{}'::text[] end;
  foreach col in array forbidden loop
    if jsonb_typeof(j -> col) <> 'null' then
      raise exception 'field_not_for_type' using errcode = 'P0001', detail = col;
    end if;
  end loop;
  foreach col in array required loop
    if jsonb_typeof(j -> col) = 'null' then
      raise exception 'field_not_for_type' using errcode = 'P0001', detail = col;
    end if;
  end loop;
  return new;
end
$$;

-- Only plates have a price.
create function app.recipe_price_type() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  t public.recipe_type;
begin
  select k.type into t
    from public.recipe r
    join public.recipe_key k on k.tenant_id = r.tenant_id and k.id = r.recipe_key
   where r.tenant_id = new.tenant_id and r.id = new.recipe_id;
  if found and t <> 'plate' then
    raise exception 'price_not_for_type' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.recipe_key_guard(), app.recipe_type_fields(), app.recipe_price_type()
  from public, anon;

create trigger recipe_key_guard before update on public.recipe_key
  for each row execute function app.recipe_key_guard();
create trigger recipe_key_no_delete before delete on public.recipe_key
  for each row execute function app.append_only();
create trigger recipe_key_no_truncate before truncate on public.recipe_key
  for each statement execute function app.append_only_truncate();

create trigger recipe_type_fields before insert on public.recipe
  for each row execute function app.recipe_type_fields();
create trigger recipe_append_only before update or delete on public.recipe
  for each row execute function app.append_only();
create trigger recipe_no_truncate before truncate on public.recipe
  for each statement execute function app.append_only_truncate();

create trigger recipe_line_append_only before update or delete on public.recipe_line
  for each row execute function app.append_only();
create trigger recipe_line_no_truncate before truncate on public.recipe_line
  for each statement execute function app.append_only_truncate();

create trigger recipe_price_type before insert on public.recipe_price
  for each row execute function app.recipe_price_type();
create trigger recipe_price_append_only before update or delete on public.recipe_price
  for each row execute function app.append_only();
create trigger recipe_price_no_truncate before truncate on public.recipe_price
  for each statement execute function app.append_only_truncate();

-- The current version of every recipe, as the caller's RLS shows it. No price column: prices are
-- read from recipe_price.
create view public.v_recipe_current with (security_invoker = true) as
  select r.id, r.tenant_id, r.recipe_key, k.type, k.is_active, r.version, r.valid_from, r.name,
         r.output_qty, r.output_unit, r.portions_per_batch, r.shelf_life_hours, r.prep_time_min,
         r.min_portions, r.target_portions, r.created_at, r.created_by
    from public.recipe r
    join public.recipe_key k
      on k.tenant_id = r.tenant_id and k.id = r.recipe_key and k.current_version = r.version;

alter table public.recipe_key enable row level security;
alter table public.recipe enable row level security;
alter table public.recipe_line enable row level security;
alter table public.recipe_price enable row level security;

revoke all on public.recipe_key, public.recipe, public.recipe_line, public.recipe_price,
  public.v_recipe_current from anon, authenticated, service_role;
grant select on public.recipe_key, public.recipe, public.recipe_line, public.recipe_price,
  public.v_recipe_current to authenticated;

-- Waiters read no recipe in M7 (no policy for them).
create policy recipe_key_select on public.recipe_key
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
create policy recipe_select on public.recipe
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
create policy recipe_line_select on public.recipe_line
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));

-- Q16 = V6 (founder 2026-10-23, "percentages only"): the chef reads the menu price and the target
-- GP%, never a cost or margin in euros (none exists in M7). This policy is the one place that
-- decides who reads prices; the chef cannot write them (no grant, and the procedures refuse).
create policy recipe_price_select on public.recipe_price
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
