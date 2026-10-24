-- M15 step 3: adjust_batch and discard_batch (M15 plan §3.1.2-3, §3.1.5; AT2 movement, AT3, AT4; ADR-014). Called under
-- claims, as the API does. Batches are inserted as the migration owner with their produce movement. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

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
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1,
   'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Ragù (demo)', 2, 'kg', 10, 48,
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
-- A batch of tenant A with its produce movement of 10 portions (fresh).
create function pg_temp.mkbatch(p_id uuid, p_seq int) returns void language plpgsql as $$
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1',
      'ed000000-0000-4000-8000-0000000000d1', 1, '261023-RAGUDE-' || p_seq, '2026-10-23', 'RAGUDE', p_seq,
      '2026-10-23T08:00Z', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 10, 10, 48, '2026-10-25T08:00Z',
      '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, 'produce', 10, 'batch', p_id, '2026-10-23',
      'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.st(p_batch uuid) returns text language sql as $$
  select state::text from public.batch where id = p_batch
$$;
create function pg_temp.rem(p_batch uuid) returns numeric language sql as $$
  select coalesce(sum(portions), 0) from public.batch_movement where batch_id = p_batch
$$;
create function pg_temp.nmoves(p_batch uuid) returns bigint language sql as $$
  select count(*) from public.batch_movement where batch_id = p_batch
$$;
-- All the keys of a jsonb value at any depth.
create function pg_temp.keys(j jsonb) returns setof text language sql as $$
  select k from (select jsonb_object_keys(j) k) a
  union all
  select pg_temp.keys(v) from jsonb_each(j) e (k, v) where jsonb_typeof(v) = 'object'
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text), pg_temp.st(uuid), pg_temp.rem(uuid),
  pg_temp.nmoves(uuid), pg_temp.keys(jsonb) to authenticated;
create temporary table res (k text primary key, j jsonb);
grant all on res to authenticated;

select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', 1);   -- R1: adjust, discard
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b2', 2);   -- R2: a discard, then 6 remaining
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b3', 3);   -- R3: waiter and tenant cases
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on,
    created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b2', 'waste', -4, 'spoilage',
    'batch_discard', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');

-- Shape and grants -----------------------------------------------------------------------------------------
select is_empty(
  $$ select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('adjust_batch', 'discard_batch')
        and not (p.prosecdef and p.proconfig @> array['search_path=""']
                 and has_function_privilege('authenticated', p.oid, 'execute')
                 and not has_function_privilege('anon', p.oid, 'execute')
                 and not has_function_privilege('service_role', p.oid, 'execute')) $$,
  'adjust_batch and discard_batch are definer, have an empty search_path and are executable by authenticated only');

set local role authenticated;

-- No claims: nothing.
select pg_temp.act_as('00000000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'none');
select is(pg_temp.err($$ select public.adjust_batch('ba000000-0000-4000-8000-0000000000b1', 5) $$) ~ '^42501', true,
  'adjust_batch without a role is refused (42501)');

-- Waiter: 42501, nothing written ------------------------------------------------------------------------------
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$ select public.adjust_batch('ba000000-0000-4000-8000-0000000000b3', 5) $$) ~ '^42501', true,
  'waiter: adjust_batch is refused (42501)');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b3', 1, 'spoilage') $$) ~ '^42501', true,
  'waiter: discard_batch is refused (42501)');

-- Tenancy -------------------------------------------------------------------------------------------------
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err($$ select public.adjust_batch('ba000000-0000-4000-8000-0000000000b3', 5) $$),
  'P0002 batch_not_found', 'owner B: adjust_batch of A''s batch -> P0002');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b3', 1, 'spoilage') $$),
  'P0002 batch_not_found', 'owner B: discard_batch of A''s batch -> P0002');

-- adjust_batch (AT3, AT4) -------------------------------------------------------------------------------------
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into res select 'a1', public.adjust_batch('ba000000-0000-4000-8000-0000000000b2', 5);
select is((select (j->>'delta')::numeric from res where k = 'a1'), -1::numeric, 'AT3: 6 expected, 5 counted -> delta -1');
select is((select (j->>'portionsRemaining')::numeric from res where k = 'a1'), 5::numeric, 'AT3: portionsRemaining 5');
select is((select j->>'state' from res where k = 'a1'), 'open', 'AT3: state open');
select is((select count(*)::int || '/' || min(m.portions) || '/' || min(m.ref_type) || '/' || min(m.created_by::text)
             || '/' || bool_and(m.ref_id <> m.batch_id)::text
             || '/' || (min(m.id::text) = (select j->>'movementId' from res where k = 'a1'))::text
             from public.batch_movement m where m.batch_id = 'ba000000-0000-4000-8000-0000000000b2' and m.type = 'count'),
  '1/-1.0000/batch_adjust/c1000000-0000-4000-8000-00000000000c/true/true',
  'AT3: one count row of -1, ref batch_adjust, written by the chef, its id returned');
select is((select m.effective_on from public.batch_movement m
            where m.batch_id = 'ba000000-0000-4000-8000-0000000000b2' and m.type = 'count'),
  (now() at time zone 'Europe/Rome')::date, 'the movement is dated with the venue date');
select is(pg_temp.st('ba000000-0000-4000-8000-0000000000b2'), 'open', 'the row state is open');
insert into res select 'a2', public.adjust_batch('ba000000-0000-4000-8000-0000000000b2', 5);
select is((select j->>'movementId' from res where k = 'a2'), null, 'counting the same figure again returns no movementId');
select is((select (j->>'delta')::numeric from res where k = 'a2'), 0::numeric, 'and a delta of 0');
select is(pg_temp.nmoves('ba000000-0000-4000-8000-0000000000b2'), 3::bigint, 'and writes no row (produce, waste, one count)');
insert into res select 'a3', public.adjust_batch('ba000000-0000-4000-8000-0000000000b2', 5.5);
select is((select (j->>'delta')::numeric from res where k = 'a3'), 0.5::numeric, 'a fractional count: 5.5 counted with 5 expected -> +0.5');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000b2'), 5.5::numeric, 'and 5.5 remain');
select is(pg_temp.err($$ select public.adjust_batch('ba000000-0000-4000-8000-0000000000b2', -1) $$),
  'P0001 count_invalid', 'a count below 0 is refused');
select is(pg_temp.err($$ select public.adjust_batch('ba000000-0000-4000-8000-0000000000b2', 10001) $$),
  'P0001 count_invalid', 'a count above 10000 is refused');
select is(pg_temp.err($$ select public.adjust_batch('ba000000-0000-4000-8000-0000000000b2', 1.23456) $$),
  'P0001 count_invalid', 'a count with 5 decimals is refused');
select is(pg_temp.err($$ select public.adjust_batch('ba000000-0000-4000-8000-0000000000b2', null) $$),
  'P0001 count_invalid', 'a null count is refused');
select is(pg_temp.err($$ select public.adjust_batch(gen_random_uuid(), 5) $$), 'P0002 batch_not_found',
  'an unknown batch -> P0002');
select is(pg_temp.err($$ select public.adjust_batch(null, 5) $$), 'P0002 batch_not_found', 'a null batch -> P0002');
select is(pg_temp.nmoves('ba000000-0000-4000-8000-0000000000b2'), 4::bigint, 'the refusals wrote nothing');

-- AT4 (adjust): to 0 -> finished, then back to 2 -> open
insert into res select 'a4', public.adjust_batch('ba000000-0000-4000-8000-0000000000b2', 0);
select is((select j->>'state' from res where k = 'a4'), 'finished', 'AT4: a count of 0 -> finished');
select is(pg_temp.st('ba000000-0000-4000-8000-0000000000b2'), 'finished', 'AT4: the row says finished');
insert into res select 'a5', public.adjust_batch('ba000000-0000-4000-8000-0000000000b2', 0);
select is((select j->>'state' || '/' || coalesce(j->>'movementId', 'none') from res where k = 'a5'), 'finished/none',
  'a repeated count of 0 stays finished and writes nothing');
insert into res select 'a6', public.adjust_batch('ba000000-0000-4000-8000-0000000000b2', 2);
select is((select j->>'state' from res where k = 'a6'), 'open', 'a count of 2 on a finished batch reopens it (the food was found)');

-- discard_batch (AT2 movement, AT4) --------------------------------------------------------------------------
insert into res select 'd1', public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 3, 'spoilage');
select is((select (j->>'portionsRemaining')::numeric from res where k = 'd1'), 7::numeric, 'AT2: discard 3 of 10 -> 7 remain');
select is((select j->>'state' from res where k = 'd1'), 'open', 'AT2: state open');
select is((select j->>'reasonCode' from res where k = 'd1'), 'spoilage', 'AT2: the reason is echoed');
select is((select (j->>'portions')::numeric from res where k = 'd1'), 3::numeric, 'AT2: the portions are echoed (positive)');
select is((select count(*)::int || '/' || min(m.portions) || '/' || min(m.reason_code) || '/' || min(m.ref_type) || '/'
             || min(m.created_by::text) || '/' || (min(m.id::text) = (select j->>'movementId' from res where k = 'd1'))::text
             from public.batch_movement m where m.batch_id = 'ba000000-0000-4000-8000-0000000000b1' and m.type = 'waste'),
  '1/-3.0000/spoilage/batch_discard/c1000000-0000-4000-8000-00000000000c/true',
  'AT2: one waste row of -3, reason spoilage, ref batch_discard, written by the chef');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 1, 'count_correction') $$),
  'P0001 reason_invalid', 'count_correction is not a batch reason');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 1, 'foo') $$),
  'P0001 reason_invalid', 'an unknown reason is refused');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 1, null) $$),
  'P0001 reason_invalid', 'a null reason is refused');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 8, 'spoilage') $$),
  'P0001 portions_insufficient', '8 when 7 remain -> portions_insufficient');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 0, 'spoilage') $$),
  'P0001 portions_invalid', '0 portions -> portions_invalid');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b1', -1, 'spoilage') $$),
  'P0001 portions_invalid', '-1 portions -> portions_invalid');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 1.23456, 'spoilage') $$),
  'P0001 portions_invalid', '5 decimals -> portions_invalid');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b1', null, 'spoilage') $$),
  'P0001 portions_invalid', 'null portions -> portions_invalid');
select is(pg_temp.err($$ select public.discard_batch(gen_random_uuid(), 1, 'spoilage') $$), 'P0002 batch_not_found',
  'an unknown batch -> P0002');
select is(pg_temp.nmoves('ba000000-0000-4000-8000-0000000000b1'), 2::bigint, 'the refusals wrote nothing');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000b1'), 7::numeric, 'and 7 still remain');

-- Every reason of the list is accepted
select is_empty(
  $$ select r from unnest(array['expired', 'over_production', 'plating_error', 'staff_meal', 'comp', 'breakage']) r
      where pg_temp.err(format('select public.discard_batch(%L, 0.5, %L)', 'ba000000-0000-4000-8000-0000000000b1', r)) <> 'ok' $$,
  'the other six reasons are accepted');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000b1'), 4::numeric, 'and six times 0.5 left 4 (7 - 3)');
insert into res select 'd2', public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 4, 'expired');
select is((select j->>'state' from res where k = 'd2'), 'discarded', 'AT4: discarding the remaining portions -> discarded');
select is(pg_temp.st('ba000000-0000-4000-8000-0000000000b1'), 'discarded', 'AT4: the row says discarded');
select is(pg_temp.err($$ select public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 1, 'spoilage') $$),
  'P0001 portions_insufficient', 'a discard on a discarded batch -> portions_insufficient');

-- No value, cost or price in any answer ------------------------------------------------------------------------
select is_empty(
  $$ select kk.k from res r, lateral pg_temp.keys(r.j) kk (k) where kk.k ~* '(eur|cost|price|value|amount)' $$,
  'no answer carries a key that looks like a value, a cost or a price');
select is((select array_agg(kk.k order by kk.k) from pg_temp.keys((select j from res where k = 'a1')) kk (k)),
  array['batchId', 'delta', 'movementId', 'portionsRemaining', 'state'], 'adjust_batch answers exactly its five keys');
select is((select array_agg(kk.k order by kk.k) from pg_temp.keys((select j from res where k = 'd1')) kk (k)),
  array['batchId', 'movementId', 'portions', 'portionsRemaining', 'reasonCode', 'state'],
  'discard_batch answers exactly its six keys');

reset role;
select is(pg_temp.nmoves('ba000000-0000-4000-8000-0000000000b3'), 1::bigint,
  'the waiter and tenant B cases wrote nothing (only the produce row)');
select * from finish();
rollback;
