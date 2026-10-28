-- M19 step 1: order_line_cost, the batch movement shapes for firing and voids, the batch reversal guard and the two
-- indexes (M19 plan §3.2; ADR-019; project plan §3.5.2).
--
--   order_line_cost  the cost of a sent plate, frozen in the fire transaction (one row per fired line, append-only).
--                    Unknown is never zero: an unmapped item, an unpriced ingredient, a batch of unknown cost or a key
--                    with no batch to book on makes the row `incomplete` with null totals. Owner and admin read it; the
--                    chef does not (founder Q16 = project V6, pgTAP 059), the waiter never. service_role gets select
--                    only (the integration suite reads it; lesson 2). Nobody writes it directly: the rows come from
--                    app.freeze_line_cost (step 2).
--   batch_movement_shape_ck  re-created as every M15 shape verbatim plus the M19 shapes: a consume (order_line), its
--                    reversal (order_void) and the waste row a void writes (order_void). Every other type still
--                    refuses reverses_id.

create table public.order_line_cost (
  order_line_id uuid primary key,
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  -- The plate version used; null when the menu item is not mapped to a recipe.
  recipe_id uuid,
  total_cost numeric(12, 4) check (total_cost >= 0),
  -- Per full plate (total / qty), like unit_price.
  unit_cost_at_sale numeric(12, 4) check (unit_cost_at_sale >= 0),
  incomplete boolean not null,
  missing_ingredient_ids uuid[] not null default '{}',
  missing_batch_ids uuid[] not null default '{}',
  -- Batch keys that had no batch to book the portions on (the plate got a new version after the line was added).
  unbooked_batch_keys uuid[] not null default '{}',
  cost_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  constraint order_line_cost_complete_ck check (
    incomplete = (total_cost is null)
    and (total_cost is null) = (unit_cost_at_sale is null)
    and incomplete = (recipe_id is null
      or cardinality(missing_ingredient_ids) + cardinality(missing_batch_ids) + cardinality(unbooked_batch_keys) > 0)),
  constraint order_line_cost_line_fkey foreign key (tenant_id, order_line_id)
    references public.order_line (tenant_id, id),
  constraint order_line_cost_recipe_fkey foreign key (tenant_id, recipe_id)
    references public.recipe (tenant_id, id),
  constraint order_line_cost_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);

create trigger order_line_cost_append_only before update or delete on public.order_line_cost
  for each row execute function app.append_only();
create trigger order_line_cost_no_truncate before truncate on public.order_line_cost
  for each statement execute function app.append_only_truncate();

alter table public.order_line_cost enable row level security;
revoke all on public.order_line_cost from anon, authenticated, service_role;
grant select on public.order_line_cost to authenticated, service_role;
-- Owner and admin only: this is a cost (Q16 = project V6 removed the base-plan chef read).
create policy order_line_cost_select on public.order_line_cost
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

-- ---------------------------------------------------------------------------------------------------------------------
-- The shapes. Every M15 branch is kept verbatim (inside `reverses_id is null`); M19 adds three:
--   consume          -1 style depletion of a fired line;
--   consume reversal +n, reverses a consume of the same batch (the guard below checks the pair);
--   void waste       the plate moves from "consumed" to "waste" after a void of a fired line.
-- Every comparison on the type uses type::text, and each branch ends in a definite true or false.
alter table public.batch_movement
  drop constraint batch_movement_shape_ck,
  add constraint batch_movement_shape_ck check (
    (
      reverses_id is null
      and (
        (type::text = 'produce' and portions > 0 and reason_code is null and ref_type = 'batch' and ref_id = batch_id)
        or (type::text = 'count' and reason_code is null and ref_type = 'batch_adjust')
        or (type::text = 'waste' and portions < 0 and reason_code is not null
            and reason_code = any (app.batch_waste_reason_codes())
            and (ref_type = 'batch_discard' or (ref_type = 'staff_meal' and reason_code = 'staff_meal')))
        or (type::text = 'split' and reason_code is null and ref_type = 'batch_split'
            and ((portions < 0 and ref_id <> batch_id) or (portions > 0 and ref_id = batch_id)))
        or (type::text = 'consume' and portions < 0 and reason_code is null and ref_type = 'order_line')
        or (type::text = 'waste' and portions < 0 and reason_code is not null
            and reason_code = any (app.batch_waste_reason_codes()) and ref_type = 'order_void')
      )
    )
    or (type::text = 'consume' and reverses_id is not null and portions > 0 and reason_code is null
        and ref_type = 'order_void')
  );

-- A reversal undoes exactly one consume of the same batch (mirror of M12's stock reversal guard). A second reversal of
-- the same movement is stopped by batch_movement_reverses_uq.
create function app.batch_movement_reversal_guard() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform 1
    from public.batch_movement o
   where o.tenant_id = new.tenant_id
     and o.id = new.reverses_id
     and o.type::text = 'consume'
     and o.reverses_id is null
     and o.batch_id = new.batch_id
     and o.portions = -new.portions;
  if not found then
    raise exception 'batch_reversal_mismatch' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.batch_movement_reversal_guard() from public, anon, authenticated, service_role;

-- AFTER INSERT on purpose: a row the shape check refuses (a count with reverses_id, a reversal of -1) is reported by
-- batch_movement_shape_ck as before (pgTAP 130 pins that); only a well-shaped reversal reaches this guard.
create trigger batch_movement_reversal_guard after insert on public.batch_movement
  for each row when (new.reverses_id is not null)
  execute function app.batch_movement_reversal_guard();

-- Void and cost read the rows of one line (ref_type, ref_id); the kitchen read is bounded to the recent fired lines.
create index batch_movement_ref_idx on public.batch_movement (tenant_id, ref_type, ref_id);
create index order_line_fired_idx on public.order_line (tenant_id, fired_at) where fired_at is not null;
