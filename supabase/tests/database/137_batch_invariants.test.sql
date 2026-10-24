-- M15 step 8: the three batch checks of the nightly invariant check (M15 plan §3.1.10; ADR-014; M13 plan §3.1.10):
--   batch_origin      a batch without exactly one origin movement equal to portions_initial
--   split_unbalanced  a batch_split operation that is not two rows summing to 0 between a parent and its child
--   batch_state       finished/discarded that does not match remaining <= 0, or fresh with more than its origin
-- The runner is called with a fixed instant over a clean fixture built with the real procedures; each inconsistency is
-- seeded as the migration owner in a savepoint and rolled back afterwards. pgTAP 117 runs unchanged. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Congelatore (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'brodo b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d2', '22222222-2222-4222-8222-222222222222',
   'ec000000-0000-4000-8000-0000000000e2', 1, '2026-10-01T00:00Z', 'Brodo B (demo)', 2, 'kg', 10, 48, 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text) to authenticated;
create sequence pg_temp.seq;
-- A batch of tenant A or B: p_initial portions at production, its origin movement of p_origin (null = none),
-- optionally a child (p_parent) whose origin is then an inbound split from the parent, and a state.
create function pg_temp.mkb(p_id uuid, p_initial int, p_origin numeric, p_state text default 'fresh',
    p_tenant text default 'a', p_parent uuid default null, p_origin_ref uuid default null) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.seq');
  v_t uuid := case p_tenant when 'a' then '11111111-1111-4111-8111-111111111111' else '22222222-2222-4222-8222-222222222222' end;
  v_u uuid := case p_tenant when 'a' then 'a1000000-0000-4000-8000-00000000000a' else 'b1000000-0000-4000-8000-00000000000b' end;
  v_key uuid := case p_tenant when 'a' then 'ec000000-0000-4000-8000-0000000000e1' else 'ec000000-0000-4000-8000-0000000000e2' end;
  v_rec uuid := case p_tenant when 'a' then 'ed000000-0000-4000-8000-0000000000d1' else 'ed000000-0000-4000-8000-0000000000d2' end;
  v_loc uuid := case p_tenant when 'a' then '10000000-0000-4000-8000-0000000000a1' else '10000000-0000-4000-8000-0000000000b1' end;
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq,
      produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by,
      state, location_id, split_from_batch_id, created_by)
    values (p_id, v_t, v_key, v_rec, 1, '261001-INV' || upper(p_tenant) || '-' || v_n, '2026-10-01', 'INV' || upper(p_tenant), v_n,
      '2026-10-01T08:00Z', v_u, 2, 'kg', p_initial, p_initial, 48, '2026-10-03T08:00Z', p_state::public.batch_state, v_loc,
      p_parent, v_u);
  if p_origin is not null then
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
      values (v_t, p_id, case when p_parent is null then 'produce' else 'split' end::public.batch_movement_type, p_origin,
              case when p_parent is null then 'batch' else 'batch_split' end, coalesce(p_origin_ref, p_id), '2026-10-01', v_u);
  end if;
end
$$;
create function pg_temp.mvr(p_batch uuid, p_type text, p_portions numeric, p_ref_type text, p_ref uuid, p_reason text default null)
  returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_batch, p_type::public.batch_movement_type, p_portions, p_reason, p_ref_type,
      p_ref, '2026-10-01', 'a1000000-0000-4000-8000-00000000000a')
$$;

-- Helpers as in 117 --------------------------------------------------------------------------------------------
create function pg_temp.pat() returns timestamptz language sql as $$ select '2027-06-15T02:45:00Z'::timestamptz $$;
create function pg_temp.runs(p_job text, p_ago interval) returns void language sql as $$
  insert into app.job_run (job, started_at, finished_at, ok, error_code, items)
    values (p_job, pg_temp.pat() - p_ago, pg_temp.pat() - p_ago + interval '1 minute', true, null, 0)
$$;
create function pg_temp.healthy() returns void language plpgsql as $$
begin
  delete from app.job_run;
  perform pg_temp.runs('extract', interval '48 hours');
  perform pg_temp.runs('alert-rules', interval '1 hour');
  perform pg_temp.runs('ledger-invariants', interval '24 hours');
end
$$;
create function pg_temp.go() returns integer language sql as $$ select app.run_ledger_invariants(pg_temp.pat()) $$;
create function pg_temp.n_alerts(p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns bigint language sql as $$
  select count(*) from public.alert where kind = 'ledger_drift' and tenant_id = p_tenant
$$;
create function pg_temp.summary(p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns text language sql as $$
  select coalesce(string_agg(c->>'check_key' || ':' || (c->>'rows_count'), ',' order by c->>'check_key'), '-')
    from public.alert a cross join lateral jsonb_array_elements(a.payload->'checks') c
   where a.kind = 'ledger_drift' and a.tenant_id = p_tenant
$$;
-- One run: alerts of A | summary of A | alerts of B | summary of B.
create function pg_temp.case_() returns text language plpgsql as $$
begin
  perform pg_temp.go();
  return pg_temp.n_alerts() || '|' || pg_temp.summary() || '|' || pg_temp.n_alerts('22222222-2222-4222-8222-222222222222')
    || '|' || pg_temp.summary('22222222-2222-4222-8222-222222222222');
end
$$;

-- The clean fixture, through the real procedures ----------------------------------------------------------------
-- R: Ragù made an hour ago, 10 portions, frozen cost 2.00 per portion.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq,
    produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by,
    state, location_id, created_by)
  values ('ba000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111',
    'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1,
    to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-RAGUDE-1', (now() at time zone 'Europe/Rome')::date,
    'RAGUDE', 1, now() - interval '1 hour', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 10, 10, 48,
    now() - interval '1 hour' + interval '48 hours', 'fresh', '10000000-0000-4000-8000-0000000000a1',
    'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'produce', 10, 'batch',
    'ba000000-0000-4000-8000-0000000000b1', (now() at time zone 'Europe/Rome')::date, 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
  values ('ba000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 20, 2, false, '{}', now(),
          'a1000000-0000-4000-8000-00000000000a');
create temporary table res (k text primary key, j jsonb);
grant all on res to authenticated;
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into res select 'f1', public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 3, 'spoilage');
insert into res select 'f2', public.adjust_batch('ba000000-0000-4000-8000-0000000000b1', 6);
insert into res select 'f3', public.split_batch('ba000000-0000-4000-8000-0000000000b1', 2, 100, '10000000-0000-4000-8000-0000000000a2');
insert into res select 'f4', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e1', null, 1);
insert into res select 'f5', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'f4'));
reset role;
select pg_temp.healthy();

select is((select string_agg(b.state::text, ',' order by b.lot_seq) from public.batch b), 'open,fresh',
  'fixture: the parent is open and the split part is fresh');

-- Clean ---------------------------------------------------------------------------------------------------------
savepoint clean;
select is(pg_temp.case_(), '0|-|0|-', 'clean: produce, discard, count, split and a staff meal raise no finding');
select is((select ok::text || ' ' || items::text from app.job_run where job = 'ledger-invariants' order by id desc limit 1),
  'true 0', '... and the run is recorded ok with 0 items');
rollback to savepoint clean;

-- batch_origin --------------------------------------------------------------------------------------------------
savepoint o1;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000c1', 10, 9);
select is(pg_temp.case_(), '1|batch_origin:1|0|-', 'a produce of 9 for 10 portions at production: batch_origin');
rollback to savepoint o1;

savepoint o2;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000c2', 10, null);
select is(pg_temp.case_(), '1|batch_origin:1,batch_state:1|0|-',
  'a batch without any movement: batch_origin, and batch_state (fresh with nothing left)');
rollback to savepoint o2;

savepoint o3;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000c3', 4, null, 'fresh', 'a', 'ba000000-0000-4000-8000-0000000000b1');
select pg_temp.mvr('ba000000-0000-4000-8000-0000000000c3', 'produce', 4, 'batch', 'ba000000-0000-4000-8000-0000000000c3');
select is(pg_temp.case_(), '1|batch_origin:1|0|-', 'a split part with a produce instead of its inbound split: batch_origin');
rollback to savepoint o3;

-- split_unbalanced ------------------------------------------------------------------------------------------------
savepoint s1;
select pg_temp.mvr('ba000000-0000-4000-8000-0000000000b1', 'split', -1, 'batch_split', gen_random_uuid());
select is(pg_temp.case_(), '1|split_unbalanced:1|0|-', 'a split operation with one row only: split_unbalanced');
rollback to savepoint s1;

savepoint s2;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000c5', 10, 10, 'open');
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000c6', 4, 4, 'fresh', 'a', 'ba000000-0000-4000-8000-0000000000c5',
  'ba000000-0000-4000-8000-0000000000c6');
select pg_temp.mvr('ba000000-0000-4000-8000-0000000000c5', 'split', -3, 'batch_split', 'ba000000-0000-4000-8000-0000000000c6');
select is(pg_temp.case_(), '1|split_unbalanced:1|0|-', 'a pair of +4 and -3: split_unbalanced');
rollback to savepoint s2;

savepoint s4;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000c8', 4, 4, 'fresh', 'a', 'ba000000-0000-4000-8000-0000000000b1',
  'ba000000-0000-4000-8000-0000000000c8');
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000c9', 10, 10, 'open');
select pg_temp.mvr('ba000000-0000-4000-8000-0000000000c9', 'split', -4, 'batch_split', 'ba000000-0000-4000-8000-0000000000c8');
select is(pg_temp.case_(), '1|split_unbalanced:1|0|-',
  'a pair between two batches that are not parent and child: split_unbalanced');
rollback to savepoint s4;

-- batch_state ----------------------------------------------------------------------------------------------------
savepoint t1;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000d1', 10, 10, 'open');
select pg_temp.mvr('ba000000-0000-4000-8000-0000000000d1', 'count', -10, 'batch_adjust', gen_random_uuid());
select is(pg_temp.case_(), '1|batch_state:1|0|-', 'remaining 0 but the state is open: batch_state');
rollback to savepoint t1;

savepoint t2;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000d2', 10, 10, 'fresh');
select pg_temp.mvr('ba000000-0000-4000-8000-0000000000d2', 'waste', -1, 'batch_discard', gen_random_uuid(), 'spoilage');
select is(pg_temp.case_(), '1|batch_state:1|0|-', 'fresh with a discard: batch_state');
rollback to savepoint t2;

savepoint t3;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000d3', 10, 10, 'finished');
select is(pg_temp.case_(), '1|batch_state:1|0|-', 'finished with 10 portions left: batch_state');
rollback to savepoint t3;

savepoint t4;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000d4', 10, 10, 'discarded');
select pg_temp.mvr('ba000000-0000-4000-8000-0000000000d4', 'waste', -10, 'batch_discard', gen_random_uuid(), 'expired');
select is(pg_temp.case_(), '0|-|0|-', 'a discarded batch at 0 portions is consistent');
rollback to savepoint t4;

savepoint t5;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000d5', 10, 10, 'finished');
select pg_temp.mvr('ba000000-0000-4000-8000-0000000000d5', 'count', -12, 'batch_adjust', gen_random_uuid());
select is(pg_temp.case_(), '0|-|0|-', 'a finished batch below 0 (M19 may do that) is not a finding');
rollback to savepoint t5;

-- Several at once, one alert; another tenant -----------------------------------------------------------------------
savepoint m1;
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000e1', 10, 9);
select pg_temp.mkb('ba000000-0000-4000-8000-0000000000e2', 10, 10, 'open');
select pg_temp.mvr('ba000000-0000-4000-8000-0000000000e2', 'count', -10, 'batch_adjust', gen_random_uuid());
select pg_temp.mvr('ba000000-0000-4000-8000-0000000000b1', 'split', -1, 'batch_split', gen_random_uuid());
select is(pg_temp.case_(), '1|batch_origin:1,batch_state:1,split_unbalanced:1|0|-', 'three kinds at once: one alert listing all three');
rollback to savepoint m1;

savepoint m2;
select pg_temp.mkb('bb000000-0000-4000-8000-0000000000e1', 10, 9, 'fresh', 'b');
select is(pg_temp.case_(), '0|-|1|batch_origin:1', 'a bad batch of tenant B is reported to B only');
rollback to savepoint m2;

-- Shape of the body ---------------------------------------------------------------------------------------------
select is((select length(p.prosrc) - length(replace(p.prosrc, ';', '')) from pg_proc p
            where p.oid = 'app.ledger_checks_body(uuid, timestamptz)'::regprocedure), 1,
  'the ledger checks are still one statement');
select ok((select p.prosrc ~ '^\s*(#variable_conflict use_column\s+)?begin\s+return query' from pg_proc p
            where p.oid = 'app.ledger_checks_body(uuid, timestamptz)'::regprocedure), '... a single return query');
select is_empty(
  $$ select k from unnest(array['lot_receipt_missing', 'receipt_lot_mismatch', 'movement_user', 'lot_negative', 'reversal_mirror',
                               'transfer_unbalanced', 'count_mismatch', 'batch_origin', 'split_unbalanced', 'batch_state']) k
      where (select p.prosrc from pg_proc p where p.oid = 'app.ledger_checks_body(uuid, timestamptz)'::regprocedure) not like '%''' || k || '''%' $$,
  'every M13 check and the three batch checks are in the body');

select * from finish();
rollback;
