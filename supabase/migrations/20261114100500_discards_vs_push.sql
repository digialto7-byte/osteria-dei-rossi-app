-- M23 step 5 (docs/plans/2026-10-31-m23-push-forecast.md §3.1.5, §3.2; Q165-Q167; ADR-026): the weekly "discards vs push" report, per batch recipe, owner and admin only.
--
--   A discarded batch has at least one waste movement with ref_type 'batch_discard' dated (effective_on, as waste_costs) in the ISO week, not reversed; a void waste
--   (ref_type 'order_void') is not a discard. Its portions are the sum of those movements, its first discard the earliest created_at among them.
--   Pushed (Q167): a start of menu_push whose batch_keys contain the batch's recipe key and whose effective period [started_at, effective_end) overlaps
--   [batch.produced_at, the batch's first discard in the week) (app.menu_push_periods). Raw ingredients are not in this report (Q165).
--   Rows per batch recipe key: current name and shelf life (so the owner sees what to correct), batches and portions discarded, batches and portions of the pushed ones,
--   the value (portions x the batch's frozen unit cost, known costs only) and the number of discarded batches without a known cost. p_week is any date of the ISO week; null is
--   the week of p_now's business date; a later date is refused (P0001 date_in_future), as app.unmapped_items_json.

create function app.discards_vs_push_json(p_tenant uuid, p_week date, p_now timestamptz) returns jsonb
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
  v_rows jsonb;
  v_totals jsonb;
begin
  if v_d > v_today then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  v_from := v_d - (extract(isodow from v_d)::integer - 1);
  v_to := v_from + 6;

  with d as (
    select m.batch_id, sum(-m.portions) as portions, min(m.created_at) as first_at
      from public.batch_movement m
     where m.tenant_id = p_tenant and m.type::text = 'waste' and m.ref_type = 'batch_discard'
       and m.reverses_id is null and m.effective_on between v_from and v_to
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

create function public.discards_vs_push(p_week date default null) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.discards_vs_push_json(app.tenant_id(), p_week, clock_timestamp());
end
$$;

revoke all on function app.discards_vs_push_json(uuid, date, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.discards_vs_push(date) from public, anon, authenticated, service_role;
grant execute on function public.discards_vs_push(date) to authenticated;
