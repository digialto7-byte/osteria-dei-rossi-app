-- M7 step 2: the ingredient import follows the allergen rule of M7 (plan §3.1.6).
-- allergens absent: a new row is "not stated" (null), an existing row keeps what it has (founder
-- decision Q5). JSON null is "not stated" (M1 cleared it to '{}', i.e. allergen-free, which is the
-- bug M7 removes); an array, [] included, is that sorted set ([] declares none). An import never
-- confirms; the guard trigger of 20261023100000 clears a confirmation when the list changes.
-- Everything else is as in 20261022090000_import_keep_blank.sql.

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
    -- JSON null (or an absent key) is "not stated"; an array is a set; any other value raises.
    incoming_allergens := case
      when jsonb_typeof(r -> 'allergens') is null or jsonb_typeof(r -> 'allergens') = 'null' then null
      else coalesce(
        (select array_agg(distinct value::public.allergen order by value::public.allergen)
           from jsonb_array_elements_text(r -> 'allergens')), '{}')
      end;
    incoming_shelf_life := (r ->> 'default_shelf_life_days')::smallint;
    has_category := r ? 'category';
    has_stock := r ? 'is_stock';
    has_allergens := r ? 'allergens';
    has_shelf_life := r ? 'default_shelf_life_days';

    select * into existing from public.ingredient i
     where app.normalise_name(i.name) = app.normalise_name(incoming_name);

    if not found then
      -- The column has no default any more: an absent key is stored as null (not stated).
      insert into public.ingredient (name, base_unit, category, is_stock, allergens, default_shelf_life_days)
        values (incoming_name, incoming_unit, incoming_category, incoming_stock, incoming_allergens,
                incoming_shelf_life);
      created := created + 1;
    elsif existing.base_unit <> incoming_unit then
      -- The base unit is fixed: changing it would corrupt the ledgers (see ingredient grants).
      raise exception 'base_unit_conflict' using errcode = 'P0001', detail = r ->> 'row';
    elsif (has_category and existing.category is distinct from incoming_category)
          or (has_stock and existing.is_stock is distinct from incoming_stock)
          -- Allergens are a set: compare as sets, null-safe (not stated is not the empty set).
          or (has_allergens and app.allergen_set(existing.allergens)
                                is distinct from incoming_allergens)
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
