-- M1 follow-up, founder decision Q5: re-importing a partial sheet must not wipe stored values.
-- An optional key that is absent from a row keeps the stored value (a new row gets the column
-- default); present, it sets the value, JSON null meaning "clear". The API leaves blank cells out
-- and sends null for the "-" mark (src/server/master/import.ts). Everything else is as in
-- 20261021130300_master_import.sql: one call is one transaction, SECURITY INVOKER, owner/admin.

create or replace function public.import_suppliers(rows jsonb) returns jsonb
  language plpgsql
  set search_path = ''
as $$
declare
  r jsonb;
  incoming_name text;
  incoming_vat text;
  incoming_terms smallint;
  has_terms boolean;
  existing public.supplier%rowtype;
  matches int;
  created int := 0;
  updated int := 0;
  unchanged int := 0;
begin
  perform app.require_master_writer();
  for r in select value from jsonb_array_elements(rows) loop
    incoming_name := btrim(r ->> 'name');
    incoming_vat := r ->> 'vat_number';
    incoming_terms := (r ->> 'payment_terms_days')::smallint;
    has_terms := r ? 'payment_terms_days';

    -- The VAT number identifies a supplier; without one, the normalised name does.
    if incoming_vat is not null then
      select * into existing from public.supplier s where s.vat_number = incoming_vat;
      matches := case when found then 1 else 0 end;
    else
      select count(*) into matches from public.supplier s
       where s.vat_number is null and app.normalise_name(s.name) = app.normalise_name(incoming_name);
      if matches > 1 then
        raise exception 'ambiguous_match' using errcode = 'P0001', detail = r ->> 'row';
      end if;
      select * into existing from public.supplier s
       where s.vat_number is null and app.normalise_name(s.name) = app.normalise_name(incoming_name);
    end if;

    if matches = 0 then
      insert into public.supplier (name, vat_number, payment_terms_days)
        values (incoming_name, incoming_vat, incoming_terms);
      created := created + 1;
    elsif (incoming_vat is not null and existing.name is distinct from incoming_name)
          or (has_terms and existing.payment_terms_days is distinct from incoming_terms) then
      update public.supplier
         set name = case when incoming_vat is not null then incoming_name else name end,
             payment_terms_days = case when has_terms then incoming_terms else payment_terms_days end
       where id = existing.id;
      updated := updated + 1;
    else
      unchanged := unchanged + 1;
    end if;
  end loop;
  return jsonb_build_object('created', created, 'updated', updated, 'unchanged', unchanged);
end
$$;

create or replace function public.import_ingredients(rows jsonb) returns jsonb
  language plpgsql
  set search_path = ''
as $$
declare
  r jsonb;
  incoming_name text;
  incoming_unit public.base_unit;
  incoming_category text;
  incoming_stock boolean;
  incoming_allergens public.allergen[];
  incoming_shelf_life smallint;
  has_category boolean;
  has_stock boolean;
  has_allergens boolean;
  has_shelf_life boolean;
  existing public.ingredient%rowtype;
  created int := 0;
  updated int := 0;
  unchanged int := 0;
begin
  perform app.require_master_writer();
  for r in select value from jsonb_array_elements(rows) loop
    incoming_name := btrim(r ->> 'name');
    incoming_unit := (r ->> 'base_unit')::public.base_unit;
    incoming_category := r ->> 'category';
    incoming_stock := coalesce((r ->> 'is_stock')::boolean, true);
    -- JSON null and [] both mean "no allergens"; any other non-array value raises an error.
    incoming_allergens := coalesce(
      (select array_agg(distinct value::public.allergen order by value::public.allergen)
         from jsonb_array_elements_text(
           coalesce(nullif(r -> 'allergens', 'null'::jsonb), '[]'::jsonb))),
      '{}');
    incoming_shelf_life := (r ->> 'default_shelf_life_days')::smallint;
    has_category := r ? 'category';
    has_stock := r ? 'is_stock';
    has_allergens := r ? 'allergens';
    has_shelf_life := r ? 'default_shelf_life_days';

    select * into existing from public.ingredient i
     where app.normalise_name(i.name) = app.normalise_name(incoming_name);

    if not found then
      insert into public.ingredient (name, base_unit, category, is_stock, allergens, default_shelf_life_days)
        values (incoming_name, incoming_unit, incoming_category, incoming_stock, incoming_allergens,
                incoming_shelf_life);
      created := created + 1;
    elsif existing.base_unit <> incoming_unit then
      -- The base unit is fixed: changing it would corrupt the ledgers (see ingredient grants).
      raise exception 'base_unit_conflict' using errcode = 'P0001', detail = r ->> 'row';
    elsif (has_category and existing.category is distinct from incoming_category)
          or (has_stock and existing.is_stock is distinct from incoming_stock)
          -- Allergens are a set: compare membership, not order.
          or (has_allergens and not (existing.allergens @> incoming_allergens
                                     and existing.allergens <@ incoming_allergens))
          or (has_shelf_life and existing.default_shelf_life_days is distinct from incoming_shelf_life) then
      update public.ingredient
         set category = case when has_category then incoming_category else category end,
             is_stock = case when has_stock then incoming_stock else is_stock end,
             allergens = case when has_allergens then incoming_allergens else allergens end,
             default_shelf_life_days =
               case when has_shelf_life then incoming_shelf_life else default_shelf_life_days end
       where id = existing.id;
      updated := updated + 1;
    else
      unchanged := unchanged + 1;
    end if;
  end loop;
  return jsonb_build_object('created', created, 'updated', updated, 'unchanged', unchanged);
end
$$;
