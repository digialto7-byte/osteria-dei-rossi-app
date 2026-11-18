-- SP1 step 5 (docs/plans/2026-11-15-sp01-tenant-config.md section 3.1.2, 3.1.4, 3.2, 5 step 5; platform plan 5.4 H20): which receipt and payment codes each tenant offers, and in
-- what order, chosen from today's fixed catalogue.
--
--   app.receipt_types() and app.payment_type_codes() stay the catalogue: the codes the product knows, has Italian and English labels for, and allows in table_session's
--   CHECKs (20261110100000). public.tenant_close_code holds each tenant's subset and order (kind 'receipt' or 'payment'); a tenant never adds a code outside the catalogue
--   (plan Q6). close_table and the day-close report read the tenant's list from step 6 (20261206200300).
--
-- Configuration, not operational data (lead, 2026-11-18, Q-b, ADR-018 note): like tenant_vat_rate, the table is NOT in app.demo_purge_tables(). A demo reset keeps the venue's
-- choices, and begin_demo_data ignores it. pgTAP 194 exempts it by an exact list and 193 asserts the purge keeps it. updated_by is therefore
-- on delete set null (updated_by), exactly as tenant_vat_rate_updated_by_fkey: the purge deletes the demo users but keeps this row, which loses only its author.
--
-- RLS on, one select policy, no write grant to any API role. Rows are written only by app.seed_tenant_settings (here) and, from step 7, public.set_tenant_settings (definers);
-- a code a tenant stops offering becomes is_active = false, never a delete.

create table public.tenant_close_code (
  tenant_id uuid not null references public.tenant (id),
  kind text not null check (kind in ('receipt', 'payment')),
  code text not null,
  position smallint not null check (position between 1 and 20),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  primary key (tenant_id, kind, code),
  -- The catalogue bound: the CHECK calls the immutable catalogue functions only (a CHECK never reads a table, pgTAP 396).
  constraint tenant_close_code_catalogue_ck check (
    (kind = 'receipt' and code = any (app.receipt_types()))
    or (kind = 'payment' and code = any (app.payment_type_codes()))),
  -- on delete set null (updated_by) (PG15+), exactly as tenant_vat_rate_updated_by_fkey: the demo purge (ADR-018) deletes the demo users but keeps this configuration row.
  constraint tenant_close_code_updated_by_fkey foreign key (tenant_id, updated_by) references public.app_user (tenant_id, id) on delete set null (updated_by)
);

alter table public.tenant_close_code enable row level security;

revoke all on public.tenant_close_code from anon, authenticated;
revoke insert, update, delete, truncate on public.tenant_close_code from service_role;
grant select on public.tenant_close_code to authenticated, service_role;

create policy tenant_close_code_select on public.tenant_close_code
  for select to authenticated
  using (tenant_id = (select app.tenant_id()));

-- The tenant's active codes of one kind, by position (the code breaks a tie, so the order is always defined). Closed to every API role (definers call them).
create function app.tenant_receipt_types(p_tenant uuid) returns text[]
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(array_agg(c.code order by c.position, c.code), '{}'::text[])
    from public.tenant_close_code c
   where c.tenant_id = p_tenant and c.kind = 'receipt' and c.is_active
$$;
create function app.tenant_payment_types(p_tenant uuid) returns text[]
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(array_agg(c.code order by c.position, c.code), '{}'::text[])
    from public.tenant_close_code c
   where c.tenant_id = p_tenant and c.kind = 'payment' and c.is_active
$$;
revoke all on function app.tenant_receipt_types(uuid), app.tenant_payment_types(uuid) from public, anon, authenticated, service_role;

-- Step 3's seed function, re-created: a new tenant gets today's five VAT rates (unchanged) and now also the receipt and payment codes, all active, in catalogue order.
-- Idempotent (on conflict do nothing). The trigger tenant_seed_settings (step 3) calls it by name and is not re-created.
create or replace function app.seed_tenant_settings() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.tenant_vat_rate (tenant_id, rate)
    select new.id, r.rate from unnest(app.allowed_vat_rates()) r (rate)
  on conflict do nothing;
  insert into public.tenant_close_code (tenant_id, kind, code, position)
    select new.id, 'receipt', r.code, r.ord::smallint from unnest(app.receipt_types()) with ordinality r (code, ord)
  on conflict do nothing;
  insert into public.tenant_close_code (tenant_id, kind, code, position)
    select new.id, 'payment', p.code, p.ord::smallint from unnest(app.payment_type_codes()) with ordinality p (code, ord)
  on conflict do nothing;
  return new;
end
$$;
revoke all on function app.seed_tenant_settings() from public, anon, authenticated, service_role;

-- The backfill: every existing tenant gets the same codes (one statement per kind, nothing deleted, idempotent).
insert into public.tenant_close_code (tenant_id, kind, code, position)
  select t.id, 'receipt', r.code, r.ord::smallint from public.tenant t cross join unnest(app.receipt_types()) with ordinality r (code, ord)
on conflict do nothing;
insert into public.tenant_close_code (tenant_id, kind, code, position)
  select t.id, 'payment', p.code, p.ord::smallint from public.tenant t cross join unnest(app.payment_type_codes()) with ordinality p (code, ord)
on conflict do nothing;
