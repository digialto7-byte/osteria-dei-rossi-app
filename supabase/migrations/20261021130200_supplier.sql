-- M1: suppliers and supplier items (plan §3.5.1, PRD 2.1 pack conversions on the supplier item).
-- Same pattern as location/ingredient. supplier_item holds a price (last_price), so it is a cost
-- table: owner/admin only (plan §3.11.2).

create table public.supplier (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  name text not null check (length(btrim(name)) between 1 and 200),
  -- Optional: some suppliers have none on file. Normalised (upper case, no spaces) by the API.
  vat_number text constraint supplier_vat_number_ck check (app.is_valid_it_vat(vat_number)),
  payment_terms_days smallint check (payment_terms_days between 0 and 365),
  -- Reorder settings: created in M1, edited from M16. Weekdays are ISO (1 = Monday).
  lead_time_days smallint check (lead_time_days between 0 and 365),
  delivery_weekdays smallint[] not null default '{}'
    check (delivery_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  order_cutoff_time time,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default app.app_user_id() references public.app_user (id),
  constraint supplier_tenant_id_id_uq unique (tenant_id, id),
  constraint supplier_tenant_vat_uq unique (tenant_id, vat_number)
);

create table public.supplier_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  supplier_id uuid not null,
  ingredient_id uuid not null,
  supplier_code text check (length(btrim(supplier_code)) between 1 and 64),
  -- SHA-256 of the normalised invoice description, used by invoice auto-mapping (M4).
  description_hash text check (description_hash ~ '^[0-9a-f]{64}$'),
  -- One purchase pack: pack_count × pack_qty pack_unit, e.g. a "cassa" of 6 × 1 kg.
  pack_count numeric(12, 4) not null default 1 check (pack_count > 0),
  pack_qty numeric(12, 4) not null check (pack_qty > 0),
  pack_unit public.measure_unit not null,
  pack_label text check (length(pack_label) <= 30),
  -- Written only by invoice approval (M5); no API role has a column grant on it.
  last_price numeric(12, 4),
  is_preferred boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default app.app_user_id() references public.app_user (id),
  constraint supplier_item_tenant_id_id_uq unique (tenant_id, id),
  constraint supplier_item_key_ck check (supplier_code is not null or description_hash is not null),
  -- Composite keys: a tenant's item can only point at the same tenant's supplier and ingredient.
  constraint supplier_item_supplier_fk foreign key (tenant_id, supplier_id)
    references public.supplier (tenant_id, id),
  constraint supplier_item_ingredient_fk foreign key (tenant_id, ingredient_id)
    references public.ingredient (tenant_id, id),
  constraint supplier_item_code_uq unique (tenant_id, supplier_id, supplier_code),
  constraint supplier_item_hash_uq unique (tenant_id, supplier_id, description_hash)
);
create unique index supplier_item_preferred_uq on public.supplier_item (tenant_id, ingredient_id)
  where is_preferred and is_active;
create index supplier_item_ingredient_idx on public.supplier_item (tenant_id, ingredient_id);

-- The pack must be measured like the ingredient (a kg pack cannot feed an ingredient counted in
-- pieces). The API checks first with a friendly 422; this is the backstop for every writer.
create function app.supplier_item_units_ck() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  ingredient_unit public.base_unit;
begin
  select i.base_unit into ingredient_unit
    from public.ingredient i
   where i.tenant_id = new.tenant_id and i.id = new.ingredient_id;
  -- Not found: the foreign key reports it (23503) after this trigger.
  if found and app.unit_dimension(new.pack_unit)
               <> app.unit_dimension(ingredient_unit::text::public.measure_unit) then
    raise exception 'incompatible_units' using errcode = '22023';
  end if;
  return new;
end
$$;

create trigger supplier_item_units_ck
  before insert or update of pack_unit, ingredient_id on public.supplier_item
  for each row execute function app.supplier_item_units_ck();

alter table public.supplier enable row level security;
alter table public.supplier_item enable row level security;

revoke all on public.supplier, public.supplier_item from anon, authenticated;
revoke delete, truncate on public.supplier, public.supplier_item from service_role;

grant select,
  insert (name, vat_number, payment_terms_days, lead_time_days, delivery_weekdays, order_cutoff_time),
  update (name, vat_number, payment_terms_days, lead_time_days, delivery_weekdays, order_cutoff_time,
          is_active)
  on public.supplier to authenticated;
grant select,
  insert (supplier_id, ingredient_id, supplier_code, description_hash, pack_count, pack_qty, pack_unit,
          pack_label, is_preferred),
  update (ingredient_id, supplier_code, description_hash, pack_count, pack_qty, pack_unit, pack_label,
          is_preferred, is_active)
  on public.supplier_item to authenticated;

create policy supplier_select on public.supplier
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
create policy supplier_insert on public.supplier
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy supplier_update on public.supplier
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'))
  with check (tenant_id = (select app.tenant_id()));

create policy supplier_item_select on public.supplier_item
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy supplier_item_insert on public.supplier_item
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy supplier_item_update on public.supplier_item
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'))
  with check (tenant_id = (select app.tenant_id()));

-- Makes one item the ingredient's preferred source, in one transaction. SECURITY INVOKER: the
-- caller's RLS applies, so an item they cannot see is "not found".
create function public.set_preferred_supplier_item(item_id uuid) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  target_ingredient uuid;
begin
  select i.ingredient_id into target_ingredient
    from public.supplier_item i
   where i.id = item_id and i.is_active;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.supplier_item
     set is_preferred = false
   where ingredient_id = target_ingredient and is_preferred and id <> item_id;
  update public.supplier_item set is_preferred = true where id = item_id;
end
$$;

revoke all on function public.set_preferred_supplier_item(uuid) from public, anon;
grant execute on function public.set_preferred_supplier_item(uuid) to authenticated;
revoke all on function app.supplier_item_units_ck() from public, anon;
