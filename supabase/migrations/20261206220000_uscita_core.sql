-- Comanda per uscita, step 3, M1 (docs/plans/2026-11-18-comanda-uscite.md section 3.3; ADR-049): the uscita core.
--   * order_line.uscita smallint, 0..9, added WITHOUT a default: every existing row stays null ("a line from before uscite", T1). M5 places
--     the lines of open sessions and adds the NOT VALID check that refuses null afterwards; closed sessions keep null for ever.
--   * public.uscita_call: the append-only record of a call ("Via la n"). One row per (tenant, session, uscita), uscita 2..9; causes 'call',
--     'fire_now' (a fire without hold: every op of an old bundle), 'migration' (M5). RLS owner/admin, select only, no write grant: rows are
--     written only by definer procedures (M3, M5). Only the ADR-018 demo purge may delete (app.append_only honours it).
--   * app.order_line_guard re-created from 20261130100000 verbatim plus: uscita changes freely on a draft; on a sent line it may only go
--     from null to a value, with nothing else changing (the M5 backfill), never from one value to another.
--   * app.demo_purge_tables re-created from 20261206210200 with 'uscita_call' right before 'kitchen_event' (62 names).
--   * Helpers, closed to every API role: app.uscita_default, app.order_uscita, app.held_lines, app.line_held (the held rule of plan 3.1:
--     fired, not voided, uscita >= 2, and no call row for that uscita).

alter table public.order_line add column uscita smallint;
alter table public.order_line add constraint order_line_uscita_ck check (uscita between 0 and 9);
-- The held lookup of the call, the close guard and the board: sent, live lines of a later uscita.
create index order_line_uscita_held_idx on public.order_line (tenant_id, table_session_id, uscita)
  where uscita >= 2 and fired_at is not null and voided_at is null;

create table public.uscita_call (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  table_session_id uuid not null,
  uscita smallint not null,
  called_at timestamptz not null,
  called_by uuid not null,
  cause text not null,
  created_at timestamptz not null default now(),
  constraint uscita_call_uscita_ck check (uscita between 2 and 9),
  constraint uscita_call_cause_ck check (cause in ('call', 'fire_now', 'migration')),
  constraint uscita_call_once_uq unique (tenant_id, table_session_id, uscita),
  constraint uscita_call_session_fkey foreign key (tenant_id, table_session_id) references public.table_session (tenant_id, id),
  constraint uscita_call_called_by_fkey foreign key (tenant_id, called_by) references public.app_user (tenant_id, id)
);

comment on table public.uscita_call is
  'Comanda per uscita: one row per called uscita (2..9) of a table session. A sent line of uscita >= 2 is held until its row exists. Append-only; written only by definer procedures.';

create trigger uscita_call_append_only before update or delete on public.uscita_call
  for each row execute function app.append_only();
create trigger uscita_call_no_truncate before truncate on public.uscita_call
  for each statement execute function app.append_only_truncate();

alter table public.uscita_call enable row level security;
-- service_role reads (integration tests); nobody writes through a table grant. Waiters and the chef read calls through the definer reads.
revoke all on public.uscita_call from anon, authenticated, service_role;
grant select on public.uscita_call to authenticated, service_role;
create policy uscita_call_select on public.uscita_call for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.order_line_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- Comanda per uscita (M1): the one sanctioned change of a sent or voided line. uscita may go from null to a value, with every other
  -- column unchanged; M5 uses it once to place the lines of open sessions (plan 3.8). Never from a value to another or back to null.
  -- The generated column state is null in NEW inside a BEFORE trigger, so it is left out of the comparison (it follows the others).
  if old.uscita is null and new.uscita is not null
     and (to_jsonb(new) - 'uscita' - 'state') = (to_jsonb(old) - 'uscita' - 'state') then
    return new;
  end if;
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
       or new.client_updated_at is distinct from old.client_updated_at
       or new.uscita is distinct from old.uscita then
      raise exception 'order_line_fired' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.order_line_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.demo_purge_tables() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array[
    -- alerts and audit
    'alert', 'audit_event',
    -- staff meals and batches
    'staff_meal_confirmation', 'staff_meal_rule', 'batch_cost', 'batch_movement', 'batch_input', 'batch',
    -- counts and stock
    'count_line', 'count_session', 'stock_movement', 'raw_lot',
    -- opening stock: the draft and the operations (they point at locations, ingredients and users only)
    'opening_draft_line', 'stock_opening',
    -- prices, payables and invoices (P2-7: the VAT summary rows of an XML invoice point at it, so they go right before it)
    'price_history', 'payable', 'invoice_duplicate_decision', 'invoice_line', 'invoice_vat_summary', 'invoice',
    -- cost settings
    'ingredient_cost_basis', 'fixed_cost_period',
    -- M17/M18/M19/M20 tables and menu: the record of the offline operations first (it points at the users only), the frozen cost of a
    -- sent line and the order lines before the sessions and menu items they point at (the cost row also points at a recipe),
    -- sessions before tables, prices before items, items before the recipe keys; comanda per uscita: the calls (they point at the
    -- sessions and the users only) right before the kitchen events
    'applied_op', 'uscita_call', 'kitchen_event', 'order_line_cost', 'order_line',
    -- reservations: the e-mail outbox, the ledger, the assignments and the contact before the reservation; all before the sessions, tables and groups they point at
    'reservation_email', 'reservation_event', 'reservation_table', 'reservation_contact', 'reservation',
    'service_override', 'table_session',
    -- reservations: group members, groups and bookable flags before the tables they point at
    'table_group_member', 'table_group', 'dining_table_booking',
    'dining_table', 'sale_settings', 'menu_push', 'menu_item_price', 'menu_item',
    -- recipes
    'recipe_price', 'recipe_line', 'recipe', 'recipe_key',
    -- master data
    'supplier_item', 'supplier', 'ingredient', 'location', 'cost_centre',
    -- staff login; venue_device and device_enrolment reference each other (deleted together)
    'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment',
    -- M21: the register entries of the end of the day (they point at the users only)
    'day_close',
    -- M22: the frozen daily sales facts (tenant only) and the weekly dashboard opens (they point at the users)
    'daily_kpi', 'dashboard_open',
    -- M25c: the saved service periods (they point at the users only); reservations: the settings (the users only)
    'service_schedule', 'reservation_settings',
    -- last: the demo users. 'tenant' is listed because it carries a tenant_id (pgTAP 194), but the reset never deletes it
    'app_user', 'tenant'
  ]::text[]
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The default uscita of a new line: drinks go at once (0, "Subito"), everything else with the first course (1).
create function app.uscita_default(p_course public.course) returns smallint
  language sql immutable
  set search_path = ''
as $$
  select (case when p_course = 'bevande' then 0 else 1 end)::smallint
$$;

-- An uscita from a request body: a JSON integer from 0 to 9, else 22023 invalid_request.
create function app.order_uscita(p_val jsonb) returns smallint
  language plpgsql immutable
  set search_path = ''
as $$
declare
  v numeric;
begin
  if p_val is null or jsonb_typeof(p_val) <> 'number' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v := (p_val #>> '{}')::numeric;
  if v <> trunc(v) or v < 0 or v > 9 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return v::smallint;
end
$$;

-- The held lines of one uscita of one session, by id: sent, not voided, uscita >= 2, and that uscita not called yet (plan 3.1).
create function app.held_lines(p_tenant uuid, p_session uuid, p_uscita smallint) returns setof uuid
  language sql stable
  set search_path = ''
as $$
  select l.id
  from public.order_line l
  where l.tenant_id = p_tenant and l.table_session_id = p_session and l.uscita = p_uscita and p_uscita >= 2
    and l.fired_at is not null and l.voided_at is null
    and not exists (select 1 from public.uscita_call c
                    where c.tenant_id = p_tenant and c.table_session_id = p_session and c.uscita = p_uscita)
  order by l.id
$$;

-- The same rule for one line.
create function app.line_held(p_tenant uuid, p_line public.order_line) returns boolean
  language sql stable
  set search_path = ''
as $$
  select p_line.tenant_id = p_tenant and p_line.fired_at is not null and p_line.voided_at is null and coalesce(p_line.uscita, 0) >= 2
    and not exists (select 1 from public.uscita_call c
                    where c.tenant_id = p_tenant and c.table_session_id = p_line.table_session_id and c.uscita = p_line.uscita)
$$;

revoke all on function app.uscita_default(public.course), app.order_uscita(jsonb), app.held_lines(uuid, uuid, smallint),
  app.line_held(uuid, public.order_line) from public, anon, authenticated, service_role;
