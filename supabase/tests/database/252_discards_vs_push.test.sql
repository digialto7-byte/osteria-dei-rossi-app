-- M23 step 5 (docs/plans/2026-10-31-m23-push-forecast.md §3.1.5, §3.2, §3.8, §5; Q165-Q167; AT7): app.discards_vs_push_json / public.discards_vs_push. The fixture week is 1998-11-02..08:
-- S1 (Spezzatino, 3 portions thrown away Wed 11-04 21:00 CET, its plate pushed that morning) and R1 (Ragù, 5 portions Tue 11-03 22:00 CET, never pushed). Then the edges, one at a
-- time: next week's discard, a void waste, a batch made after a push ended, a push of another plate, two discards of one batch, a Sunday 23:30 discard, an unknown cost, a reversed
-- discard (the shape check is dropped inside this rolled-back transaction to write one), another tenant. Owner and admin only. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
-- Batch recipes Spezzatino (shelf life 48 h) and Ragù (72 h); plates "Spezzatino con polenta" (uses the stew) and "Tagliatelle al ragù" (uses the ragù).
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e5', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliatelle al ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000eb', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'stufato b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '1998-10-01', 'Spezzatino', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '1998-10-01', 'Ragù (demo)', 2, 'kg', 10, 72, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000db', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 1, '1998-10-01', 'Stufato B (demo)', 2, 'kg', 10, 48, 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, '1998-10-01', 'Spezzatino con polenta', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d6', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e5', 1, '1998-10-01', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d6', 1, 'ec000000-0000-4000-8000-0000000000e3', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 'ec000000-0000-4000-8000-0000000000e5', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14, 10, '1998-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000002', 11, 10, '1998-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.uid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- A batch of tenant A (p_key 'e1' = stew, 'e3' = ragù) produced at p_produced for p_shelf hours, p_made portions; cost per portion p_cost (null = incomplete).
create function pg_temp.mkbatch(p_name text, p_key text, p_produced timestamptz, p_shelf int, p_made int, p_cost numeric) returns void language plpgsql as $$
declare
  v_id uuid := pg_temp.uid(p_name);
  v_key uuid := ('ec000000-0000-4000-8000-0000000000' || p_key)::uuid;
  v_n int := (select count(*)::int + 1 from public.batch);
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
      portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', v_key,
            case when p_key = 'e1' then 'ed000000-0000-4000-8000-0000000000d1'::uuid else 'ed000000-0000-4000-8000-0000000000d3'::uuid end,
            1, '981101-LOT-' || v_n, '1998-11-01', 'LOT', v_n, p_produced, 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', p_made, p_made, p_shelf,
            p_produced + make_interval(hours => p_shelf), 'fresh', '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', p_made, 'batch', v_id, (p_produced at time zone 'Europe/Rome')::date, p_produced, 'a1000000-0000-4000-8000-00000000000a');
  if p_cost is null then
    insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
      values (v_id, '11111111-1111-4111-8111-111111111111', null, null, true, array['1a000000-0000-4000-8000-0000000000a3']::uuid[], p_produced, 'a1000000-0000-4000-8000-00000000000a');
  else
    insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
      values (v_id, '11111111-1111-4111-8111-111111111111', round(p_cost * p_made, 4), p_cost, false, '{}', p_produced, 'a1000000-0000-4000-8000-00000000000a');
  end if;
end
$$;
-- A waste movement of a batch of tenant A at p_at, dated p_eff (default: the venue date of p_at), as discard_batch writes it; ref_type 'order_void' makes it a void waste.
create function pg_temp.disc(p_name text, p_portions numeric, p_at timestamptz, p_ref text default 'batch_discard', p_reason text default 'expired') returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.uid(p_name), 'waste', -p_portions, p_reason, p_ref, gen_random_uuid(), (p_at at time zone 'Europe/Rome')::date, p_at,
          'a1000000-0000-4000-8000-00000000000a')
$$;
create function pg_temp.dv(p_week text, p_now text) returns jsonb language sql as $$
  select app.discards_vs_push_json('11111111-1111-4111-8111-111111111111', p_week::date, p_now::timestamptz) $$;
create function pg_temp.rrow(j jsonb, p_name text) returns jsonb language sql as $$
  select jsonb_path_query_first(j -> 'rows', '$[*] ? (@.name == $n)', jsonb_build_object('n', p_name)) $$;

-- Pushes of the stew plate through the twin (owner A): 11-03 10:00Z, stopped at 12:00Z (period 10:00-12:00Z); 11-04 09:05Z until the next 02:00 CET (11-05 01:00Z).
select app.push_menu_item_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '11000000-0000-4000-8000-000000000001', '{"pushed":true}', '1998-11-03T10:00Z');
select app.push_menu_item_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '11000000-0000-4000-8000-000000000001', '{"pushed":false}', '1998-11-03T12:00Z');
select app.push_menu_item_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":12}', '1998-11-04T09:05Z');
-- S1 and R1.
select pg_temp.mkbatch('S1', 'e1', '1998-11-02T19:00Z', 48, 10, 2.7143);
select pg_temp.disc('S1', 3, '1998-11-04T20:00Z');
select pg_temp.mkbatch('R1', 'e3', '1998-11-01T10:00Z', 72, 10, 1.50);
select pg_temp.disc('R1', 5, '1998-11-03T21:00Z');
-- Tenant B: one batch with 9 portions thrown away in the same week.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
    portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by) values
  (pg_temp.uid('BB1'), '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 'ed000000-0000-4000-8000-0000000000db', 1, '981101-STB-1', '1998-11-01', 'STB', 1,
   '1998-11-02T10:00Z', 'b1000000-0000-4000-8000-00000000000b', 2, 'kg', 10, 10, 48, '1998-11-04T10:00Z', 'fresh', '10000000-0000-4000-8000-0000000000b1', 'b1000000-0000-4000-8000-00000000000b');
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by) values
  ('22222222-2222-4222-8222-222222222222', pg_temp.uid('BB1'), 'produce', 10, null, 'batch', pg_temp.uid('BB1'), '1998-11-02', '1998-11-02T10:00Z', 'b1000000-0000-4000-8000-00000000000b'),
  ('22222222-2222-4222-8222-222222222222', pg_temp.uid('BB1'), 'waste', -9, 'expired', 'batch_discard', gen_random_uuid(), '1998-11-04', '1998-11-04T12:00Z', 'b1000000-0000-4000-8000-00000000000b');

create temp table r (nm text primary key, j jsonb);
grant all on r to public;
insert into r values ('base', pg_temp.dv('1998-11-04', '1998-11-09T09:00Z'));

-- AT7: the fixture week -------------------------------------------------------------------------------------------------------------------------------
select is((select j ->> 'weekFrom' || '/' || (j ->> 'weekTo') from r where nm = 'base'), '1998-11-02/1998-11-08', 'the ISO week of 1998-11-04 is 11-02..11-08');
select is((select array_agg(e ->> 'name' order by n) from jsonb_array_elements((select j -> 'rows' from r where nm = 'base')) with ordinality t(e, n)), array['Ragù (demo)', 'Spezzatino'],
          'rows: batches discarded desc (1 and 1), then portions discarded desc: Ragù (5) before Spezzatino (3)');
select is((pg_temp.rrow((select j from r where nm = 'base'), 'Ragù (demo)') - 'recipeKey'),
          '{"name": "Ragù (demo)", "shelfLifeHours": 72, "batchesDiscarded": 1, "batchesPushed": 0, "portionsDiscarded": 5, "portionsPushed": 0, "valueEur": 7.5000, "unvaluedCount": 0}'::jsonb,
          'AT7: Ragù: 1 batch, none pushed, 5 portions, 7.50 (a push of the stew plate overlapped its life but does not use the ragù)');
select is((pg_temp.rrow((select j from r where nm = 'base'), 'Spezzatino') - 'recipeKey'),
          '{"name": "Spezzatino", "shelfLifeHours": 48, "batchesDiscarded": 1, "batchesPushed": 1, "portionsDiscarded": 3, "portionsPushed": 3, "valueEur": 8.1429, "unvaluedCount": 0}'::jsonb,
          'AT7: Spezzatino: 1 batch, 1 pushed, 3 portions, 8.1429, shelf life 48 h');
select is((pg_temp.rrow((select j from r where nm = 'base'), 'Spezzatino') ->> 'recipeKey'), 'ec000000-0000-4000-8000-0000000000e1', 'the row carries the recipe key');
select is((select j -> 'totals' from r where nm = 'base'),
          '{"batchesDiscarded": 2, "batchesPushed": 1, "portionsDiscarded": 8, "portionsPushed": 3, "valueEur": 15.6429, "unvaluedCount": 0}'::jsonb, 'totals: 2 batches, 1 pushed, 8 portions, 3 pushed, 15.6429');
select is((select array_agg(k order by k) from jsonb_object_keys((select j from r where nm = 'base')) k), array['rows', 'totals', 'weekFrom', 'weekTo'], 'the reply keys');

-- Edges, one at a time --------------------------------------------------------------------------------------------------------------------------------
-- 1. A discard on Monday 11-09 belongs to the next week.
select pg_temp.mkbatch('S3', 'e1', '1998-11-06T10:00Z', 48, 10, 2.7143);
select pg_temp.disc('S3', 4, '1998-11-09T08:00Z');
select is(pg_temp.dv('1998-11-04', '1998-11-09T09:00Z'), (select j from r where nm = 'base'), 'a discard of the next week leaves this week''s report unchanged');
select is((pg_temp.rrow(pg_temp.dv('1998-11-09', '1998-11-09T09:00Z'), 'Spezzatino') ->> 'portionsDiscarded')::numeric, 4::numeric, 'and it is in the next week''s report');
select is((pg_temp.rrow(pg_temp.dv('1998-11-09', '1998-11-09T09:00Z'), 'Spezzatino') ->> 'batchesPushed')::numeric, 0::numeric, 'where it was not pushed (made after the push ended)');
-- 2. A void waste is not a discard.
select pg_temp.disc('S1', 2, '1998-11-04T19:30Z', 'order_void', 'plating_error');
select is(pg_temp.dv('1998-11-04', '1998-11-09T09:00Z'), (select j from r where nm = 'base'), 'a waste from a void after firing (order_void) is not a discard');
-- 3. A batch made after a push was stopped is not pushed (S2: made 11-03 14:00Z, after the 12:00Z stop; thrown away 11-04 00:30Z, before the next push).
select pg_temp.mkbatch('S2', 'e1', '1998-11-03T14:00Z', 48, 10, 2.7143);
select pg_temp.disc('S2', 1, '1998-11-04T00:30Z');
insert into r values ('e3', pg_temp.dv('1998-11-04', '1998-11-09T09:00Z'));
select is((pg_temp.rrow((select j from r where nm = 'e3'), 'Spezzatino') - 'recipeKey' - 'valueEur'),
          '{"name": "Spezzatino", "shelfLifeHours": 48, "batchesDiscarded": 2, "batchesPushed": 1, "portionsDiscarded": 4, "portionsPushed": 3, "unvaluedCount": 0}'::jsonb,
          'S2 (made after the stop) counts as discarded, not pushed: 2 batches, 1 pushed, 4 portions, 3 pushed');
select is((pg_temp.rrow((select j from r where nm = 'e3'), 'Spezzatino') ->> 'valueEur')::numeric, 10.8572, 'and its value is added (8.1429 + 2.7143)');
-- 4. Two discards of one batch are one batch with the portions summed.
select pg_temp.disc('R1', 2, '1998-11-05T09:00Z');
insert into r values ('e4', pg_temp.dv('1998-11-04', '1998-11-09T09:00Z'));
select is((pg_temp.rrow((select j from r where nm = 'e4'), 'Ragù (demo)') - 'recipeKey'),
          '{"name": "Ragù (demo)", "shelfLifeHours": 72, "batchesDiscarded": 1, "batchesPushed": 0, "portionsDiscarded": 7, "portionsPushed": 0, "valueEur": 10.5000, "unvaluedCount": 0}'::jsonb,
          'R1 discarded twice: one batch, 7 portions, 10.50');
-- 5. Sunday 1998-11-08 at 23:30 local (22:30Z) is in the week.
select pg_temp.mkbatch('R2', 'e3', '1998-11-07T10:00Z', 72, 10, 1.50);
select pg_temp.disc('R2', 1, '1998-11-08T22:30Z');
insert into r values ('e5', pg_temp.dv('1998-11-04', '1998-11-09T09:00Z'));
select is((pg_temp.rrow((select j from r where nm = 'e5'), 'Ragù (demo)') ->> 'batchesDiscarded')::numeric, 2::numeric, 'a discard on Sunday 23:30 local is dated Sunday and is in the week');
select is((select count(*)::int from public.batch_movement where batch_id = pg_temp.uid('R2') and effective_on = '1998-11-08'), 1, 'its effective_on is the venue date 1998-11-08');
-- 6. An unknown batch cost is excluded from the value and counted.
select pg_temp.mkbatch('R3', 'e3', '1998-11-05T10:00Z', 72, 10, null);
select pg_temp.disc('R3', 4, '1998-11-06T10:00Z');
insert into r values ('e6', pg_temp.dv('1998-11-04', '1998-11-09T09:00Z'));
select is((pg_temp.rrow((select j from r where nm = 'e6'), 'Ragù (demo)') ->> 'unvaluedCount')::numeric, 1::numeric, 'an incomplete cost: unvaluedCount 1');
select is((pg_temp.rrow((select j from r where nm = 'e6'), 'Ragù (demo)') ->> 'valueEur')::numeric, (pg_temp.rrow((select j from r where nm = 'e5'), 'Ragù (demo)') ->> 'valueEur')::numeric, 'and the value does not change (unknown is not zero-valued)');
select is((pg_temp.rrow((select j from r where nm = 'e6'), 'Ragù (demo)') ->> 'portionsDiscarded')::numeric, 12::numeric, 'but its 4 portions are counted (7 + 1 + 4)');
select is((select j -> 'totals' ->> 'unvaluedCount' from r where nm = 'e6'), '1', 'totals: unvaluedCount 1');
-- 7. A reversed discard is not counted. A reversal of a waste row has no legal shape today; the shape check and the reversal guard are dropped here (this transaction is rolled back).
alter table public.batch_movement drop constraint batch_movement_shape_ck;
alter table public.batch_movement disable trigger batch_movement_reversal_guard;
select pg_temp.mkbatch('R4', 'e3', '1998-11-05T11:00Z', 72, 10, 1.50);
select pg_temp.disc('R4', 6, '1998-11-06T11:00Z');
insert into r values ('before_rev', pg_temp.dv('1998-11-04', '1998-11-09T09:00Z'));
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, reverses_id, effective_on, created_at, created_by)
  select tenant_id, batch_id, 'count', 6, null, 'batch_adjust', gen_random_uuid(), id, effective_on, created_at + interval '1 minute', created_by
    from public.batch_movement where batch_id = pg_temp.uid('R4') and type = 'waste';
insert into r values ('after_rev', pg_temp.dv('1998-11-04', '1998-11-09T09:00Z'));
select is((pg_temp.rrow((select j from r where nm = 'before_rev'), 'Ragù (demo)') ->> 'batchesDiscarded')::numeric, 4::numeric, 'before the reversal R4 is a discarded batch (R1, R2, R3, R4)');
select is((pg_temp.rrow((select j from r where nm = 'after_rev'), 'Ragù (demo)') ->> 'batchesDiscarded')::numeric, 3::numeric, 'a discard that has a reversing row is not counted');
select is((pg_temp.rrow((select j from r where nm = 'after_rev'), 'Ragù (demo)') ->> 'portionsDiscarded')::numeric, 12::numeric, 'nor are its 6 portions');

-- Week selection --------------------------------------------------------------------------------------------------------------------------------------
select is((pg_temp.dv(null, '1998-11-09T09:00Z') ->> 'weekFrom'), '1998-11-09', 'null is the week of today''s business date');
select is((pg_temp.dv(null, '1998-11-09T00:30Z') ->> 'weekFrom'), '1998-11-02', 'at 01:30 CET on Monday the business date is still Sunday: the previous week');
select is((pg_temp.dv('1998-11-08', '1998-11-09T09:00Z') ->> 'weekFrom'), '1998-11-02', 'Sunday belongs to the week that starts on the Monday before');
select is((pg_temp.dv('1998-11-02', '1998-11-09T09:00Z') ->> 'weekTo'), '1998-11-08', 'and Monday starts it');
select is(pg_temp.err($$select pg_temp.dv('1998-11-10', '1998-11-09T09:00Z')$$), 'P0001 date_in_future', 'a date after today''s business date: date_in_future');
select is((pg_temp.dv('1998-11-09', '1998-11-09T09:00Z') -> 'rows' -> 0 ->> 'name'), 'Spezzatino', 'an empty-ish week is fine: next week has the one stew row');
select is((pg_temp.dv('1998-10-12', '1998-11-09T09:00Z') -> 'rows'), '[]'::jsonb, 'a week with no discard has no rows');
select is((pg_temp.dv('1998-10-12', '1998-11-09T09:00Z') -> 'totals'), '{"batchesDiscarded": 0, "batchesPushed": 0, "portionsDiscarded": 0, "portionsPushed": 0, "valueEur": 0, "unvaluedCount": 0}'::jsonb, 'and zero totals');

-- Tenancy and roles -----------------------------------------------------------------------------------------------------------------------------------
select is((select j -> 'totals' ->> 'portionsDiscarded' from (select app.discards_vs_push_json('22222222-2222-4222-8222-222222222222', '1998-11-04', '1998-11-09T09:00Z') j) x), '9', 'tenant B has its own 9 portions');
select is((select j -> 'totals' ->> 'batchesDiscarded' from (select app.discards_vs_push_json('22222222-2222-4222-8222-222222222222', '1998-11-04', '1998-11-09T09:00Z') j) x), '1', 'and its one batch');
select is(position('Stufato' in (select j::text from r where nm = 'base')), 0, 'none of B''s rows is in A''s report');
select is(position('Spezzatino' in (select app.discards_vs_push_json('22222222-2222-4222-8222-222222222222', '1998-11-04', '1998-11-09T09:00Z')::text)), 0, 'nor A''s in B''s');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((public.discards_vs_push(null) ? 'weekFrom'), true, 'public.discards_vs_push answers the owner');
select is((public.discards_vs_push() ? 'weekFrom'), true, 'with no argument too');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((public.discards_vs_push(null) ? 'rows'), true, 'and the admin');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err($$select public.discards_vs_push(null)$$), 6), '42501 ', 'the chef is refused');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$select public.discards_vs_push(null)$$), 6), '42501 ', 'the waiter is refused');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err($$select public.discards_vs_push(null)$$), 6), '42501 ', 'and so is a caller without claims');
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.discards_vs_push(date)', 'execute')), array['authenticated'], 'only authenticated executes discards_vs_push');
select is((select bool_or(has_function_privilege(r, 'app.discards_vs_push_json(uuid, date, timestamptz)', 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r), false, 'no API role executes the app.* twin');
select is((select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
            where oid in ('public.discards_vs_push(date)'::regprocedure, 'app.discards_vs_push_json(uuid, date, timestamptz)'::regprocedure)), true, 'definers with an empty search_path');
-- A5 moved the discards read to a created_at range and A5b dropped batch_movement_effective_idx (no reader left): the read is served by batch_movement_created_idx.
select is((select count(*)::int from pg_indexes where indexname = 'batch_movement_created_idx'), 1, 'the discards read is served by batch_movement_created_idx (A5)');

select * from finish();
rollback;
