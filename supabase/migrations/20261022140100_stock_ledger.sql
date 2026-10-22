-- M5 step 2: raw_lot, stock_movement and v_stock_on_hand (M5 plan §3.3; ADR-002; project plan
-- §3.5.1). The stock balance is never stored: v_stock_on_hand sums the movement ledger. Both
-- tables are append-only (triggers from 20261022140000) and have no INSERT grant for any API
-- role: rows are written only by SECURITY DEFINER procedures (approve_invoice in M5, others in
-- M12). Founder decision 2026-10-22: the chef never sees a EUR cost. stock_movement carries
-- unit_cost, so only owner and admin read it; raw_lot has no cost column, so the chef reads it.
-- A cost-free stock path for the chef's screens is M12's.

-- M12 adds consumption, waste, transfer, count and reversal values.
create type public.stock_movement_type as enum ('receipt');

-- One lot per received invoice line. It stores the conversion it used, so a later edit of the
-- supplier's pack never changes what the receipt meant.
create table public.raw_lot (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  ingredient_id uuid not null,
  location_id uuid not null,
  supplier_id uuid not null,
  invoice_line_id uuid not null,
  lot_code text check (length(lot_code) between 1 and 64),
  expiry date,
  -- Business date of the receipt (the invoice date, M5 plan §3.1.5); created_at is the posting.
  received_on date not null,
  qty_received numeric(12, 4) not null check (qty_received > 0),
  base_unit public.base_unit not null,
  source_qty numeric(12, 4) not null check (source_qty > 0),
  source_unit text not null check (source_unit in ('kg', 'g', 'l', 'ml', 'pz', 'conf')),
  base_factor numeric(16, 8) not null check (base_factor > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id() references public.app_user (id),
  constraint raw_lot_tenant_id_id_uq unique (tenant_id, id),
  constraint raw_lot_invoice_line_uq unique (tenant_id, invoice_line_id),
  constraint raw_lot_qty_ck check (qty_received = round(source_qty * base_factor, 4)),
  constraint raw_lot_ingredient_fk foreign key (tenant_id, ingredient_id)
    references public.ingredient (tenant_id, id),
  constraint raw_lot_location_fk foreign key (tenant_id, location_id)
    references public.location (tenant_id, id),
  constraint raw_lot_supplier_fk foreign key (tenant_id, supplier_id)
    references public.supplier (tenant_id, id),
  constraint raw_lot_invoice_line_fk foreign key (tenant_id, invoice_line_id)
    references public.invoice_line (tenant_id, id)
);
create index raw_lot_ingredient_idx on public.raw_lot (tenant_id, ingredient_id, location_id);

comment on column public.raw_lot.qty_received is
  'In the ingredient base unit (base_unit); equals round(source_qty * base_factor, 4).';

-- The stock ledger: a signed quantity in the ingredient base unit. Balances are derived.
create table public.stock_movement (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  ingredient_id uuid not null,
  raw_lot_id uuid,
  location_id uuid not null,
  type public.stock_movement_type not null,
  qty numeric(12, 4) not null check (qty <> 0),
  -- EUR per base unit, frozen at the time of the movement. A cost: never granted to chef/waiter.
  unit_cost numeric(12, 4) check (unit_cost >= 0),
  reason_code text,
  ref_type text,
  ref_id uuid,
  reverses_id uuid,
  -- Business date; created_at is the posting moment.
  effective_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id() references public.app_user (id),
  constraint stock_movement_tenant_id_id_uq unique (tenant_id, id),
  constraint stock_movement_receipt_ck check (
    type <> 'receipt'
    or (qty > 0 and raw_lot_id is not null and ref_type = 'invoice_line' and ref_id is not null
        and unit_cost is not null and reverses_id is null)),
  constraint stock_movement_ingredient_fk foreign key (tenant_id, ingredient_id)
    references public.ingredient (tenant_id, id),
  constraint stock_movement_lot_fk foreign key (tenant_id, raw_lot_id)
    references public.raw_lot (tenant_id, id),
  constraint stock_movement_location_fk foreign key (tenant_id, location_id)
    references public.location (tenant_id, id),
  constraint stock_movement_reverses_fk foreign key (tenant_id, reverses_id)
    references public.stock_movement (tenant_id, id)
);
-- A movement is reversed at most once.
create unique index stock_movement_reverses_uq on public.stock_movement (reverses_id)
  where reverses_id is not null;
-- An invoice line is received at most once, even if a procedure is wrong.
create unique index stock_movement_receipt_uq on public.stock_movement (tenant_id, ref_id)
  where type = 'receipt';
create index stock_movement_ingredient_idx
  on public.stock_movement (tenant_id, ingredient_id, location_id);
create index stock_movement_lot_idx on public.stock_movement (tenant_id, raw_lot_id);

alter table public.raw_lot enable row level security;
alter table public.stock_movement enable row level security;

revoke all on public.raw_lot, public.stock_movement from anon, authenticated;
revoke insert, update, delete, truncate on public.raw_lot, public.stock_movement from service_role;
grant select on public.raw_lot, public.stock_movement to authenticated;

create policy raw_lot_select on public.raw_lot
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
create policy stock_movement_select on public.stock_movement
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

create trigger raw_lot_append_only
  before update or delete on public.raw_lot
  for each row execute function app.append_only();
create trigger raw_lot_no_truncate
  before truncate on public.raw_lot
  for each statement execute function app.append_only_truncate();
create trigger stock_movement_append_only
  before update or delete on public.stock_movement
  for each row execute function app.append_only();
create trigger stock_movement_no_truncate
  before truncate on public.stock_movement
  for each statement execute function app.append_only_truncate();

-- Stock on hand, derived from the ledger on every read; no cost column. security_invoker makes
-- the view run with the caller's rights, so the stock_movement policy applies: owner and admin
-- read rows, chef and waiter read none (M5 plan §3.5; the chef's cost-free path is M12's).
create view public.v_stock_on_hand with (security_invoker = true) as
  select m.tenant_id, m.ingredient_id, m.location_id, m.raw_lot_id, i.base_unit,
         sum(m.qty) as qty_on_hand
    from public.stock_movement m
    join public.ingredient i on i.tenant_id = m.tenant_id and i.id = m.ingredient_id
   group by m.tenant_id, m.ingredient_id, m.location_id, m.raw_lot_id, i.base_unit;

revoke all on public.v_stock_on_hand from anon, authenticated, service_role;
grant select on public.v_stock_on_hand to authenticated;
