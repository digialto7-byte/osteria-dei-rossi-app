-- M14 step 1: batch types, tables, view, guards, append-only triggers, RLS and grants (M14 plan §3.1.1-3, §3.2;
-- ADR-013; project plan §3.5.1-3.5.3).
--
-- Portions are never stored as a balance: v_batch_portions folds batch_movement. batch.portions_initial is the
-- produced fact (like raw_lot.qty_received) and equals the one produce movement. The cost of a batch sits in its
-- own table (ADR-003): founder Q16 = project V6 (2026-10-23) means the chef reads no batch_cost row. Only
-- SECURITY DEFINER procedures write these tables (no INSERT/UPDATE/DELETE grant for any API role), and the
-- append-only triggers (20261022140000) stop every other role as well. M14 creates 'fresh' batches and 'produce'
-- movements only; the other states and movement types exist now so M15/M19 never need ALTER TYPE ... ADD VALUE.

create type public.batch_state as enum ('fresh', 'open', 'finished', 'discarded');
create type public.batch_movement_type as enum ('produce', 'consume', 'count', 'waste', 'split');

create table public.batch (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  -- The recipe version is pinned: recipe_id is the version row, checked against the key and the version.
  recipe_key uuid not null,
  recipe_id uuid not null,
  recipe_version integer not null,
  lot_code text not null,
  lot_date date not null,
  lot_recipe_code text not null check (lot_recipe_code ~ '^[A-Z0-9]{1,6}$'),
  lot_seq integer not null check (lot_seq between 1 and 9999),
  produced_at timestamptz not null,
  produced_by uuid not null,
  output_qty numeric(12, 4) not null check (output_qty > 0 and output_qty <= 100000),
  output_unit public.base_unit not null,
  -- The rounded-down figure, beside the confirmed one, so an edit by the chef stays visible.
  portions_computed integer not null check (portions_computed between 0 and 10000),
  portions_initial integer not null check (portions_initial between 1 and 10000),
  shelf_life_hours integer not null check (shelf_life_hours between 1 and 8760),
  use_by timestamptz not null,
  state public.batch_state not null default 'fresh',
  location_id uuid not null,
  split_from_batch_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  constraint batch_tenant_id_id_uq unique (tenant_id, id),
  constraint batch_lot_code_uq unique (tenant_id, lot_code),
  constraint batch_lot_code_ck check (
    lot_code = to_char(lot_date, 'YYMMDD') || '-' || lot_recipe_code || '-' || lot_seq),
  -- Elapsed seconds, so the check never depends on the session time zone (plan §3.1.8).
  constraint batch_use_by_ck check (extract(epoch from use_by - produced_at) = shelf_life_hours * 3600),
  constraint batch_recipe_version_fkey foreign key (tenant_id, recipe_key, recipe_version)
    references public.recipe (tenant_id, recipe_key, version),
  constraint batch_recipe_fkey foreign key (tenant_id, recipe_id)
    references public.recipe (tenant_id, id),
  constraint batch_location_fkey foreign key (tenant_id, location_id)
    references public.location (tenant_id, id),
  constraint batch_produced_by_fkey foreign key (tenant_id, produced_by)
    references public.app_user (tenant_id, id),
  constraint batch_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id),
  constraint batch_split_from_fkey foreign key (tenant_id, split_from_batch_id)
    references public.batch (tenant_id, id)
);
create index batch_produced_idx on public.batch (tenant_id, produced_at desc, id);
create index batch_recipe_idx on public.batch (tenant_id, recipe_key, produced_at desc);

-- The raw side: one row per consumption movement of the batch (a lot slice, or the unlotted shortfall slice with
-- raw_lot_id null). The forward and backward trace of M31 reads these.
create table public.batch_input (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  batch_id uuid not null,
  ingredient_id uuid not null,
  location_id uuid not null,
  raw_lot_id uuid,
  -- Base units of the ingredient; the positive mirror of the movement's negative qty.
  qty numeric(12, 4) not null check (qty > 0),
  stock_movement_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  constraint batch_input_movement_uq unique (stock_movement_id),
  constraint batch_input_batch_fkey foreign key (tenant_id, batch_id)
    references public.batch (tenant_id, id),
  constraint batch_input_ingredient_fkey foreign key (tenant_id, ingredient_id)
    references public.ingredient (tenant_id, id),
  constraint batch_input_location_fkey foreign key (tenant_id, location_id)
    references public.location (tenant_id, id),
  constraint batch_input_lot_fkey foreign key (tenant_id, raw_lot_id)
    references public.raw_lot (tenant_id, id),
  constraint batch_input_movement_fkey foreign key (tenant_id, stock_movement_id)
    references public.stock_movement (tenant_id, id),
  constraint batch_input_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);
create index batch_input_batch_idx on public.batch_input (tenant_id, batch_id);
create index batch_input_lot_idx on public.batch_input (tenant_id, raw_lot_id);

-- The portion ledger. portions is signed and fractional so M19 can deplete 0,5 of a portion (PRD 2.2).
create table public.batch_movement (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  batch_id uuid not null,
  type public.batch_movement_type not null,
  portions numeric(12, 4) not null check (portions <> 0),
  reason_code text,
  ref_type text not null check (ref_type ~ '^[a-z_]{1,40}$'),
  ref_id uuid not null,
  reverses_id uuid,
  effective_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  constraint batch_movement_tenant_id_id_uq unique (tenant_id, id),
  -- M14 writes and allows 'produce' only; M15/M19 replace this with the shapes of the other types.
  constraint batch_movement_m14_ck check (
    type::text = 'produce' and portions > 0 and reason_code is null and reverses_id is null
    and ref_type = 'batch' and ref_id = batch_id),
  constraint batch_movement_batch_fkey foreign key (tenant_id, batch_id)
    references public.batch (tenant_id, id),
  constraint batch_movement_reverses_fkey foreign key (tenant_id, reverses_id)
    references public.batch_movement (tenant_id, id),
  constraint batch_movement_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);
-- One production per batch.
create unique index batch_movement_produce_uq on public.batch_movement (batch_id) where type = 'produce';
-- A movement is reversed at most once.
create unique index batch_movement_reverses_uq on public.batch_movement (reverses_id) where reverses_id is not null;
create index batch_movement_batch_idx on public.batch_movement (tenant_id, batch_id);

-- The frozen cost of a batch (ADR-008): a copy made at production, never recomputed. Unknown is never zero:
-- an input without a price makes the whole cost incomplete (null total) and lists the ingredients.
create table public.batch_cost (
  batch_id uuid primary key,
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  total_cost numeric(12, 4) check (total_cost >= 0),
  unit_cost_frozen numeric(12, 4) check (unit_cost_frozen >= 0),
  incomplete boolean not null,
  missing_ingredient_ids uuid[] not null default '{}',
  cost_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  constraint batch_cost_complete_ck check (
    incomplete = (total_cost is null)
    and (total_cost is null) = (unit_cost_frozen is null)
    and incomplete = (cardinality(missing_ingredient_ids) > 0)),
  constraint batch_cost_batch_fkey foreign key (tenant_id, batch_id)
    references public.batch (tenant_id, id),
  constraint batch_cost_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);

-- Insert guard: the recipe_id is the pinned version of a batch recipe. Update guard: the row never changes except
-- for its state, which only M15's procedures move.
create function app.batch_guard() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform 1
      from public.recipe r
      join public.recipe_key k on k.tenant_id = r.tenant_id and k.id = r.recipe_key
     where r.tenant_id = new.tenant_id and r.id = new.recipe_id
       and r.recipe_key = new.recipe_key and r.version = new.recipe_version and k.type = 'batch';
    if not found then
      raise exception 'batch_recipe_mismatch' using errcode = 'P0001';
    end if;
  elsif (to_jsonb(new) - 'state') is distinct from (to_jsonb(old) - 'state') then
    raise exception 'batch_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- Defence in depth: a batch_input mirrors its consumption movement exactly (type, operation, ingredient, location,
-- lot and quantity), so a future procedure bug cannot write a link that the ledger does not back.
create function app.batch_input_guard() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  m public.stock_movement;
begin
  select * into m
    from public.stock_movement s
   where s.tenant_id = new.tenant_id and s.id = new.stock_movement_id;
  if not found
     or m.type::text <> 'consumption'
     or m.ref_type is distinct from 'batch'
     or m.ref_id is distinct from new.batch_id
     or m.ingredient_id <> new.ingredient_id
     or m.location_id <> new.location_id
     or m.raw_lot_id is distinct from new.raw_lot_id
     or m.qty <> -new.qty then
    raise exception 'batch_input_mismatch' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.batch_guard(), app.batch_input_guard() from public, anon, authenticated, service_role;

create trigger batch_guard before insert or update on public.batch
  for each row execute function app.batch_guard();
create trigger batch_no_delete before delete on public.batch
  for each row execute function app.append_only();
create trigger batch_no_truncate before truncate on public.batch
  for each statement execute function app.append_only_truncate();
create trigger batch_input_guard before insert on public.batch_input
  for each row execute function app.batch_input_guard();
create trigger batch_input_append_only before update or delete on public.batch_input
  for each row execute function app.append_only();
create trigger batch_input_no_truncate before truncate on public.batch_input
  for each statement execute function app.append_only_truncate();
create trigger batch_movement_append_only before update or delete on public.batch_movement
  for each row execute function app.append_only();
create trigger batch_movement_no_truncate before truncate on public.batch_movement
  for each statement execute function app.append_only_truncate();
create trigger batch_cost_append_only before update or delete on public.batch_cost
  for each row execute function app.append_only();
create trigger batch_cost_no_truncate before truncate on public.batch_cost
  for each statement execute function app.append_only_truncate();

-- Portions remaining, derived on every read; no cost column.
create view public.v_batch_portions with (security_invoker = true) as
  select m.tenant_id, m.batch_id, sum(m.portions) as portions_remaining
    from public.batch_movement m
   group by m.tenant_id, m.batch_id;

alter table public.batch enable row level security;
alter table public.batch_input enable row level security;
alter table public.batch_movement enable row level security;
alter table public.batch_cost enable row level security;

revoke all on public.batch, public.batch_input, public.batch_movement, public.batch_cost, public.v_batch_portions
  from anon, authenticated, service_role;
grant select on public.batch, public.batch_input, public.batch_movement, public.batch_cost, public.v_batch_portions
  to authenticated, service_role;

-- Batches carry no EUR value, so the kitchen reads them; the waiter reads none (Q16, plan §3.11.2).
create policy batch_select on public.batch
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
create policy batch_input_select on public.batch_input
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
create policy batch_movement_select on public.batch_movement
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
-- The cost: owner and admin only (Q16 = project V6 replaces the base-plan chef read).
create policy batch_cost_select on public.batch_cost
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
