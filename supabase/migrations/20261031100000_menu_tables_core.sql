-- M17 step 1: the course type, the menu and table tables, their guards, RLS, privileges and the audit checks
-- (M17 plan §3.1, §3.2; ADR-016).
--
--   menu_item          one mutable row per dish; recipe_key null = "unmapped". No price column: the price and the VAT
--                      rate live in the append-only menu_item_price (the price in force is the newest row not after
--                      the instant asked). push_until/push_price are written by M23 only.
--   dining_table       the configured table names (entered by the owner, project Q5).
--   table_session      one open session per table (partial unique index); covers, the coperto frozen at opening, the
--                      bill-requested flag, the closing columns (written by M21's close_table, null in M17).
--   sale_settings      the coperto per person and its VAT rate; one row per tenant, absent = no coperto. It is NOT in
--                      tenant.settings, which every member (the chef too) reads (M8 rule, Q16 = project V6).
--
-- Nobody writes these tables directly: no INSERT/UPDATE/DELETE grant for any API role, the rows come from SECURITY
-- DEFINER procedures (steps 3, 5, 6). The only select policy names owner and admin; waiters read through definer
-- functions with fixed shapes (steps 4, 7), the chef reads none in M17. service_role gets select (lesson 2).

create type public.course as enum ('antipasti', 'primi', 'secondi', 'dolci', 'bevande');

create table public.menu_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  name text not null check (char_length(name) between 1 and 80 and btrim(name) <> ''),
  name_norm text generated always as (app.normalise_name(name)) stored,
  category text not null check (char_length(category) between 1 and 40 and btrim(category) <> ''),
  course_default public.course not null,
  recipe_key uuid,
  position integer not null default 0 check (position between 0 and 9999),
  is_available boolean not null default true,
  is_active boolean not null default true,
  push_until timestamptz,
  push_price numeric(12, 2) check (push_price >= 0 and push_price <= 10000),
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default app.app_user_id(),
  constraint menu_item_push_ck check (push_price is null or push_until is not null),
  constraint menu_item_tenant_id_id_uq unique (tenant_id, id),
  constraint menu_item_recipe_key_fkey foreign key (tenant_id, recipe_key)
    references public.recipe_key (tenant_id, id),
  constraint menu_item_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id),
  constraint menu_item_updated_by_fkey foreign key (tenant_id, updated_by)
    references public.app_user (tenant_id, id)
);
create unique index menu_item_name_uq on public.menu_item (tenant_id, name_norm) where is_active;
create unique index menu_item_recipe_uq on public.menu_item (tenant_id, recipe_key)
  where is_active and recipe_key is not null;

create table public.menu_item_price (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  menu_item_id uuid not null,
  -- VAT included (A1).
  price numeric(12, 2) not null check (price >= 0 and price <= 10000),
  vat_rate numeric(5, 2) not null check (vat_rate = any (app.allowed_vat_rates())),
  valid_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  constraint menu_item_price_item_fkey foreign key (tenant_id, menu_item_id)
    references public.menu_item (tenant_id, id),
  constraint menu_item_price_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id),
  constraint menu_item_price_valid_uq unique (tenant_id, menu_item_id, valid_from)
);
create index menu_item_price_idx on public.menu_item_price (tenant_id, menu_item_id, valid_from desc);

create table public.dining_table (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  name text not null check (char_length(name) between 1 and 40 and btrim(name) <> ''),
  name_norm text generated always as (app.normalise_name(name)) stored,
  position integer not null default 0 check (position between 0 and 9999),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default app.app_user_id(),
  constraint dining_table_tenant_id_id_uq unique (tenant_id, id),
  constraint dining_table_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id),
  constraint dining_table_updated_by_fkey foreign key (tenant_id, updated_by)
    references public.app_user (tenant_id, id)
);
create unique index dining_table_name_uq on public.dining_table (tenant_id, name_norm) where is_active;

create table public.sale_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  -- Per person, VAT included. Both set or both null (null = no coperto).
  coperto_amount numeric(12, 2) check (coperto_amount > 0 and coperto_amount <= 100),
  coperto_vat_rate numeric(5, 2) check (coperto_vat_rate = any (app.allowed_vat_rates())),
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default app.app_user_id(),
  constraint sale_settings_pair_ck check ((coperto_amount is null) = (coperto_vat_rate is null)),
  constraint sale_settings_tenant_uq unique (tenant_id),
  constraint sale_settings_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id),
  constraint sale_settings_updated_by_fkey foreign key (tenant_id, updated_by)
    references public.app_user (tenant_id, id)
);

create table public.table_session (
  -- Generated by the client (M20 offline queue); a replay of the same id is idempotent.
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  dining_table_id uuid not null,
  -- Snapshot of the table name at opening (tickets and bills keep it when the table is renamed).
  table_name text not null check (char_length(table_name) between 1 and 40),
  covers smallint not null check (covers between 1 and 99),
  opened_at timestamptz not null default now(),
  opened_by uuid not null default app.app_user_id(),
  business_date date not null,
  -- Frozen at opening from sale_settings; later settings changes never touch a session.
  coperto_amount numeric(12, 2) check (coperto_amount > 0 and coperto_amount <= 100),
  coperto_vat_rate numeric(5, 2) check (coperto_vat_rate = any (app.allowed_vat_rates())),
  coperto_total numeric(12, 2) generated always as (covers * coperto_amount) stored,
  bill_requested_at timestamptz,
  bill_requested_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default app.app_user_id(),
  constraint table_session_coperto_ck check ((coperto_amount is null) = (coperto_vat_rate is null)),
  constraint table_session_bill_ck check ((bill_requested_at is null) = (bill_requested_by is null)),
  constraint table_session_closed_ck check ((closed_at is null) = (closed_by is null)),
  constraint table_session_tenant_id_id_uq unique (tenant_id, id),
  constraint table_session_table_fkey foreign key (tenant_id, dining_table_id)
    references public.dining_table (tenant_id, id),
  constraint table_session_opened_by_fkey foreign key (tenant_id, opened_by)
    references public.app_user (tenant_id, id),
  constraint table_session_bill_by_fkey foreign key (tenant_id, bill_requested_by)
    references public.app_user (tenant_id, id),
  constraint table_session_closed_by_fkey foreign key (tenant_id, closed_by)
    references public.app_user (tenant_id, id),
  constraint table_session_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id),
  constraint table_session_updated_by_fkey foreign key (tenant_id, updated_by)
    references public.app_user (tenant_id, id)
);
-- One open session per table: the backstop of open_table's row lock.
create unique index table_session_open_uq on public.table_session (tenant_id, dining_table_id)
  where closed_at is null;
create index table_session_day_idx on public.table_session (tenant_id, business_date, dining_table_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- Guards. Identity and creation facts never change; a session's opening facts never change, and a closed session
-- is final. M21 replaces app.table_session_guard to allow its closing columns.
create function app.menu_item_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'menu_item_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create function app.dining_table_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'dining_table_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create function app.table_session_guard() returns trigger
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
     or new.closed_at is distinct from old.closed_at
     or new.closed_by is distinct from old.closed_by
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'table_session_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.menu_item_guard(), app.dining_table_guard(), app.table_session_guard()
  from public, anon, authenticated, service_role;

create trigger menu_item_guard before update on public.menu_item
  for each row execute function app.menu_item_guard();
create trigger dining_table_guard before update on public.dining_table
  for each row execute function app.dining_table_guard();
create trigger table_session_guard before update on public.table_session
  for each row execute function app.table_session_guard();

create trigger menu_item_price_append_only before update or delete on public.menu_item_price
  for each row execute function app.append_only();
create trigger menu_item_price_no_truncate before truncate on public.menu_item_price
  for each statement execute function app.append_only_truncate();
create trigger menu_item_append_only before delete on public.menu_item
  for each row execute function app.append_only();
create trigger menu_item_no_truncate before truncate on public.menu_item
  for each statement execute function app.append_only_truncate();
create trigger dining_table_append_only before delete on public.dining_table
  for each row execute function app.append_only();
create trigger dining_table_no_truncate before truncate on public.dining_table
  for each statement execute function app.append_only_truncate();
create trigger table_session_append_only before delete on public.table_session
  for each row execute function app.append_only();
create trigger table_session_no_truncate before truncate on public.table_session
  for each statement execute function app.append_only_truncate();
create trigger sale_settings_append_only before delete on public.sale_settings
  for each row execute function app.append_only();
create trigger sale_settings_no_truncate before truncate on public.sale_settings
  for each statement execute function app.append_only_truncate();

-- ---------------------------------------------------------------------------------------------------------------------
alter table public.menu_item enable row level security;
alter table public.menu_item_price enable row level security;
alter table public.dining_table enable row level security;
alter table public.table_session enable row level security;
alter table public.sale_settings enable row level security;

revoke all on public.menu_item, public.menu_item_price, public.dining_table, public.table_session,
  public.sale_settings from anon, authenticated, service_role;
-- service_role reads all five (lesson 2: pinned by pgTAP 150), no write grant for anyone.
grant select on public.menu_item, public.menu_item_price, public.dining_table, public.table_session,
  public.sale_settings to authenticated, service_role;

-- Prices and coperto are sale prices, not costs, but the waiter and the chef still read through definer functions with
-- fixed shapes (ADR-016): the only policies name owner and admin.
create policy menu_item_select on public.menu_item for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy menu_item_price_select on public.menu_item_price for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy dining_table_select on public.dining_table for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy table_session_select on public.table_session for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy sale_settings_select on public.sale_settings for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

-- ---------------------------------------------------------------------------------------------------------------------
-- The audit lists: every value of 20261030100000_rules_settings.sql (11 entity types, 26 actions) stays, M17's are
-- added. tests/config/check-constraint-union.test.ts keeps this honest.
alter table public.audit_event
  drop constraint audit_event_entity_type_check,
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_entity_type_check
    check (entity_type in ('invoice', 'ingredient', 'recipe', 'tenant', 'payable', 'app_user',
                           'venue_device', 'device_enrolment', 'count_session', 'staff_meal_rule', 'supplier',
                           'menu_item', 'dining_table', 'table_session', 'sale_settings')),
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed', 'payable.payment_reversed',
                      'app_user.created', 'app_user.updated', 'app_user.deactivated',
                      'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created',
                      'venue_device.enrolled', 'venue_device.revoked', 'venue_device.unlocked',
                      'count_session.closed', 'count_session.cancelled', 'ingredient.critical_changed',
                      'staff_meal_rule.created', 'staff_meal_rule.updated',
                      'ingredient.rules_changed', 'supplier.delivery_changed', 'recipe.rules_changed',
                      'menu_item.created', 'menu_item.updated', 'dining_table.created', 'dining_table.updated',
                      'table_session.covers_changed', 'sale_settings.changed'));
