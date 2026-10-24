-- M15 step 6: the reads of the batch actions (M15 plan §3.1.6, §3.2, §3.4; ADR-014; founder Q16 = project V6).
--   batch_detail      one batch with its history, split parts, defaults and what the user can do
--   batch_label       (create or replace) the M14 label keys plus portionsRemaining and splitFrom
--   staff_meal_rules  the rules with the business date, what is available and today's confirmation
-- Quantities only: no key of any answer is a value, a cost or a price, because the chef reads them. Each function is
-- SECURITY DEFINER with an empty search_path, checks the role FIRST (owner, admin or chef; the waiter gets 42501, not
-- an empty answer), takes the tenant from app.tenant_id(), joins names and initials in one round trip (the chef cannot
-- read app_user) and is executable by `authenticated` only. A foreign or unknown batch is P0002.

create function public.batch_detail(p_batch uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_me uuid;
  v_now timestamptz := now();
  v_out jsonb;
begin
  perform app.require_batch_reader();
  v_tenant := app.tenant_id();
  v_me := app.app_user_id();

  select jsonb_build_object(
           'batchId', b.id, 'lotCode', b.lot_code, 'recipeKey', b.recipe_key, 'recipeName', r.name,
           'version', b.recipe_version, 'producedAt', b.produced_at, 'useBy', b.use_by,
           'useByState', app.use_by_state(b.use_by, v_now), 'shelfLifeHours', b.shelf_life_hours,
           'outputQty', b.output_qty, 'outputUnit', b.output_unit,
           'portionsComputed', b.portions_computed, 'portionsInitial', b.portions_initial,
           'portionsRemaining', rem.v, 'state', b.state,
           'locationId', b.location_id, 'locationName', x.name,
           'byInitials', app.initials(u.display_name), 'byMe', b.produced_by = v_me,
           'createdByInitials', app.initials(cu.display_name), 'createdAt', b.created_at,
           'splitFrom', case when pb.id is null then null
                             else jsonb_build_object('batchId', pb.id, 'lotCode', pb.lot_code) end,
           'splits', (select coalesce(jsonb_agg(jsonb_build_object(
                               'batchId', c.id, 'lotCode', c.lot_code, 'portions', c.portions_initial,
                               'locationName', cl.name) order by c.created_at, c.id), '[]'::jsonb)
                        from public.batch c
                        join public.location cl on cl.tenant_id = c.tenant_id and cl.id = c.location_id
                       where c.tenant_id = b.tenant_id and c.split_from_batch_id = b.id),
           'movements', (select coalesce(jsonb_agg(m.item order by m.created_at desc, m.id desc), '[]'::jsonb)
                           from (select mv.id, mv.created_at,
                                        jsonb_build_object(
                                          'id', mv.id, 'type', mv.type, 'portions', mv.portions,
                                          'reasonCode', mv.reason_code, 'refType', mv.ref_type, 'at', mv.created_at,
                                          'byInitials', app.initials(mu.display_name),
                                          'byMe', mv.created_by = v_me) as item
                                   from public.batch_movement mv
                                   join public.app_user mu on mu.tenant_id = mv.tenant_id and mu.id = mv.created_by
                                  where mv.tenant_id = b.tenant_id and mv.batch_id = b.id
                                  order by mv.created_at desc, mv.id desc
                                  limit 100) m),
           'defaults', jsonb_build_object(
             'hoursLeft', case when b.use_by > v_now then floor(extract(epoch from b.use_by - v_now) / 3600)::integer end),
           'can', jsonb_build_object(
             'adjust', true,
             'discard', rem.v > 0,
             'split', rem.v >= 1 and b.use_by > v_now))
    into v_out
    from public.batch b
    join public.recipe r on r.tenant_id = b.tenant_id and r.id = b.recipe_id
    join public.location x on x.tenant_id = b.tenant_id and x.id = b.location_id
    join public.app_user u on u.tenant_id = b.tenant_id and u.id = b.produced_by
    join public.app_user cu on cu.tenant_id = b.tenant_id and cu.id = b.created_by
    left join public.batch pb on pb.tenant_id = b.tenant_id and pb.id = b.split_from_batch_id
    cross join lateral (select coalesce(sum(mm.portions), 0) as v
                          from public.batch_movement mm
                         where mm.tenant_id = b.tenant_id and mm.batch_id = b.id) rem
   where b.tenant_id = v_tenant and b.id = p_batch;
  if v_out is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
  return v_out;
end
$$;

-- The label text, extended: the portions still in the batch (printed on a reprint, M14 assumption A3) and the parent
-- lot of a split part ("Diviso da"). Every M14 key stays (pinned by pgTAP 126). producedAt of a split part is the
-- parent's and operatorInitials are the producer's.
create or replace function public.batch_label(p_batch uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_label jsonb;
begin
  perform app.require_batch_reader();
  v_tenant := app.tenant_id();
  select jsonb_build_object('batchId', b.id, 'recipeName', r.name, 'version', b.recipe_version,
           'producedAt', b.produced_at, 'useBy', b.use_by, 'portions', b.portions_initial, 'lotCode', b.lot_code,
           'operatorInitials', app.initials(u.display_name), 'shelfLifeHours', b.shelf_life_hours,
           'portionsRemaining', (select coalesce(sum(mm.portions), 0) from public.batch_movement mm
                                  where mm.tenant_id = b.tenant_id and mm.batch_id = b.id),
           'splitFrom', case when pb.id is null then null else jsonb_build_object('lotCode', pb.lot_code) end)
    into v_label
    from public.batch b
    join public.recipe r on r.tenant_id = b.tenant_id and r.id = b.recipe_id
    join public.app_user u on u.tenant_id = b.tenant_id and u.id = b.produced_by
    left join public.batch pb on pb.tenant_id = b.tenant_id and pb.id = b.split_from_batch_id
   where b.tenant_id = v_tenant and b.id = p_batch;
  if v_label is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
  return v_label;
end
$$;

-- The staff-meal rules of the tenant: active ones first, then by name. available = the portions left in the recipe's
-- unexpired fresh/open batches (null for an ingredient); today = the confirmation of the current business date.
create function public.staff_meal_rules() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_now timestamptz := now();
  v_bd date;
begin
  perform app.require_batch_reader();
  v_tenant := app.tenant_id();
  v_bd := app.business_date(v_tenant, v_now);

  return jsonb_build_object(
    'businessDate', v_bd,
    'rules', (select coalesce(jsonb_agg(y.item order by y.is_active desc, y.name collate "C", y.id), '[]'::jsonb)
                from (select r.id, r.is_active, coalesce(rv.name, i.name) as name,
                             jsonb_build_object(
                               'ruleId', r.id,
                               'kind', case when r.recipe_key is not null then 'recipe' else 'ingredient' end,
                               'targetId', coalesce(r.recipe_key, r.ingredient_id),
                               'name', coalesce(rv.name, i.name),
                               'unit', case when r.recipe_key is not null then 'porzioni' else i.base_unit::text end,
                               'defaultCount', r.default_count, 'locationId', r.location_id,
                               'isActive', r.is_active,
                               'available', case when r.recipe_key is null then null
                                  else (select coalesce(sum(greatest(rem.v, 0)), 0)
                                          from public.batch b
                                          cross join lateral (select coalesce(sum(mm.portions), 0) as v
                                                                from public.batch_movement mm
                                                               where mm.tenant_id = b.tenant_id and mm.batch_id = b.id) rem
                                         where b.tenant_id = r.tenant_id and b.recipe_key = r.recipe_key
                                           and b.state in ('fresh', 'open') and b.use_by > v_now) end,
                               'today', case when c.id is null then null
                                  else jsonb_build_object('confirmationId', c.id, 'count', c.count, 'at', c.created_at,
                                                          'byInitials', app.initials(cu.display_name)) end) as item
                        from public.staff_meal_rule r
                        left join public.recipe_key k on k.tenant_id = r.tenant_id and k.id = r.recipe_key
                        left join public.recipe rv on rv.tenant_id = k.tenant_id and rv.recipe_key = k.id
                                                  and rv.version = k.current_version
                        left join public.ingredient i on i.tenant_id = r.tenant_id and i.id = r.ingredient_id
                        left join public.staff_meal_confirmation c on c.tenant_id = r.tenant_id and c.rule_id = r.id
                                                                  and c.business_date = v_bd
                        left join public.app_user cu on cu.tenant_id = c.tenant_id and cu.id = c.created_by
                       where r.tenant_id = v_tenant) y));
end
$$;

revoke all on function public.batch_detail(uuid), public.batch_label(uuid), public.staff_meal_rules()
  from public, anon, authenticated, service_role;
grant execute on function public.batch_detail(uuid), public.batch_label(uuid), public.staff_meal_rules()
  to authenticated;
