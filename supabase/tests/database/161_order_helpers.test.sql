-- M18 step 2: the helpers in schema app (plan §3.1.5, §3.1.9, §3.2; ADR-017): the batch needs of a plate, the
-- availability of menu items (portions left, reason, low-stock hint), the shared lock on the live batches, the client
-- instant parser and the line JSON. Defaults are tested with at least two candidates (lesson 1): two live batches in two
-- locations plus an expired, a finished and a discarded one; a plate with two batch lines; two plate versions. Items
-- are found by id. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

insert into auth.users (id, email) values
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg');

-- Recipes: stew batch S, ragù batch R, stew plate P (v1: 1 porz S; v2 later), ragù plate T (1 porz R), raw plate W.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e5', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliatelle al ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e4', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto crudo (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Spezzatino (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '2026-10-01T00:00Z', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, '2026-10-01T00:00Z', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d6', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e5', 1, '2026-10-01T00:00Z', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d5', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e4', 1, '2026-10-01T00:00Z', 'Piatto crudo (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, null, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d6', 1, null, 'ec000000-0000-4000-8000-0000000000e3', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d5', 1, '1a000000-0000-4000-8000-00000000001a', null, 0.2, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');

-- Menu items of tenant A (found by id) and one of tenant B.
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_available, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 'ec000000-0000-4000-8000-0000000000e5', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Piatto crudo (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e4', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Tiramisù (demo)', 'Dolci', 'dolci', null, false, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', null, true, false, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci', null, true, true, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

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
-- A batch of tenant A for the key k (e1 stew, e3 ragù), with its produce movement.
create function pg_temp.mkbatch(p_id uuid, p_key uuid, p_state text, p_use_by timestamptz, p_loc uuid, p_portions int, p_seq int)
  returns void language plpgsql as $$
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, state, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', p_key,
      case when p_key = 'ec000000-0000-4000-8000-0000000000e1' then 'ed000000-0000-4000-8000-0000000000d1'::uuid else 'ed000000-0000-4000-8000-0000000000d3'::uuid end,
      1, '261023-LOT-' || p_seq, '2026-10-23', 'LOT', p_seq, p_use_by - interval '48 hours',
      'a1000000-0000-4000-8000-00000000000a', 2, 'kg', p_portions, p_portions, 48, p_use_by, p_state::public.batch_state,
      p_loc, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, 'produce', p_portions, 'batch', p_id, '2026-10-23',
      'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.adj(p_batch uuid, p_portions numeric) returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_batch, 'count', p_portions, 'batch_adjust', gen_random_uuid(), '2026-10-23',
      'a1000000-0000-4000-8000-00000000000a')
$$;
-- One availability row of tenant A as text: available reason portions_left low_stock.
create function pg_temp.av(p_item uuid) returns text language sql as $$
  select a.available::text || ' ' || coalesce(a.reason, '-') || ' ' || coalesce(trim_scale(a.portions_left)::text, 'null') || ' ' || a.low_stock::text
    from app.menu_item_availability('11111111-1111-4111-8111-111111111111', array[p_item], now()) a where a.menu_item_id = p_item
$$;
create function pg_temp.iso(p_delta interval) returns jsonb language sql as $$
  select to_jsonb(to_char((clock_timestamp() + p_delta) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
$$;

-- Stew batches: S1 fresh 2 (Cella), S2 open 1.5 (Dispensa), S3 expired 5, S4 finished (balance 0), S5 discarded (balance 0).
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', 'ec000000-0000-4000-8000-0000000000e1', 'fresh', now() + interval '2 days', '10000000-0000-4000-8000-0000000000a1', 2, 1);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b2', 'ec000000-0000-4000-8000-0000000000e1', 'open', now() + interval '1 day', '10000000-0000-4000-8000-0000000000a2', 3, 2);
select pg_temp.adj('ba000000-0000-4000-8000-0000000000b2', -1.5);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b3', 'ec000000-0000-4000-8000-0000000000e1', 'fresh', now() - interval '1 hour', '10000000-0000-4000-8000-0000000000a1', 5, 3);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b4', 'ec000000-0000-4000-8000-0000000000e1', 'finished', now() + interval '2 days', '10000000-0000-4000-8000-0000000000a1', 2, 4);
select pg_temp.adj('ba000000-0000-4000-8000-0000000000b4', -2);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b5', 'ec000000-0000-4000-8000-0000000000e1', 'discarded', now() + interval '2 days', '10000000-0000-4000-8000-0000000000a2', 4, 5);
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b5', 'waste', -4, 'spoilage', 'batch_discard',
          gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
-- Ragù: one live batch with 0.5 portion left.
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000c1', 'ec000000-0000-4000-8000-0000000000e3', 'open', now() + interval '1 day', '10000000-0000-4000-8000-0000000000a1', 1, 6);
select pg_temp.adj('ba000000-0000-4000-8000-0000000000c1', -0.5);

-- Constants and needs --------------------------------------------------------------------------------------
select is(app.low_stock_hint_portions(), 3::numeric, 'the low-stock hint is 3 portions');
select is((select string_agg(n.batch_key::text || ':' || trim_scale(n.need)::text, ',' order by n.batch_key)
             from app.plate_batch_needs('11111111-1111-4111-8111-111111111111', array['ec000000-0000-4000-8000-0000000000e2']::uuid[]) n),
  'ec000000-0000-4000-8000-0000000000e1:1', 'stew plate v1 needs 1 portion of the stew batch');
select is((select count(*)::int from app.plate_batch_needs('11111111-1111-4111-8111-111111111111', array['ec000000-0000-4000-8000-0000000000e4']::uuid[])), 0,
  'a plate with raw lines only has no batch need');
select is((select count(*)::int from app.plate_batch_needs('22222222-2222-4222-8222-222222222222', array['ec000000-0000-4000-8000-0000000000e2']::uuid[])), 0,
  'tenant B sees none of A''s needs');

-- Availability, plate v1 -----------------------------------------------------------------------------------
select is(pg_temp.av('11000000-0000-4000-8000-000000000001'), 'true - 3.5 false',
  'stew: 2 (fresh) + 1.5 (open) = 3.5; the expired, finished and discarded batches do not count; 3.5 is above the hint');
select is(pg_temp.av('11000000-0000-4000-8000-000000000002'), 'true - 0.5 true', 'ragù plate: 0.5 portion left, low stock');
-- The live-batch read behind the availability (added in the performance fix of step 8).
select is((select trim_scale(r.remaining) from app.live_batch_remaining('11111111-1111-4111-8111-111111111111', array['ec000000-0000-4000-8000-0000000000e1']::uuid[], now()) r
            where r.batch_key = 'ec000000-0000-4000-8000-0000000000e1'), 3.5::numeric, 'live_batch_remaining: the stew key sums its two live batches (3.5)');
select is((select count(*)::int from app.live_batch_remaining('11111111-1111-4111-8111-111111111111', array['ec000000-0000-4000-8000-0000000000e1', 'ec000000-0000-4000-8000-0000000000e4']::uuid[], now())), 1,
  'a key without a live batch has no row (only the stew key answers)');
select is((select count(*)::int from app.live_batch_remaining('22222222-2222-4222-8222-222222222222', array['ec000000-0000-4000-8000-0000000000e1']::uuid[], now())), 0, 'tenant B reads none of A''s batches');
select pg_temp.adj('ba000000-0000-4000-8000-0000000000b2', -0.5);
select is(pg_temp.av('11000000-0000-4000-8000-000000000001'), 'true - 3 true', 'after -0.5 on the open batch: 3 portions, low stock (3 is at the hint)');
select is(pg_temp.av('11000000-0000-4000-8000-000000000004'), 'true - null false', 'an unmapped item is always available with no stock limit');
select is(pg_temp.av('11000000-0000-4000-8000-000000000003'), 'true - null false', 'a plate with raw lines only has no stock limit either');
select is(pg_temp.av('11000000-0000-4000-8000-000000000005'), 'false manual null false', 'is_available false: reason manual');
select is(pg_temp.av('11000000-0000-4000-8000-000000000006'), 'false inactive null false', 'inactive: reason inactive');

-- Plate v2: 1 porz stew + 0.5 porz ragù; the binding batch need is the minimum.
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d4', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 2, '2026-10-02T00:00Z', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d4', 1, null, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d4', 2, null, 'ec000000-0000-4000-8000-0000000000e3', 0.5, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');
update public.recipe_key set current_version = 2 where id = 'ec000000-0000-4000-8000-0000000000e2';
select is((select string_agg(n.batch_key::text || ':' || trim_scale(n.need)::text, ',' order by n.batch_key)
             from app.plate_batch_needs('11111111-1111-4111-8111-111111111111', array['ec000000-0000-4000-8000-0000000000e2']::uuid[]) n),
  'ec000000-0000-4000-8000-0000000000e1:1,ec000000-0000-4000-8000-0000000000e3:0.5', 'plate v2 (the current version) has two needs');
select is(pg_temp.av('11000000-0000-4000-8000-000000000001'), 'true - 1 true',
  'plate v2: min(3 stew, floor(2 x 0.5 / 0.5) / 2 = 1 ragù) = 1 portion');

-- A negative balance counts as 0; the sum then comes from the other live batch only.
select pg_temp.adj('ba000000-0000-4000-8000-0000000000b1', -3);
select is((select portions_remaining from public.v_batch_portions where batch_id = 'ba000000-0000-4000-8000-0000000000b1'), -1::numeric, 'fixture: the fresh stew batch is at -1');
select pg_temp.adj('ba000000-0000-4000-8000-0000000000c1', 5);
select is(pg_temp.av('11000000-0000-4000-8000-000000000001'), 'true - 1 true',
  'a negative balance (-1) counts 0, not -1: stew = 1.0 (open batch only); ragù now 5.5, so the stew binds at 1');
select pg_temp.adj('ba000000-0000-4000-8000-0000000000b2', -1);
select is(pg_temp.av('11000000-0000-4000-8000-000000000001'), 'false no_portions 0 false',
  'all stew batches at or below 0: 0 portions, reason no_portions, not available');
select is(pg_temp.av('11000000-0000-4000-8000-000000000002'), 'true - 5.5 false', 'the ragù plate is unaffected by the stew (5.5 left)');
update public.menu_item set is_available = false where id = '11000000-0000-4000-8000-000000000002';
select is(pg_temp.av('11000000-0000-4000-8000-000000000002'), 'false manual 5.5 false', 'manual wins over the portions: reason manual even with 5.5 portions');
update public.menu_item set is_available = true where id = '11000000-0000-4000-8000-000000000002';

-- p_items and tenants.
select is((select count(*)::int from app.menu_item_availability('11111111-1111-4111-8111-111111111111', null, now())), 6, 'p_items null lists all six items of tenant A');
select is((select count(*)::int from app.menu_item_availability('11111111-1111-4111-8111-111111111111',
    array['11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002']::uuid[], now())), 2, 'two ids give two rows');
select is((select count(*)::int from app.menu_item_availability('11111111-1111-4111-8111-111111111111', null, now()) where menu_item_id = '11000000-0000-4000-8000-0000000000b1'), 0,
  'tenant B''s item never appears for tenant A');
select is((select count(*)::int from app.menu_item_availability('22222222-2222-4222-8222-222222222222', null, now())), 1, 'tenant B lists its own single item');
select is((select count(*)::int from app.menu_item_availability('22222222-2222-4222-8222-222222222222',
    array['11000000-0000-4000-8000-000000000001']::uuid[], now())), 0, 'tenant B cannot ask for A''s item');
-- The instant matters: 3 days ahead every batch has expired.
select is((select portions_left from app.menu_item_availability('11111111-1111-4111-8111-111111111111',
    array['11000000-0000-4000-8000-000000000002']::uuid[], now() + interval '3 days')), 0::numeric, 'three days ahead the ragù batch has expired: 0 portions');

-- Lock: the live batches of a key (S1, S2), not the expired, finished or discarded ones.
select is(app.lock_live_batches('11111111-1111-4111-8111-111111111111', array['ec000000-0000-4000-8000-0000000000e1']::uuid[]), 2,
  'lock_live_batches locks the two live stew batches');
select is(app.lock_live_batches('22222222-2222-4222-8222-222222222222', array['ec000000-0000-4000-8000-0000000000e1']::uuid[]), 0, 'tenant B''s lock on A''s key locks nothing');
select is(app.lock_live_batches('11111111-1111-4111-8111-111111111111', array['ec000000-0000-4000-8000-0000000000e1', 'ec000000-0000-4000-8000-0000000000e3']::uuid[]), 3,
  'two keys: 2 stew + 1 ragù live batches');

-- Client time ----------------------------------------------------------------------------------------------
select ok(abs(extract(epoch from app.parse_client_time(pg_temp.iso(interval '-1 hour')) - (clock_timestamp() - interval '1 hour'))) < 5, 'now - 1 h is accepted and parsed');
select is(pg_temp.err(format('select app.parse_client_time(%L::jsonb)', pg_temp.iso(interval '60 seconds'))), 'ok', 'now + 60 s is accepted');
select is(pg_temp.err(format('select app.parse_client_time(%L::jsonb)', pg_temp.iso(interval '125 seconds'))), 'P0001 client_time_invalid', 'now + 125 s is beyond the tolerance');
select is(pg_temp.err($$ select app.parse_client_time('"2026-11-01"'::jsonb) $$), '22023 invalid_request', 'a date without time is invalid_request');
select is(pg_temp.err($$ select app.parse_client_time('"x"'::jsonb) $$), '22023 invalid_request', 'text is invalid_request');
select is(pg_temp.err($$ select app.parse_client_time('"2026-11-01T10:00:00"'::jsonb) $$), '22023 invalid_request', 'a time without an offset is invalid_request');
select is(pg_temp.err($$ select app.parse_client_time('12'::jsonb) $$), '22023 invalid_request', 'a number is invalid_request');
select is(app.parse_client_time('"2026-10-01T10:00:00+01:00"'::jsonb), '2026-10-01T09:00:00Z'::timestamptz, 'an offset is honoured');

-- Line JSON ------------------------------------------------------------------------------------------------
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001',
   'Tavolo 1 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by) values
  ('e1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000001', 'secondi', 1.5, 14, 10, 'menu', '2026-10-24 12:00+00',
   'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
create temp table lj (j jsonb);
insert into lj select app.order_line_json(l) from public.order_line l where l.id = 'e1000000-0000-4000-8000-000000000001';
select is((select array_agg(k order by k collate "C") from lj, jsonb_object_keys(j) k),
  array['clientUpdatedAt', 'course', 'id', 'isShared', 'menuItemId', 'name', 'note', 'qty', 'segue', 'state', 'unitPrice', 'updatedAt', 'updatedBy'],
  'the line JSON has exactly the thirteen documented keys');
select is((select array_agg(k order by k collate "C") from lj, jsonb_object_keys(j -> 'updatedBy') k), array['displayName', 'id'], 'updatedBy is {id, displayName}');
select is((select j ->> 'name' || '|' || (j ->> 'qty') || '|' || (j ->> 'unitPrice') || '|' || (j ->> 'state') || '|' || (j -> 'note')::text from lj),
  'Spezzatino con polenta (demo)|1.5|14|draft|null', 'name, qty, price, state and a null note');
select is((select j -> 'updatedBy' ->> 'displayName' from lj), 'Cameriere Demo', 'the editor is the creating waiter at first');
update public.order_line set updated_by = 'e1000000-0000-4000-8000-00000000000e', note = 'ben cotto' where id = 'e1000000-0000-4000-8000-000000000001';
select is((select app.order_line_json(l) -> 'updatedBy' ->> 'displayName' from public.order_line l where l.id = 'e1000000-0000-4000-8000-000000000001'),
  'Cameriere Due Demo', 'after the second waiter''s edit updatedBy.displayName is Cameriere Due Demo');
select is((select count(*)::int from lj, jsonb_path_query(j, '$.**') x where jsonb_typeof(x) = 'object' and x ?| array['cost', 'margin', 'vat', 'vatRate', 'recipe']), 0, 'no cost, margin, VAT or recipe key');

-- Privileges: no API role executes any helper of this migration -----------------------------------------------
select is((select count(*)::int
             from unnest(array['anon', 'authenticated', 'service_role']) r,
                  unnest(array['app.low_stock_hint_portions()', 'app.plate_batch_needs(uuid, uuid[])',
                                'app.menu_item_availability(uuid, uuid[], timestamptz)', 'app.lock_live_batches(uuid, uuid[])',
                                'app.order_line_json(public.order_line)', 'app.parse_client_time(jsonb)', 'app.client_clock_tolerance()',
                                'app.live_batch_remaining(uuid, uuid[], timestamptz)']) f
            where has_function_privilege(r, f, 'execute')), 0, 'no API role can execute any M18 helper');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
              and p.proname in ('plate_batch_needs', 'menu_item_availability', 'lock_live_batches', 'order_line_json', 'live_batch_remaining')
              and p.prosecdef and p.proconfig = array['search_path=""']), 5, 'the five reading helpers are definer with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
              and p.proname in ('low_stock_hint_portions', 'client_clock_tolerance', 'parse_client_time')
              and p.proconfig = array['search_path=""']), 3, 'the three pure helpers have an empty search_path');
select is(app.client_clock_tolerance(), interval '120 seconds', 'the client clock tolerance is 120 seconds');
select is((select provolatile::text from pg_proc where proname = 'menu_item_availability' and pronamespace = 'app'::regnamespace), 'v',
  'menu_item_availability is volatile (a fresh snapshot after a lock)');

select * from finish();
rollback;
