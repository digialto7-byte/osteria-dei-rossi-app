-- M21 step 1 (docs/plans/2026-10-30-m21-bill-close.md §3.2, §5; ADR-023): the closing columns of table_session, the receipt and payment code
-- lists, the table_session_guard that lets a session close once (and then stays final), and public.day_close, the append-only entry of the
-- register total.
--
--   * No procedure before M21 could close a session, so no real row lacks the details; the detail check is one-directional on purpose
--     (details need a closed session, a closed session may lack them) so the fixtures of pgTAP 157, 166, 172, 174 and 175 stay valid.
--   * table_session_guard keeps its name (157 disables it by name). Every M17 rule is kept; the only change is the closing transition.
--   * day_close: rows are written only by public.enter_day_close (a definer, a later migration); no API role holds a write grant.

-- Code lists: one place each, mirrored by RECEIPT_TYPES and PAYMENT_TYPES in src/server/bill/constants.ts (parity test).
create function app.receipt_types() returns text[]
  language sql immutable
  set search_path = ''
as $$ select array['scontrino', 'fattura']::text[] $$;
-- Q126: the project plan's example list, not a confirmed one. A different list is a change here and in the TS constant.
create function app.payment_type_codes() returns text[]
  language sql immutable
  set search_path = ''
as $$ select array['cash', 'card', 'other']::text[] $$;
revoke all on function app.receipt_types(), app.payment_type_codes() from public, anon, authenticated, service_role;

-- The closing columns. business_date stays the date of the OPENING; closed_business_date is the business date of the close (Q128).
alter table public.table_session
  add column closed_business_date date,
  add column receipt_type text constraint table_session_receipt_type_check check (receipt_type = any (app.receipt_types())),
  add column receipt_number text constraint table_session_receipt_number_check check (receipt_number ~ '^[0-9A-Za-z][0-9A-Za-z/.-]{0,19}$'),
  add column payment_type text constraint table_session_payment_type_check check (payment_type = any (app.payment_type_codes())),
  add column total numeric(12, 2) constraint table_session_total_check check (total >= 0);
alter table public.table_session
  add column missing_receipt boolean generated always as
    (closed_at is not null and receipt_type is not null and receipt_number is null) stored;
alter table public.table_session
  add constraint table_session_close_detail_ck check (
    num_nonnulls(closed_business_date, receipt_type, payment_type, total) in (0, 4)
    and (receipt_type is null or closed_at is not null)
    and (receipt_number is null or receipt_type is not null));
create index table_session_closed_day_idx on public.table_session (tenant_id, closed_business_date)
  where closed_at is not null;

-- The guard of M17 (20261031100000) with one change: a session may close once, with its details. Closed is final.
create or replace function app.table_session_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.closed_at is not null then
    raise exception 'table_session_closed' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.dining_table_id is distinct from old.dining_table_id
     or new.table_name is distinct from old.table_name
     or new.opened_at is distinct from old.opened_at
     or new.opened_by is distinct from old.opened_by
     or new.business_date is distinct from old.business_date
     or new.coperto_amount is distinct from old.coperto_amount
     or new.coperto_vat_rate is distinct from old.coperto_vat_rate
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'table_session_immutable' using errcode = 'P0001';
  end if;
  if new.closed_at is not null then
    -- The closing transition: who, which business date, the document, the payment and the frozen total are all required
    -- (the receipt number is optional: missing_receipt flags it).
    if new.closed_by is null or new.closed_business_date is null or new.receipt_type is null
       or new.payment_type is null or new.total is null then
      raise exception 'table_session_close_incomplete' using errcode = 'P0001';
    end if;
  elsif new.closed_by is distinct from old.closed_by
        or new.closed_business_date is distinct from old.closed_business_date
        or new.receipt_type is distinct from old.receipt_type
        or new.receipt_number is distinct from old.receipt_number
        or new.payment_type is distinct from old.payment_type
        or new.total is distinct from old.total then
    -- A closing column changes only together with closed_at.
    raise exception 'table_session_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- The register total the owner types at the end of the day. Append-only: each entry is a new row, the latest of a business date is in
-- force, and who entered which figure stays on record.
create table public.day_close (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  business_date date not null,
  register_total numeric(12, 2) not null check (register_total >= 0 and register_total <= 9999999.99),
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  constraint day_close_tenant_id_id_uq unique (tenant_id, id),
  constraint day_close_created_by_fkey foreign key (tenant_id, created_by) references public.app_user (tenant_id, id)
);
create index day_close_day_idx on public.day_close (tenant_id, business_date, created_at desc, id desc);

create trigger day_close_append_only before update or delete on public.day_close
  for each row execute function app.append_only();
create trigger day_close_no_truncate before truncate on public.day_close
  for each statement execute function app.append_only_truncate();

alter table public.day_close enable row level security;
-- service_role reads (integration tests); nobody writes through a table grant.
revoke all on public.day_close from anon, authenticated, service_role;
grant select on public.day_close to authenticated, service_role;
create policy day_close_select on public.day_close for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
