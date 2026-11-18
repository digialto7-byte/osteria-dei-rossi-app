-- SP1 step 3 (docs/plans/2026-11-15-sp01-tenant-config.md section 3.1.1, 3.1.4, 3.2, 5 step 3; platform plan 0a, 5.4 H14): each tenant's SALE VAT list.
--
-- Two lists, on purpose (the founder may revisit, plan Q11):
--   app.allowed_vat_rates()  stays the immutable STATUTORY list (0, 4, 5, 10, 22). It checks supplier invoices (app.line_checks) and bounds the three sale-side CHECKs.
--   public.tenant_vat_rate   holds each tenant's SALE list, a subset of the statutory one, read through the stable app.sale_vat_rates(tenant).
--
-- The tenant list is enforced by a trigger, not by a CHECK (a CHECK never reads a table, pgTAP 396): app.check_sale_vat_rate() on menu_item_price (vat_rate) and
-- sale_settings (coperto_vat_rate) raises the same P0001 vat_rate_invalid as the procedures (for a statutory rate outside the tenant's list; a non-statutory rate still meets the CHECK, 23514), inside the same transaction, for every writer (the procedures, the demo seed,
-- table-owner inserts). create_menu_item, update_menu_item and set_sale_settings are NOT re-created: they meet the rule through the trigger. table_session.coperto_vat_rate
-- stays a snapshot with the statutory CHECK only, so an open session keeps its rate when the list changes.
--
-- tenant_vat_rate: RLS on, one select policy, no write grant to any API role. Rows are written only by app.seed_tenant_settings (this file) and, from step 7,
-- public.set_tenant_settings (definers); a removed rate becomes is_active = false, never a delete. The seed trigger on tenant gives every new tenant today's five rates, and
-- the backfill below gives every existing tenant the same, so tenant #1 sees no change (pgTAP 389 pins it).

create table public.tenant_vat_rate (
  tenant_id uuid not null references public.tenant (id),
  rate numeric(5, 2) not null check (rate = any (app.allowed_vat_rates())),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  primary key (tenant_id, rate),
  -- on delete set null (updated_by) (PG15+): the demo purge (ADR-018) deletes the demo users but keeps this configuration row, so a rate a demo
  -- user last edited loses only its author, never the tenant_id nor the row, and the purge does not abort on this key (pgTAP 193).
  constraint tenant_vat_rate_updated_by_fkey foreign key (tenant_id, updated_by) references public.app_user (tenant_id, id) on delete set null (updated_by)
);

alter table public.tenant_vat_rate enable row level security;

revoke all on public.tenant_vat_rate from anon, authenticated;
revoke insert, update, delete, truncate on public.tenant_vat_rate from service_role;
grant select on public.tenant_vat_rate to authenticated, service_role;

create policy tenant_vat_rate_select on public.tenant_vat_rate
  for select to authenticated
  using (tenant_id = (select app.tenant_id()));

-- The tenant's active sale rates, ascending, without trailing zeros (trim_scale), so to_jsonb gives [0,4,5,10,22] exactly as
-- to_jsonb(app.allowed_vat_rates()) does today (the vatRates payloads that step 4 moves to this list keep their text; pgTAP 389, 391).
-- Closed to every API role (definers and triggers call it).
create function app.sale_vat_rates(p_tenant uuid) returns numeric[]
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(array_agg(trim_scale(r.rate) order by r.rate), '{}'::numeric[])
    from public.tenant_vat_rate r
   where r.tenant_id = p_tenant and r.is_active
$$;
revoke all on function app.sale_vat_rates(uuid) from public, anon, authenticated, service_role;

-- The sale-side rule. Reads new.tenant_id, never the token, so it also holds for table-owner inserts. A null rate passes (a coperto may be unset).
-- The tenant's list is enforced only on a rate that is NEW or CHANGED (lead, Q12 / Q-a, 2026-11-18): a rate that left the list after it was stored
-- keeps working while it is not changed, and is never silently changed either.
--   sale_settings, UPDATE:  checked only when coperto_vat_rate is distinct from the old one (changing only the coperto amount keeps a stored 4 %).
--   menu_item_price, INSERT (a new price version; the table is append-only): checked only when the rate differs from the item's newest
--     existing version, the one it supersedes (update_menu_item always dates a new version after it). A first price is always checked.
--   menu_item_price, UPDATE: refused anyway by menu_item_price_append_only; the same "distinct from old" rule applies if it ever runs.
create function app.check_sale_vat_rate() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_rate numeric;
  v_kept numeric;
begin
  -- An if, not a case: a plpgsql `case` that mentions new.coperto_vat_rate fails with 42703 ("record new has no field") on menu_item_price, because the
  -- field is resolved when the statement runs. With an if, only the table's own column is ever read.
  if tg_table_name = 'menu_item_price' then
    v_rate := new.vat_rate;
    if tg_op = 'UPDATE' then
      v_kept := old.vat_rate;
    else
      select p.vat_rate into v_kept
        from public.menu_item_price p
       where p.tenant_id = new.tenant_id and p.menu_item_id = new.menu_item_id
       order by p.valid_from desc, p.created_at desc
       limit 1;
    end if;
  else
    v_rate := new.coperto_vat_rate;
    if tg_op = 'UPDATE' then
      v_kept := old.coperto_vat_rate;
    end if;
  end if;
  if v_rate is not distinct from v_kept then
    return new;
  end if;
  -- Only the tenant's subset within the statute is enforced here. A rate outside the statutory list falls through, so the CHECK on the column keeps
  -- raising 23514 for it (pgTAP 150 is unchanged); a statutory rate outside the tenant's list raises P0001 vat_rate_invalid.
  if v_rate is not null and v_rate = any (app.allowed_vat_rates()) and not (v_rate = any (app.sale_vat_rates(new.tenant_id))) then
    raise exception 'vat_rate_invalid' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.check_sale_vat_rate() from public, anon, authenticated, service_role;

create trigger menu_item_price_sale_vat
  before insert or update of vat_rate on public.menu_item_price
  for each row execute function app.check_sale_vat_rate();
create trigger sale_settings_sale_vat
  before insert or update of coperto_vat_rate on public.sale_settings
  for each row when (new.coperto_vat_rate is not null) execute function app.check_sale_vat_rate();

-- Every new tenant gets today's five rates (all active). Step 5 re-creates this function to seed the receipt and payment codes as well.
create function app.seed_tenant_settings() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.tenant_vat_rate (tenant_id, rate)
    select new.id, r.rate from unnest(app.allowed_vat_rates()) r (rate)
  on conflict do nothing;
  return new;
end
$$;
revoke all on function app.seed_tenant_settings() from public, anon, authenticated, service_role;

create trigger tenant_seed_settings
  after insert on public.tenant
  for each row execute function app.seed_tenant_settings();

-- The backfill: every existing tenant gets the same five rates (one statement, nothing deleted).
insert into public.tenant_vat_rate (tenant_id, rate)
  select t.id, r.rate from public.tenant t cross join unnest(app.allowed_vat_rates()) r (rate)
on conflict do nothing;
