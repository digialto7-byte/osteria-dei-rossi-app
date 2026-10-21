-- M1: idempotent master-data import (plan §5a.1 M1). One call is one transaction: any bad row
-- rolls the whole import back. Rows are validated by the API first (src/server/master/import.ts);
-- the table constraints stay the backstop. SECURITY INVOKER, so the caller's RLS applies.
-- Each row carries "row" (its line in the file) for error details.

create function app.require_master_writer() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin') then
    raise exception 'permission denied: import needs owner or admin' using errcode = '42501';
  end if;
end
$$;

create function public.import_suppliers(rows jsonb) returns jsonb
  language plpgsql
  set search_path = ''
as $$
declare
  r jsonb;
  incoming_name text;
  incoming_vat text;
  incoming_terms smallint;
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
          or existing.payment_terms_days is distinct from incoming_terms then
      update public.supplier
         set name = case when incoming_vat is not null then incoming_name else name end,
             payment_terms_days = incoming_terms
       where id = existing.id;
      updated := updated + 1;
    else
      unchanged := unchanged + 1;
    end if;
  end loop;
  return jsonb_build_object('created', created, 'updated', updated, 'unchanged', unchanged);
end
$$;

create function public.import_ingredients(rows jsonb) returns jsonb
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
    incoming_allergens := coalesce(
      (select array_agg(distinct value::public.allergen order by value::public.allergen)
         from jsonb_array_elements_text(coalesce(r -> 'allergens', '[]'::jsonb))),
      '{}');
    incoming_shelf_life := (r ->> 'default_shelf_life_days')::smallint;

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
    elsif existing.category is distinct from incoming_category
          or existing.is_stock is distinct from incoming_stock
          -- Allergens are a set: compare membership, not order.
          or not (existing.allergens @> incoming_allergens and existing.allergens <@ incoming_allergens)
          or existing.default_shelf_life_days is distinct from incoming_shelf_life then
      update public.ingredient
         set category = incoming_category,
             is_stock = incoming_stock,
             allergens = incoming_allergens,
             default_shelf_life_days = incoming_shelf_life
       where id = existing.id;
      updated := updated + 1;
    else
      unchanged := unchanged + 1;
    end if;
  end loop;
  return jsonb_build_object('created', created, 'updated', updated, 'unchanged', unchanged);
end
$$;

revoke all on function app.require_master_writer(), public.import_suppliers(jsonb),
  public.import_ingredients(jsonb) from public, anon;
grant execute on function app.require_master_writer(), public.import_suppliers(jsonb),
  public.import_ingredients(jsonb) to authenticated;
