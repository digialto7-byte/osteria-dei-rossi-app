-- Founder decision A5 (docs/plans/2026-11-02-a5-business-date-discards.md): batch movements count on the BUSINESS day (cut-off from tenant settings, 02:00 by default), not on the calendar day.
-- Option (b): the readers derive the business day from created_at, so rows already stored with the calendar effective_on are counted like new ones, with no UPDATE of the ledger.
--   app.movement_business_date(t, created_at)  the business day of a ledger row (= app.business_date; the one name readers use for it)
--   app.business_day_start(t, D)               the instant business day D begins = app.kpi_cutoff_end(t, D - 1); the day D is [business_day_start(D), kpi_cutoff_end(D)). DST-safe (M11 helpers)
--   batch_movement_created_idx                 (tenant_id, created_at): the range scan of the two readers
--   public.waste_costs                         batch side (lines and unvaluedCount) filtered by that range; raw side unchanged (raw stock stays calendar-dated, see the plan)
--   app.discards_vs_push_json                  the ISO week as the same range
-- Writers are unchanged: effective_on stays the venue's calendar date of the write. Offline consume replays carry the client time in effective_on but the replay time in created_at; no
-- reader dates consume rows, and a future one must not use created_at for them.

create function app.movement_business_date(p_tenant uuid, p_created_at timestamptz) returns date
  language sql
  stable
  security definer
  set search_path = ''
as $$ select app.business_date(p_tenant, p_created_at) $$;

create function app.business_day_start(p_tenant uuid, p_date date) returns timestamptz
  language sql
  stable
  security definer
  set search_path = ''
as $$ select app.kpi_cutoff_end(p_tenant, p_date - 1) $$;

revoke all on function app.movement_business_date(uuid, timestamptz), app.business_day_start(uuid, date)
  from public, anon, authenticated, service_role;

create index batch_movement_created_idx on public.batch_movement (tenant_id, created_at);

comment on column public.batch_movement.effective_on is
  'Calendar date (venue time zone) of the write. Reports count by business day through created_at (app.movement_business_date, app.business_day_start); do not group by this column.';

create or replace function public.waste_costs(p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_raw jsonb;
  v_lo timestamptz;
  v_hi timestamptz;
  v_result jsonb;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  -- The range rules (range_invalid, range_too_long) are the raw report's.
  v_raw := public.raw_waste_costs(p_from, p_to);
  -- A5: the batch side counts on the business day of created_at: [start of p_from's business day, end of p_to's).
  v_lo := app.business_day_start(v_tenant, p_from);
  v_hi := app.kpi_cutoff_end(v_tenant, p_to);

  with raw as (
    select e.value ->> 'reasonCode' as reason_code, (e.value ->> 'valueEur')::numeric as value_eur,
           e.value -> 'lines' as lines
      from jsonb_array_elements(v_raw -> 'reasons') e
  ),
  bl as (
    -- Per (reason, recipe) line. The value is the sum of the valued (complete-cost) movements only: a batch with an
    -- incomplete cost adds its portions and one unvalued operation to the line, and takes nothing from the rest. The
    -- value is null only when no movement of the line is valued.
    select m.reason_code, k.id as recipe_key, rv.name as recipe_name, sum(-m.portions) as portions,
           round(sum(-m.portions * c.unit_cost_frozen) filter (where c.unit_cost_frozen is not null), 4) as value_eur,
           count(distinct (m.ref_type, m.ref_id)) filter (where c.unit_cost_frozen is null) as unvalued_count
      from public.batch_movement m
      join public.batch b on b.tenant_id = m.tenant_id and b.id = m.batch_id
      join public.recipe_key k on k.tenant_id = b.tenant_id and k.id = b.recipe_key
      join public.recipe rv on rv.tenant_id = k.tenant_id and rv.recipe_key = k.id and rv.version = k.current_version
      left join public.batch_cost c on c.tenant_id = b.tenant_id and c.batch_id = b.id
     where m.tenant_id = v_tenant and m.type::text = 'waste' and m.created_at >= v_lo and m.created_at < v_hi
     group by m.reason_code, k.id, rv.name
    having sum(-m.portions) <> 0
  ),
  codes as (
    select r.reason_code from raw r union select b.reason_code from bl b
  ),
  per as (
    select c.reason_code,
           coalesce((select r.value_eur from raw r where r.reason_code = c.reason_code), 0) as raw_value,
           coalesce((select sum(b.value_eur) from bl b where b.reason_code = c.reason_code), 0) as batch_value,
           coalesce((select r.lines from raw r where r.reason_code = c.reason_code), '[]'::jsonb) as lines,
           coalesce((select jsonb_agg(jsonb_build_object('recipeKey', b.recipe_key, 'recipeName', b.recipe_name,
                                        'portions', round(b.portions, 4), 'valueEur', b.value_eur,
                                        'unvaluedCount', b.unvalued_count)
                                      order by b.recipe_name collate "C", b.recipe_key)
                       from bl b where b.reason_code = c.reason_code), '[]'::jsonb) as batch_lines
      from codes c
  )
  select jsonb_build_object(
           'from', p_from, 'to', p_to,
           'valueEur', round((v_raw ->> 'valueEur')::numeric + coalesce((select sum(b.value_eur) from bl b), 0), 4),
           'rawValueEur', round((v_raw ->> 'valueEur')::numeric, 4),
           'batchValueEur', round(coalesce((select sum(b.value_eur) from bl b), 0), 4),
           'unvaluedCount', (v_raw ->> 'unvaluedCount')::integer + (
             select count(distinct (u.ref_type, u.ref_id))
               from public.batch_movement u
               left join public.batch_cost c on c.tenant_id = u.tenant_id and c.batch_id = u.batch_id
              where u.tenant_id = v_tenant and u.type::text = 'waste' and u.created_at >= v_lo and u.created_at < v_hi
                and c.unit_cost_frozen is null),
           'reasons', coalesce((select jsonb_agg(jsonb_build_object(
                                  'reasonCode', p.reason_code,
                                  'valueEur', round(p.raw_value + p.batch_value, 4),
                                  'rawValueEur', round(p.raw_value, 4),
                                  'batchValueEur', round(p.batch_value, 4),
                                  'lines', p.lines, 'batchLines', p.batch_lines)
                                order by p.raw_value + p.batch_value desc, p.reason_code collate "C")
                                 from per p), '[]'::jsonb))
    into v_result;
  return v_result;
end
$$;

create or replace function app.discards_vs_push_json(p_tenant uuid, p_week date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.business_date(p_tenant, p_now);
  v_d date := coalesce(p_week, v_today);
  v_from date;
  v_to date;
  v_lo timestamptz;
  v_hi timestamptz;
  v_rows jsonb;
  v_totals jsonb;
begin
  if v_d > v_today then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  v_from := v_d - (extract(isodow from v_d)::integer - 1);
  v_to := v_from + 6;
  -- A5: the week is the business days v_from..v_to, as an instant range on created_at.
  v_lo := app.business_day_start(p_tenant, v_from);
  v_hi := app.kpi_cutoff_end(p_tenant, v_to);

  with d as (
    select m.batch_id, sum(-m.portions) as portions, min(m.created_at) as first_at
      from public.batch_movement m
     where m.tenant_id = p_tenant and m.type::text = 'waste' and m.ref_type = 'batch_discard'
       and m.reverses_id is null and m.created_at >= v_lo and m.created_at < v_hi
       -- Defensive: no code path reverses a batch_discard today (the discard has no reversal shape), so this branch never fires in production; pgTAP 252
       -- proves it with an invented shape.
       and not exists (select 1 from public.batch_movement x where x.tenant_id = p_tenant and x.reverses_id = m.id)
     group by m.batch_id
  ), b as (
    select d.batch_id, bt.recipe_key, bt.produced_at, d.first_at, d.portions, bc.unit_cost_frozen
      from d
      join public.batch bt on bt.tenant_id = p_tenant and bt.id = d.batch_id
      left join public.batch_cost bc on bc.tenant_id = bt.tenant_id and bc.batch_id = bt.id
  ), per as materialized (
    select * from app.menu_push_periods(p_tenant, (select min(b.produced_at) from b), (select max(b.first_at) from b))
  ), f as (
    select b.*, exists (select 1 from per p
                         where p.batch_keys @> array[b.recipe_key] and p.started_at < b.first_at and p.effective_end > b.produced_at) as pushed
      from b
  ), g as (
    select f.recipe_key, rv.name, rv.shelf_life_hours,
           count(*)::integer as batches, (count(*) filter (where f.pushed))::integer as batches_pushed,
           sum(f.portions) as portions, coalesce(sum(f.portions) filter (where f.pushed), 0) as portions_pushed,
           coalesce(sum(f.portions * f.unit_cost_frozen) filter (where f.unit_cost_frozen is not null), 0) as value_eur,
           (count(*) filter (where f.unit_cost_frozen is null))::integer as unvalued
      from f
      join public.recipe_key k on k.tenant_id = p_tenant and k.id = f.recipe_key
      join public.recipe rv on rv.tenant_id = k.tenant_id and rv.recipe_key = k.id and rv.version = k.current_version
     group by f.recipe_key, rv.name, rv.shelf_life_hours
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipeKey', g.recipe_key, 'name', g.name, 'shelfLifeHours', g.shelf_life_hours,
           'batchesDiscarded', g.batches, 'batchesPushed', g.batches_pushed,
           'portionsDiscarded', trim_scale(g.portions), 'portionsPushed', trim_scale(g.portions_pushed),
           'valueEur', round(g.value_eur, 4), 'unvaluedCount', g.unvalued)
         order by g.batches desc, g.portions desc, g.name collate "C", g.recipe_key), '[]'::jsonb),
         jsonb_build_object(
           'batchesDiscarded', coalesce(sum(g.batches), 0), 'batchesPushed', coalesce(sum(g.batches_pushed), 0),
           'portionsDiscarded', trim_scale(coalesce(sum(g.portions), 0)), 'portionsPushed', trim_scale(coalesce(sum(g.portions_pushed), 0)),
           'valueEur', round(coalesce(sum(g.value_eur), 0), 4), 'unvaluedCount', coalesce(sum(g.unvalued), 0))
    into v_rows, v_totals
    from g;
  return jsonb_build_object('weekFrom', v_from, 'weekTo', v_to, 'rows', v_rows, 'totals', v_totals);
end
$$;
