-- M14 step 2: the batch helpers (M14 plan §3.1.4, §3.1.5, §3.1.7, §3.1.8, §3.1.12, §3.2; ADR-013).
-- The lot recipe code, the use-by in elapsed hours, the use-by state, the portions rule, the operator initials and
-- the requirement expansion shared by the proposal and the validation. Everything is in schema app and closed to
-- every API role: the public procedures of the next migrations are the only way in.

-- The recipe part of the lot code: Italian accents folded, upper case, letters and digits only, the first 6
-- characters; nothing left -> RIC. "Spezzatino (demo)" -> SPEZZA (Q41 default).
create function app.lot_recipe_code(p_name text) returns text
  language sql immutable
  set search_path = ''
as $$
  select coalesce(
    nullif(left(regexp_replace(upper(translate(p_name, 'àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ', 'aaeeiioouuAAEEIIOOUU')),
                               '[^A-Z0-9]', '', 'g'), 6), ''),
    'RIC')
$$;

-- Use-by = produced at + the shelf life in ELAPSED hours (Q40 default). make_interval(hours => n) has no days
-- field, so the result does not depend on the session time zone; "+ interval 'n days'" adds calendar days in
-- the session zone and moves by an hour across a clock change (plan T1, proved by 121).
create function app.batch_use_by(p_produced_at timestamptz, p_hours integer) returns timestamptz
  language sql immutable
  set search_path = ''
as $$
  select p_produced_at + make_interval(hours => p_hours)
$$;

-- The use-by state shown on the screens, computed here so React never compares dates: expired when use_by is
-- not after now, due_soon within 24 hours (PRD 2.4), else ok.
create function app.use_by_state(p_use_by timestamptz, p_now timestamptz) returns text
  language sql immutable
  set search_path = ''
as $$
  select case
    when p_use_by <= p_now then 'expired'
    when p_use_by <= p_now + make_interval(hours => 24) then 'due_soon'
    else 'ok'
  end
$$;

-- Portions of an actual output, rounded down to a whole portion (project Q19 default). Numerics throughout,
-- never through a rounded portion size.
create function app.batch_portions(p_output numeric, p_recipe_output numeric, p_ppb integer) returns integer
  language sql immutable
  set search_path = ''
as $$
  select floor(p_output * p_ppb / p_recipe_output)::integer
$$;

-- The first letter of up to three words, upper case; '?' when there is none.
create function app.initials(p_name text) returns text
  language sql immutable
  set search_path = ''
as $$
  select coalesce(nullif(
    (select string_agg(upper(left(w.word, 1)), '' order by w.ord)
       from regexp_split_to_table(btrim(coalesce(p_name, '')), '\s+') with ordinality w (word, ord)
      where w.ord <= 3 and w.word <> ''), ''), '?')
$$;

-- The raw ingredients of ONE batch of a recipe version, in the ingredient's base unit, unrounded (M7: qty is
-- net, raw = qty / yield). A sub-recipe contributes its requirements scaled by (line qty / yield) / sub output,
-- with the sub's version in force at p_at. No path is enumerated (the M7/M8 lesson on diamond graphs): each round
-- holds one row per sub-recipe key with the summed factor of every path of that length, adds its ingredient
-- lines and expands it one level. The batch is depth 1, so a sub first reached at depth 13 is deeper than the
-- guard of 12 allows and fails closed (graph_too_deep), as does a loop.
create function app.batch_requirements(p_tenant uuid, p_recipe_id uuid, p_at timestamptz)
  returns table (ingredient_id uuid, qty_per_batch numeric)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_key uuid;
  v_rows jsonb;
  v_acc jsonb := '{}';
  v_add jsonb;
  v_front jsonb;
  v_missing boolean;
  v_depth integer := 1;
begin
  select r.recipe_key into v_key
    from public.recipe r where r.tenant_id = p_tenant and r.id = p_recipe_id;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0002';
  end if;
  v_rows := jsonb_build_array(jsonb_build_object('f', 1, 'rid', p_recipe_id));
  loop
    -- The ingredient lines of every row of this round, weighted by the row's factor.
    select coalesce(jsonb_object_agg(x.ing, x.q), '{}'::jsonb) into v_add
      from (select l.ingredient_id::text as ing,
                   sum((e.value ->> 'f')::numeric * l.qty * app.recipe_unit_factor(l.unit) / l.yield_factor) as q
              from jsonb_array_elements(v_rows) e
              join public.recipe_line l
                on l.tenant_id = p_tenant and l.recipe_id = (e.value ->> 'rid')::uuid
               and l.ingredient_id is not null
             group by l.ingredient_id) x;
    select coalesce(jsonb_object_agg(u.k, u.q), '{}'::jsonb) into v_acc
      from (select s.key as k, sum(s.value::numeric) as q
              from (select * from jsonb_each_text(v_acc) union all select * from jsonb_each_text(v_add)) s
             group by s.key) u;

    -- The next round: the sub-recipe lines, one row per key with the summed factor and the version in force.
    select coalesce(jsonb_agg(jsonb_build_object('f', x.f, 'rid', x.rid)), '[]'::jsonb), coalesce(bool_or(x.rid is null), false)
      into v_front, v_missing
      from (select l.sub_recipe_key,
                   sum((e.value ->> 'f')::numeric * l.qty * app.recipe_unit_factor(l.unit) / l.yield_factor
                       / so.output_qty) as f,
                   app.recipe_in_force(p_tenant, l.sub_recipe_key, p_at) as rid
              from jsonb_array_elements(v_rows) e
              join public.recipe_line l
                on l.tenant_id = p_tenant and l.recipe_id = (e.value ->> 'rid')::uuid
               and l.sub_recipe_key is not null
              left join public.recipe so
                on so.tenant_id = p_tenant and so.id = app.recipe_in_force(p_tenant, l.sub_recipe_key, p_at)
             group by l.sub_recipe_key) x;
    exit when jsonb_array_length(v_front) = 0;
    if v_missing then
      raise exception 'recipe_not_producible' using errcode = 'P0001', detail = 'sub_not_in_force';
    end if;
    v_depth := v_depth + 1;
    if v_depth > 12 then
      raise exception 'recipe_not_producible' using errcode = 'P0001', detail = 'graph_too_deep';
    end if;
    v_rows := v_front;
  end loop;

  return query
  select a.key::uuid, a.value::numeric
    from jsonb_each_text(v_acc) a
   order by a.key;
end
$$;

revoke all on function
  app.lot_recipe_code(text), app.batch_use_by(timestamptz, integer), app.use_by_state(timestamptz, timestamptz),
  app.batch_portions(numeric, numeric, integer), app.initials(text),
  app.batch_requirements(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
