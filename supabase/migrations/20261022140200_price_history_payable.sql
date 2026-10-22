-- M5 step 3: price_history and payable (M5 plan §3.3; project plan §3.5.1). Both carry money, so
-- owner and admin read them and nobody else (founder decision 2026-10-22: the chef never sees a
-- EUR cost; waiters never see costs). Rows are written only by approve_invoice (SECURITY DEFINER);
-- no API role has an INSERT, UPDATE, DELETE or TRUNCATE grant.

-- The price paid per ingredient base unit for one received invoice line. Append-only.
-- effective_on is the business date (the invoice date); seq orders rows with the same date.
create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  ingredient_id uuid not null,
  supplier_id uuid not null,
  -- Null for a split child (it has no supplier item).
  supplier_item_id uuid,
  invoice_line_id uuid not null,
  unit_price numeric(12, 4) not null check (unit_price >= 0),
  base_unit public.base_unit not null,
  effective_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id() references public.app_user (id),
  constraint price_history_tenant_id_id_uq unique (tenant_id, id),
  constraint price_history_invoice_line_uq unique (tenant_id, invoice_line_id),
  constraint price_history_ingredient_fk foreign key (tenant_id, ingredient_id)
    references public.ingredient (tenant_id, id),
  constraint price_history_supplier_fk foreign key (tenant_id, supplier_id)
    references public.supplier (tenant_id, id),
  constraint price_history_item_fk foreign key (tenant_id, supplier_item_id)
    references public.supplier_item (tenant_id, id),
  constraint price_history_invoice_line_fk foreign key (tenant_id, invoice_line_id)
    references public.invoice_line (tenant_id, id)
);
create index price_history_ingredient_idx
  on public.price_history (tenant_id, ingredient_id, effective_on desc, seq desc);
create index price_history_item_idx
  on public.price_history (tenant_id, supplier_item_id, effective_on desc, seq desc);

comment on column public.price_history.unit_price is
  'EUR per ingredient base unit (base_unit), net of VAT: line_amount / (qty x base_factor).';

comment on column public.supplier_item.last_price is
  'EUR per ingredient base unit, net of VAT: the price of the newest price_history row of this '
  'item (by effective_on, then seq). Written only by approve_invoice (M5).';

create type public.payable_status as enum ('open', 'scheduled', 'paid', 'disputed');

-- What the venue owes the supplier for one approved invoice: the gross total minus the credited
-- value of short or damaged lines (credits include their VAT, plan §3.1.7). M9 adds the status
-- procedure; until then every payable stays 'open'.
create table public.payable (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  invoice_id uuid not null,
  supplier_id uuid not null,
  gross_amount numeric(12, 2) not null check (gross_amount >= 0),
  credited_amount numeric(12, 2) not null check (credited_amount >= 0),
  amount numeric(12, 2) not null check (amount >= 0),
  due_date date not null,
  due_date_source text not null check (due_date_source in ('invoice', 'supplier_terms')),
  status public.payable_status not null default 'open',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id() references public.app_user (id),
  constraint payable_tenant_id_id_uq unique (tenant_id, id),
  constraint payable_invoice_uq unique (tenant_id, invoice_id),
  constraint payable_amount_ck check (amount = gross_amount - credited_amount),
  constraint payable_paid_at_ck check ((status = 'paid') = (paid_at is not null)),
  constraint payable_invoice_fk foreign key (tenant_id, invoice_id)
    references public.invoice (tenant_id, id),
  constraint payable_supplier_fk foreign key (tenant_id, supplier_id)
    references public.supplier (tenant_id, id)
);

-- The money and the identity of a payable never change, for any role. Status, paid_at and
-- due_date stay open for the M9 status procedure.
create function app.payable_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.invoice_id is distinct from old.invoice_id
     or new.supplier_id is distinct from old.supplier_id
     or new.gross_amount is distinct from old.gross_amount
     or new.credited_amount is distinct from old.credited_amount
     or new.amount is distinct from old.amount
     or new.due_date_source is distinct from old.due_date_source
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'payable_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.payable_guard() from public, anon;

alter table public.price_history enable row level security;
alter table public.payable enable row level security;

revoke all on public.price_history, public.payable from anon, authenticated;
revoke insert, update, delete, truncate on public.price_history, public.payable from service_role;
grant select on public.price_history, public.payable to authenticated;

create policy price_history_select on public.price_history
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy payable_select on public.payable
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

create trigger price_history_append_only
  before update or delete on public.price_history
  for each row execute function app.append_only();
create trigger price_history_no_truncate
  before truncate on public.price_history
  for each statement execute function app.append_only_truncate();

create trigger payable_guard
  before update on public.payable
  for each row execute function app.payable_guard();
create trigger payable_no_delete
  before delete on public.payable
  for each row execute function app.append_only();
create trigger payable_no_truncate
  before truncate on public.payable
  for each statement execute function app.append_only_truncate();
