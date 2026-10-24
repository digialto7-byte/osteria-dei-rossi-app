-- M15 step 4: split_batch (M15 plan §3.1.4, §3.1.5, §3.1.12, §3.2; AT1, AT4; ADR-014). Called under claims, as the API
-- does. Batches are inserted as the migration owner with their produce movement and frozen cost. Production times are
-- relative to now() (constant inside the transaction), so the split happens exactly 2 h after R2 was made. Lot dates
-- are the venue date of now(), so the lot sequence does not depend on the hour the suite runs. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name, is_active) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)', true),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Congelatore (demo)', true),
  ('10000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Magazzino chiuso (demo)', false),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)', true);
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Sale grosso (demo)', 'kg');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1,
   'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'batch', 1,
   'brodo (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Ragù (demo)', 2, 'kg', 10, 48,
   'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e2', 1, '2026-10-01T00:00Z', 'Brodo (demo)', 5, 'l', 20, 48,
   'a1000000-0000-4000-8000-00000000000a');

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
-- A batch of tenant A: produced p_age ago, 48 h shelf life, lot date = today in Rome, 10 portions, its produce movement and
-- its frozen cost (2.0000 per portion, or incomplete when p_missing is set).
create function pg_temp.mkbatch(p_id uuid, p_seq int, p_age interval, p_key text default 'e1', p_code text default 'RAGUDE',
    p_lot_date date default (now() at time zone 'Europe/Rome')::date, p_missing boolean default false)
  returns void language plpgsql as $$
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111',
      ('ec000000-0000-4000-8000-0000000000' || p_key)::uuid, ('ed000000-0000-4000-8000-0000000000d' || right(p_key, 1))::uuid,
      1, to_char(p_lot_date, 'YYMMDD') || '-' || p_code || '-' || p_seq, p_lot_date, p_code, p_seq,
      now() - p_age, 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 10, 10, 48, now() - p_age + interval '48 hours',
      '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, 'produce', 10, 'batch', p_id, p_lot_date,
      'a1000000-0000-4000-8000-00000000000a');
  if p_missing then
    insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids,
        cost_at, created_by)
      values (p_id, '11111111-1111-4111-8111-111111111111', null, null, true,
        array['1a000000-0000-4000-8000-00000000001a']::uuid[], now() - p_age, 'a1000000-0000-4000-8000-00000000000a');
  else
    insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids,
        cost_at, created_by)
      values (p_id, '11111111-1111-4111-8111-111111111111', 20, 2, false, '{}', now() - p_age,
        'a1000000-0000-4000-8000-00000000000a');
  end if;
end
$$;
create function pg_temp.rem(p_batch uuid) returns numeric language sql as $$
  select coalesce(sum(portions), 0) from public.batch_movement where batch_id = p_batch
$$;
create function pg_temp.st(p_batch uuid) returns text language sql as $$
  select state::text from public.batch where id = p_batch
$$;
-- A snapshot of what a refused split must leave alone.
create function pg_temp.snap() returns text language sql as $$
  select (select count(*) from public.batch) || '/' || (select count(*) from public.batch_movement) || '/'
      || (select count(*) from public.batch_cost) || '/'
      || coalesce((select string_agg(b.id || ':' || b.state, ',' order by b.id) from public.batch b), '')
$$;
create function pg_temp.keys(j jsonb) returns setof text language sql as $$
  select k from (select jsonb_object_keys(j) k) a
  union all
  select pg_temp.keys(v) from jsonb_each(j) e (k, v) where jsonb_typeof(v) = 'object'
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text), pg_temp.rem(uuid), pg_temp.st(uuid),
  pg_temp.snap(), pg_temp.keys(jsonb) to authenticated;
create temporary table res (k text primary key, j jsonb);
grant all on res to authenticated;

-- R1 was made 2 h 30 min ago (the rounding case), R2 exactly 2 h ago; BR is a Brodo with an incomplete cost made
-- yesterday (lot date: yesterday); EX is expired.
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', 1, interval '2 hours 30 minutes');
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b2', 2, interval '2 hours');
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b3', 1, interval '26 hours', 'e2', 'BRODO',
  (now() at time zone 'Europe/Rome')::date - 1, true);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b4', 1, interval '50 hours', 'e1', 'RAGUDE',
  (now() at time zone 'Europe/Rome')::date - 2);

-- Shape and grants -----------------------------------------------------------------------------------------
select is_empty(
  $$ select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'split_batch'
        and not (p.prosecdef and p.proconfig @> array['search_path=""']
                 and has_function_privilege('authenticated', p.oid, 'execute')
                 and not has_function_privilege('anon', p.oid, 'execute')
                 and not has_function_privilege('service_role', p.oid, 'execute')) $$,
  'split_batch is definer, has an empty search_path and is executable by authenticated only');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'split_batch'), 1,
  'split_batch exists once');

-- Lock order (source check): the parent row lock before the lot lock, and no ingredient stock lock at all.
select ok(position('app.lock_batch_rows(' in p.prosrc) > 0
    and position('app.lock_batch_lot(' in p.prosrc) > position('app.lock_batch_rows(' in p.prosrc)
    and position('app.lock_ingredient_stock(' in p.prosrc) = 0
    and position('app.next_lot_seq(' in p.prosrc) > position('app.lock_batch_lot(' in p.prosrc),
  'lock order: lock_batch_rows, then lock_batch_lot, then next_lot_seq; no lock_ingredient_stock')
  from pg_proc p where p.proname = 'split_batch' and p.pronamespace = 'public'::regnamespace;

set local role authenticated;

-- Roles and tenancy ---------------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'none');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b2', 1, 24) $$) ~ '^42501', true,
  'no role: split_batch is refused (42501)');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b2', 1, 24) $$) ~ '^42501', true,
  'waiter: split_batch is refused (42501)');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b2', 1, 24) $$),
  'P0002 batch_not_found', 'owner B: split_batch of A''s batch -> P0002');

-- AT1: R2 (10, made 2 h ago) split 4, 2160 h from now, to the freezer ------------------------------------------
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into res select 'r2', public.split_batch('ba000000-0000-4000-8000-0000000000b2', 4, 2160,
  '10000000-0000-4000-8000-0000000000a2');
select is((select (j->>'portions')::int from res where k = 'r2'), 4, 'AT1: the answer carries the portions');
select is((select (j->>'shelfLifeHours')::int from res where k = 'r2'), 2162, 'AT1: shelf life 2162 h (2 h + 2160 h)');
select is((select (j->>'portionsRemaining')::numeric from res where k = 'r2'), 6::numeric, 'AT1: the parent keeps 6');
select is((select j->>'state' from res where k = 'r2'), 'open', 'AT1: the parent is open');
select is((select array_agg(kk.k order by kk.k) from pg_temp.keys((select j from res where k = 'r2')) kk (k)),
  array['batchId', 'locationId', 'lotCode', 'newBatchId', 'portions', 'portionsRemaining', 'producedAt', 'shelfLifeHours',
        'state', 'useBy'],
  'split_batch answers exactly its ten keys');
select is_empty(
  $$ select kk.k from res r, lateral pg_temp.keys(r.j) kk (k) where kk.k ~* '(eur|cost|price|value|amount)' $$,
  'and no key looks like a value, a cost or a price');

reset role;
select is((select count(*)::int from public.batch_movement m
            where m.batch_id = 'ba000000-0000-4000-8000-0000000000b2' and m.type = 'split'), 1,
  'AT1: one split movement on the parent');
select is((select m.portions || '/' || m.ref_type || '/' || (m.ref_id = (select (j->>'newBatchId')::uuid from res where k = 'r2'))::text
                  || '/' || m.created_by
             from public.batch_movement m where m.batch_id = 'ba000000-0000-4000-8000-0000000000b2' and m.type = 'split'),
  '-4.0000/batch_split/true/c1000000-0000-4000-8000-00000000000c',
  'AT1: the parent row is -4, ref batch_split, ref_id the child, written by the chef');
select is((select m.portions || '/' || m.ref_type || '/' || (m.ref_id = m.batch_id)::text || '/' || m.effective_on
             from public.batch_movement m where m.batch_id = (select (j->>'newBatchId')::uuid from res where k = 'r2')),
  '4.0000/batch_split/true/' || (now() at time zone 'Europe/Rome')::date,
  'AT1: the child row is +4, ref batch_split, ref_id its own id, dated with the venue date');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000b2'), 6::numeric, 'AT1: the parent has 6 left');
select is(pg_temp.rem((select (j->>'newBatchId')::uuid from res where k = 'r2')), 4::numeric, 'AT1: the child has 4');
select is((select sum(portions) from public.batch_movement
            where batch_id in ('ba000000-0000-4000-8000-0000000000b2', (select (j->>'newBatchId')::uuid from res where k = 'r2'))),
  10::numeric, 'AT1: the sum over both batches is unchanged (10)');
select is(pg_temp.st('ba000000-0000-4000-8000-0000000000b2'), 'open', 'AT4: the parent row is open');
select is(pg_temp.st((select (j->>'newBatchId')::uuid from res where k = 'r2')), 'fresh', 'the child is fresh');

-- The child row
select is((select (c.split_from_batch_id = 'ba000000-0000-4000-8000-0000000000b2')::text
                  || '/' || (c.produced_at = p.produced_at)::text || '/' || (c.produced_by = p.produced_by)::text
                  || '/' || c.created_by || '/' || c.location_id || '/' || c.portions_initial || '/' || c.portions_computed
                  || '/' || c.output_qty || '/' || c.output_unit || '/' || c.shelf_life_hours
                  || '/' || (c.use_by = p.produced_at + make_interval(hours => 2162))::text
                  || '/' || (c.use_by = now() + make_interval(hours => 2160))::text
                  || '/' || (c.recipe_id = p.recipe_id)::text || '/' || (c.recipe_key = p.recipe_key)::text
                  || '/' || c.recipe_version
             from public.batch c, public.batch p
            where c.id = (select (j->>'newBatchId')::uuid from res where k = 'r2') and p.id = 'ba000000-0000-4000-8000-0000000000b2'),
  'true/true/true/c1000000-0000-4000-8000-00000000000c/10000000-0000-4000-8000-0000000000a2/4/4/0.8000/kg/2162/true/true/true/true/1',
  'AT1: the child links the parent, keeps its production time and producer, is created by the chef at the freezer, with 4 portions, '
  'output 0.8 kg, 2162 h, use_by = split + 2160 h, same recipe version');
select is((select lot_code from public.batch where id = (select (j->>'newBatchId')::uuid from res where k = 'r2')),
  to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-RAGUDE-3', 'the child lot is {D}-RAGUDE-3 after R1 -1 and R2 -2');
select is((select j->>'lotCode' from res where k = 'r2'),
  to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-RAGUDE-3', 'and the answer says so');
select is((select (j->>'producedAt')::timestamptz = (select produced_at from public.batch where id = 'ba000000-0000-4000-8000-0000000000b2')
             from res where k = 'r2'), true, 'and producedAt is the parent''s');
select is(app.next_lot_seq('11111111-1111-4111-8111-111111111111', (now() at time zone 'Europe/Rome')::date, 'RAGUDE'), 4,
  'a production of Ragù after the split would be -4');

-- The cost is copied, not recomputed (ADR-008)
select is((select c.total_cost || '/' || c.unit_cost_frozen || '/' || c.incomplete || '/' || cardinality(c.missing_ingredient_ids)
                  || '/' || (c.cost_at = p.cost_at)::text || '/' || c.created_by
             from public.batch_cost c, public.batch_cost p
            where c.batch_id = (select (j->>'newBatchId')::uuid from res where k = 'r2') and p.batch_id = 'ba000000-0000-4000-8000-0000000000b2'),
  '8.0000/2.0000/false/0/true/c1000000-0000-4000-8000-00000000000c',
  'the child cost is 2.0000 per portion, 8.0000 for 4, complete, the parent''s cost_at');

-- Rounding: R1 was made 2 h 30 min ago; asked 2160 h from now
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into res select 'r1', public.split_batch('ba000000-0000-4000-8000-0000000000b1', 1, 2160,
  '10000000-0000-4000-8000-0000000000a1');
reset role;
select is((select (j->>'shelfLifeHours')::int from res where k = 'r1'), 2162, 'rounding: 2 h 30 min + 2160 h -> 2162 h (rounded down)');
select is((select (j->>'useBy')::timestamptz = (select produced_at + make_interval(hours => 2162) from public.batch where id = 'ba000000-0000-4000-8000-0000000000b1')
             from res where k = 'r1'), true, 'rounding: use_by = production + 2162 h');
select is((select (j->>'useBy')::timestamptz <= now() + make_interval(hours => 2160)
              and (j->>'useBy')::timestamptz > now() + make_interval(hours => 2159) from res where k = 'r1'), true,
  'rounding: never later than asked, at most an hour earlier (split + 2159.5 h)');
select is((select lot_code from public.batch where id = (select (j->>'newBatchId')::uuid from res where k = 'r1')),
  to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-RAGUDE-4', 'the next child lot is -4');

-- A split on another day restarts the sequence: BR was made yesterday (lot date yesterday)
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into res select 'br', public.split_batch('ba000000-0000-4000-8000-0000000000b3', 3, 24, '10000000-0000-4000-8000-0000000000a2');
reset role;
select is((select j->>'lotCode' from res where k = 'br'),
  to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-BRODO-1', 'a split today of a Brodo made yesterday is {today}-BRODO-1');
select is((select c.total_cost is null and c.unit_cost_frozen is null and c.incomplete
                  and c.missing_ingredient_ids = array['1a000000-0000-4000-8000-00000000001a']::uuid[]
             from public.batch_cost c where c.batch_id = (select (j->>'newBatchId')::uuid from res where k = 'br')), true,
  'a child of an incomplete cost stays incomplete with the same missing ingredients (never 0)');

-- A split of a split keeps the root's production time
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into res select 'gc', public.split_batch((select (j->>'newBatchId')::uuid from res where k = 'r2'), 2, 100,
  '10000000-0000-4000-8000-0000000000a2');
reset role;
select is((select (g.produced_at = r.produced_at)::text || '/' || (g.split_from_batch_id = c.id)::text || '/' || g.shelf_life_hours
             from public.batch g, public.batch c, public.batch r
            where g.id = (select (j->>'newBatchId')::uuid from res where k = 'gc')
              and c.id = (select (j->>'newBatchId')::uuid from res where k = 'r2') and r.id = 'ba000000-0000-4000-8000-0000000000b2'),
  'true/true/102', 'a split of a split keeps the root''s production time (2 h + 100 h = 102 h)');
select is(pg_temp.rem((select (j->>'newBatchId')::uuid from res where k = 'r2')), 2::numeric, 'and the middle batch has 2 left');

-- Refusals: nothing is written ----------------------------------------------------------------------------
create temporary table snap0 (s text);
insert into snap0 select pg_temp.snap();
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 10, 24, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 portions_insufficient', 'R1 has 9: splitting 10 -> portions_insufficient');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 0, 24, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 portions_invalid', '0 portions -> portions_invalid');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', -1, 24, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 portions_invalid', '-1 portions -> portions_invalid');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', null, 24, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 portions_invalid', 'null portions -> portions_invalid');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b4', 1, 24, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 batch_expired', 'a batch past its use-by -> batch_expired');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 1, 0, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 shelf_life_invalid', 'hoursFromNow 0 -> shelf_life_invalid');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 1, -5, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 shelf_life_invalid', 'hoursFromNow -5 -> shelf_life_invalid');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 1, null, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 shelf_life_invalid', 'hoursFromNow null -> shelf_life_invalid');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 1, 8759, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 shelf_life_invalid', 'a total shelf life over 8760 h (2 h 30 min + 8759 h) -> shelf_life_invalid');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 1, 24, '10000000-0000-4000-8000-0000000000b1') $$),
  'P0001 location_not_found', 'a location of another tenant -> location_not_found');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 1, 24, '10000000-0000-4000-8000-0000000000a3') $$),
  'P0001 location_not_found', 'an inactive location -> location_not_found');
select is(pg_temp.err($$ select public.split_batch(gen_random_uuid(), 1, 24, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0002 batch_not_found', 'an unknown batch -> P0002');
select is(pg_temp.err($$ select public.split_batch(null, 1, 24, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0002 batch_not_found', 'a null batch -> P0002');
reset role;
select is(pg_temp.snap(), (select s from snap0), 'none of the refusals wrote anything (batches, movements, costs, states)');

-- Boundary: 2 h 30 min + 8757 h = 8759.5 h -> 8759 h is accepted
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 1, 8757, '10000000-0000-4000-8000-0000000000a2') $$),
  'ok', 'a total shelf life of 8759 h is accepted');
reset role;

-- AT4: splitting all that is left -> the parent is finished
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into res select 'all', public.split_batch('ba000000-0000-4000-8000-0000000000b2', 6, 12, '10000000-0000-4000-8000-0000000000a2');
select is((select j->>'state' from res where k = 'all'), 'finished', 'AT4: splitting all 6 -> the answer says finished');
reset role;
select is(pg_temp.st('ba000000-0000-4000-8000-0000000000b2'), 'finished', 'AT4: the parent row is finished');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000b2'), 0::numeric, 'and has 0 left');
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b2', 1, 12, '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 portions_insufficient', 'a finished batch cannot be split (portions_insufficient)');
reset role;

-- No location given: the child stays where its parent is (never ambiguous, even with two active locations)
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
    lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours,
    use_by, location_id, created_by)
  select ('ba000000-0000-4000-8000-0000000000b' || n)::uuid, b.tenant_id, b.recipe_key, b.recipe_id, b.recipe_version,
         to_char(b.lot_date, 'YYMMDD') || '-RAGUDE-9' || n, b.lot_date, b.lot_recipe_code, 90 + n, b.produced_at,
         b.produced_by, b.output_qty, b.output_unit, 10, 10, 48, b.use_by,
         case n when 5 then '10000000-0000-4000-8000-0000000000a2'::uuid else b.location_id end, b.created_by
    from public.batch b, generate_series(5, 6) n
   where b.id = 'ba000000-0000-4000-8000-0000000000b2';
insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
  select x.id, x.tenant_id, 20, 2, false, '{}', x.produced_at, x.created_by
    from public.batch x where x.id in ('ba000000-0000-4000-8000-0000000000b5', 'ba000000-0000-4000-8000-0000000000b6');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  select x.tenant_id, x.id, 'produce', 10, 'batch', x.id, x.lot_date, x.created_by
    from public.batch x where x.id in ('ba000000-0000-4000-8000-0000000000b5', 'ba000000-0000-4000-8000-0000000000b6');
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into res select 'inherit_freezer', public.split_batch('ba000000-0000-4000-8000-0000000000b5', 2, 24);
insert into res select 'inherit_cella', public.split_batch('ba000000-0000-4000-8000-0000000000b6', 2, 24);
reset role;
select is((select j->>'locationId' from res where k = 'inherit_freezer'), '10000000-0000-4000-8000-0000000000a2',
  'no location, parent in the freezer, two active locations: the answer says the freezer (the parent''s)');
select is((select c.location_id from public.batch c where c.id = (select (j->>'newBatchId')::uuid from res where k = 'inherit_freezer')),
  '10000000-0000-4000-8000-0000000000a2'::uuid, 'and the child row is in the freezer');
select is((select c.location_id from public.batch c where c.id = (select (j->>'newBatchId')::uuid from res where k = 'inherit_cella')),
  '10000000-0000-4000-8000-0000000000a1'::uuid, 'a parent in Cella gives a child in Cella');

-- Fault injection: a failure on the 6th or 7th write leaves nothing behind ----------------------------------
create function public.fault_inject() returns trigger language plpgsql as $$
begin
  raise exception 'fault_injected';
end
$$;
create trigger fault_cost before insert on public.batch_cost for each row execute function public.fault_inject();
delete from snap0;
insert into snap0 select pg_temp.snap();
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select alike(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 1, 24, '10000000-0000-4000-8000-0000000000a2') $$),
  '%fault_injected%', 'fault on batch_cost: the split fails');
reset role;
select is(pg_temp.snap(), (select s from snap0), 'fault on batch_cost: no child batch, no row, no state change');
drop trigger fault_cost on public.batch_cost;
create trigger fault_move before insert on public.batch_movement for each row execute function public.fault_inject();
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select alike(pg_temp.err($$ select public.split_batch('ba000000-0000-4000-8000-0000000000b1', 1, 24, '10000000-0000-4000-8000-0000000000a2') $$),
  '%fault_injected%', 'fault on batch_movement: the split fails');
reset role;
select is(pg_temp.snap(), (select s from snap0), 'fault on batch_movement: no child batch, no cost, no row, no state change');
drop trigger fault_move on public.batch_movement;

-- Sum invariants over everything split in this test ---------------------------------------------------------
select is((select count(*)::int from public.batch_movement where ref_type = 'batch_split'), 16,
  'eight splits wrote eight pairs of movements');
select is_empty(
  $$ select m.ref_id from public.batch_movement m where m.ref_type = 'batch_split'
      group by m.ref_id having count(*) <> 2 or sum(m.portions) <> 0 $$,
  'every split operation has exactly two rows that sum to 0');

select * from finish();
rollback;
