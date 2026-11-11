-- P2-0b A1 (sell by weight, plan §3.2, §3.1 D-2, D-4, D-7, L-4, L-5, P-4): the weight columns, the one rounding function, the portion
-- fraction, the constants, the tenant's maximum-weight setting column, the line-price trigger and the replaced order_line guard.
--
--   menu_item_price.portion_weight_g  the grams that count as one portion of the recipe, versioned with the unit and the price (set by
--                                     owner/admin, A2; review fix, Q-W15: a past day reads the weight that was in force then)
--   menu_item_price.price_unit        'portion' (default) or 'etto': an etto row holds the price per 100 g (D-2)
--   sale_settings.weight_max_g        the tenant's maximum weight per line; null = the app default (P-4)
--   order_line.weight_g, price_per_100g, portion_weight_g
--                                     a weighted line has qty 1, its weight, the per-etto price and the reference weight frozen at
--                                     entry, and unit_price = the line price (D-4). All three set or none (portion lines: none).
--
-- ADD COLUMN with a constant default (or null) rewrites nothing and fires no UPDATE trigger, so no append-only guard is involved and
-- no existing row changes. Nothing is granted or revoked on the tables: RLS and privileges are as before.

-- The unit and the reference portion weight are terms of the price row (ADR-016), so a change of either writes a new row from now, as a price
-- change does, and a report for a past day reads the terms that were in force. A price per etto needs the weight (the table refuses it without).
alter table public.menu_item_price
  add column price_unit text not null default 'portion' check (price_unit in ('portion', 'etto')),
  add column portion_weight_g integer check (portion_weight_g between 10 and 3000),
  add constraint menu_item_price_etto_weight_ck check (price_unit = 'portion' or portion_weight_g is not null);
alter table public.sale_settings
  add column weight_max_g integer check (weight_max_g between 500 and 10000 and weight_max_g % 10 = 0);
alter table public.order_line
  add column weight_g integer,
  add column price_per_100g numeric(12, 2),
  add column portion_weight_g integer,
  add constraint order_line_weight_set_ck check (num_nonnulls(weight_g, price_per_100g, portion_weight_g) in (0, 3)),
  add constraint order_line_weight_ck check (
    weight_g is null
    or (qty = 1 and weight_g between 1 and 20000 and portion_weight_g between 1 and 20000 and price_per_100g >= 0));

-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers (schema app, empty search_path, no API grant).

-- The one place a weighted price is rounded (D-4): to the cent, ties away from zero (= half-up for prices >= 0).
create function app.weight_line_price(p_price_per_100g numeric, p_grams integer) returns numeric
  language sql
  immutable
  set search_path = ''
as $$ select round(p_price_per_100g * p_grams / 100, 2) $$;

-- The portions a line stands for (D-7): its qty, or for a weighted line weight / reference portion weight, unrounded.
create function app.order_line_portions(p_qty numeric, p_weight_g integer, p_portion_g integer) returns numeric
  language sql
  immutable
  set search_path = ''
as $$ select case when p_weight_g is null then p_qty else p_weight_g::numeric / p_portion_g end $$;

create function app.weight_min_g() returns integer language sql immutable set search_path = '' as $$ select 50 $$;
create function app.weight_step_g() returns integer language sql immutable set search_path = '' as $$ select 10 $$;
create function app.default_weight_max_g() returns integer language sql immutable set search_path = '' as $$ select 3000 $$;
-- The range owner/admin may set the maximum in: the same numbers as the sale_settings CHECK.
create function app.weight_max_setting_bounds() returns table (min_g integer, max_g integer)
  language sql
  immutable
  set search_path = ''
as $$ select 500, 10000 $$;

-- The tenant's maximum weight per line: its setting, else the app default.
create function app.weight_max_g(p_tenant uuid) returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce((select s.weight_max_g from public.sale_settings s where s.tenant_id = p_tenant), app.default_weight_max_g())
$$;

-- The line price of a weighted line is checked when it is inserted and whenever its price inputs are written (L-4). A CHECK would be
-- re-evaluated on every update of the row, including the void of a fired line. A null input is left to the CHECK constraints.
create function app.order_line_weight_price() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.unit_price <> app.weight_line_price(new.price_per_100g, new.weight_g) then
    raise exception 'order_line_price_mismatch' using errcode = 'P0001';
  end if;
  return new;
end
$$;

revoke all on function
  app.weight_line_price(numeric, integer), app.order_line_portions(numeric, integer, integer), app.weight_min_g(), app.weight_step_g(),
  app.default_weight_max_g(), app.weight_max_setting_bounds(), app.weight_max_g(uuid), app.order_line_weight_price()
  from public, anon, authenticated, service_role;

create trigger order_line_weight_price before insert or update of weight_g, unit_price, price_per_100g on public.order_line
  for each row when (new.weight_g is not null) execute function app.order_line_weight_price();

-- ---------------------------------------------------------------------------------------------------------------------
-- Guard, replaced (M18 text plus): price_per_100g and portion_weight_g are immutable like unit_price; unit_price may change only on a
-- draft weighted line whose weight changes with it (the trigger above then checks the pair); after fire the weight is final.
create or replace function app.order_line_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.table_session_id is distinct from old.table_session_id
     or new.menu_item_id is distinct from old.menu_item_id
     or (new.unit_price is distinct from old.unit_price
         and not (old.fired_at is null and old.weight_g is not null and new.weight_g is distinct from old.weight_g))
     or new.price_per_100g is distinct from old.price_per_100g
     or new.portion_weight_g is distinct from old.portion_weight_g
     or new.vat_rate is distinct from old.vat_rate
     or new.price_source is distinct from old.price_source
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'order_line_immutable' using errcode = 'P0001';
  end if;
  if old.voided_at is not null then
    raise exception 'order_line_voided' using errcode = 'P0001';
  end if;
  if old.fired_at is not null then
    if new.voided_at is null
       or new.fired_at is distinct from old.fired_at
       or new.fired_by is distinct from old.fired_by
       or new.course is distinct from old.course
       or new.qty is distinct from old.qty
       or new.weight_g is distinct from old.weight_g
       or new.segue is distinct from old.segue
       or new.note is distinct from old.note
       or new.is_shared is distinct from old.is_shared
       or new.client_updated_at is distinct from old.client_updated_at then
      raise exception 'order_line_fired' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.order_line_guard() from public, anon, authenticated, service_role;
