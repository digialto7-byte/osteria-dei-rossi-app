-- M15 step 2: the helpers in schema app (M15 plan §3.1.5, §3.1.8, §3.1.12, §3.2; ADR-014): the business date over the
-- M11 cut-off helpers (DST-safe, independent of the session time zone), the batch row locks, the remaining portions
-- (volatile) and the single writer of batch.state. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1,
   'ragu (demo)', 'c1000000-0000-4000-8000-00000000000c');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Ragù (demo)', 2, 'kg', 10, 48,
   'c1000000-0000-4000-8000-00000000000c');

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
-- A batch of tenant A with its produce movement of 10 portions.
create function pg_temp.mkbatch(p_id uuid, p_seq int) returns void language plpgsql as $$
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1',
      'ed000000-0000-4000-8000-0000000000d1', 1, '261023-RAGUDE-' || p_seq, '2026-10-23', 'RAGUDE', p_seq,
      '2026-10-23T08:00Z', 'c1000000-0000-4000-8000-00000000000c', 2, 'kg', 10, 10, 48, '2026-10-25T08:00Z',
      '10000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-00000000000c');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, 'produce', 10, 'batch', p_id, '2026-10-23',
      'c1000000-0000-4000-8000-00000000000c');
end
$$;
create function pg_temp.mv(p_batch uuid, p_type text, p_portions numeric, p_ref_type text, p_reason text default null)
  returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on,
      created_by)
    values ('11111111-1111-4111-8111-111111111111', p_batch, p_type::public.batch_movement_type, p_portions, p_reason,
      p_ref_type, gen_random_uuid(), '2026-10-23', 'c1000000-0000-4000-8000-00000000000c')
$$;
create function pg_temp.st(p_batch uuid) returns text language sql as $$
  select state::text from public.batch where id = p_batch
$$;

-- business_date -------------------------------------------------------------------------------------------
-- Cut-off 02:00 (the default), venue time zone Europe/Rome.
create temporary table bd (at timestamptz, want date, what text);
insert into bd values
  ('2026-10-24T21:00Z', '2026-10-24', '23:00 on the 24th counts for the 24th'),
  ('2026-10-24T23:30Z', '2026-10-24', '01:30 on the 25th counts for the 24th'),
  ('2026-10-25T00:30Z', '2026-10-25', 'DST end, 02:30 CEST (before the change) counts for the 25th'),
  ('2026-10-25T01:30Z', '2026-10-25', 'DST end, 02:30 CET (after the change) counts for the 25th'),
  ('2026-10-25T00:00Z', '2026-10-25', 'DST end, 02:00 CEST exactly is the new day'),
  ('2026-10-25T23:30Z', '2026-10-25', 'the day after the change: 00:30 on the 26th counts for the 25th'),
  ('2027-03-28T00:30Z', '2027-03-27', 'DST start, 01:30 CET counts for the previous day'),
  ('2027-03-28T01:00Z', '2027-03-28', 'DST start, 03:00 CEST (the jump) counts for the 28th'),
  ('2026-10-24T22:00Z', '2026-10-24', '00:00 on the 25th counts for the 24th');

select is(app.business_date('11111111-1111-4111-8111-111111111111', bd.at), bd.want, bd.what) from bd order by bd.at;

-- The same results under another session time zone.
set local timezone = 'America/New_York';
select is_empty(
  $$ select bd.what from bd where app.business_date('11111111-1111-4111-8111-111111111111', bd.at) <> bd.want $$,
  'business_date gives the same result under the session time zone America/New_York');
set local timezone = 'Europe/Rome';
select is_empty(
  $$ select bd.what from bd where app.business_date('11111111-1111-4111-8111-111111111111', bd.at) <> bd.want $$,
  'business_date gives the same result under the session time zone Europe/Rome');
set local timezone = 'UTC';

-- A tenant cut-off of 04:00 moves 03:00 to the previous day.
update public.tenant set settings = jsonb_build_object('business_day_cutoff', '04:00')
 where id = '22222222-2222-4222-8222-222222222222';
select is(app.business_date('22222222-2222-4222-8222-222222222222', '2026-10-24T01:00Z'), '2026-10-23'::date,
  'cut-off 04:00: 03:00 CEST on the 24th counts for the 23rd');
select is(app.business_date('22222222-2222-4222-8222-222222222222', '2026-10-24T02:00Z'), '2026-10-24'::date,
  'cut-off 04:00: 04:00 CEST on the 24th counts for the 24th');
select is(app.business_date('11111111-1111-4111-8111-111111111111', '2026-10-24T01:00Z'), '2026-10-24'::date,
  'the default cut-off of tenant A is unchanged (03:00 CEST counts for the 24th)');
select is(pg_temp.err($$ select app.business_date(gen_random_uuid(), now()) $$), 'P0002 tenant_not_found',
  'an unknown tenant is refused');

-- batch_remaining and batch_settle_state --------------------------------------------------------------------
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', 1);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b2', 2);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b3', 3);

select is(app.batch_remaining('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1'),
  10::numeric, 'batch_remaining folds the produce movement (10)');
select is(app.batch_remaining('11111111-1111-4111-8111-111111111111', gen_random_uuid()), 0::numeric,
  'an unknown batch has 0 remaining');
select is(app.batch_remaining('22222222-2222-4222-8222-222222222222', 'ba000000-0000-4000-8000-0000000000b1'),
  0::numeric, 'another tenant sees 0 remaining for the batch');
select is((select p.provolatile::text from pg_proc p
            where p.proname = 'batch_remaining' and p.pronamespace = 'app'::regnamespace), 'v',
  'batch_remaining is volatile (a fresh snapshot after the row lock, T2)');

select is(pg_temp.st('ba000000-0000-4000-8000-0000000000b1'), 'fresh', 'a new batch is fresh');
select is(app.batch_settle_state('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'adjust')::text,
  'open', 'remaining 10 after a settle -> open (the batch was touched)');
select pg_temp.mv('ba000000-0000-4000-8000-0000000000b1', 'count', -4, 'batch_adjust');
select is(app.batch_settle_state('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'adjust')::text,
  'open', 'remaining 6 after a count -> open');
select is(pg_temp.st('ba000000-0000-4000-8000-0000000000b1'), 'open', 'and the row says open');
select pg_temp.mv('ba000000-0000-4000-8000-0000000000b1', 'count', -6, 'batch_adjust');
select is(app.batch_settle_state('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'adjust')::text,
  'finished', 'remaining 0 by a count -> finished');
select is(pg_temp.st('ba000000-0000-4000-8000-0000000000b1'), 'finished', 'and the row says finished');
select pg_temp.mv('ba000000-0000-4000-8000-0000000000b1', 'count', 2, 'batch_adjust');
select is(app.batch_settle_state('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'adjust')::text,
  'open', 'finished + a count of +2 -> open again');

select pg_temp.mv('ba000000-0000-4000-8000-0000000000b2', 'waste', -10, 'batch_discard', 'spoilage');
select is(app.batch_settle_state('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b2', 'discard')::text,
  'discarded', 'remaining 0 by a discard -> discarded');
select is(app.batch_settle_state('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b2', 'adjust')::text,
  'discarded', 'a discarded batch settled again by another cause stays discarded');
select pg_temp.mv('ba000000-0000-4000-8000-0000000000b2', 'count', 2, 'batch_adjust');
select is(app.batch_settle_state('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b2', 'adjust')::text,
  'open', 'discarded + a count of +2 -> open');
select pg_temp.mv('ba000000-0000-4000-8000-0000000000b2', 'count', -2, 'batch_adjust');
select is(app.batch_settle_state('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b2', 'adjust')::text,
  'finished', 'and counted back to 0 -> finished (not discarded)');

-- No update when the state does not change: the row version stays.
create temporary table xm (x xid);
insert into xm select xmin from public.batch where id = 'ba000000-0000-4000-8000-0000000000b1';
do $$ begin perform app.batch_settle_state('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'adjust'); end $$;
select is((select b.xmin = xm.x from public.batch b, xm where b.id = 'ba000000-0000-4000-8000-0000000000b1'), true,
  'an unchanged state writes nothing (xmin unchanged)');
select is(pg_temp.err($$ select app.batch_settle_state('11111111-1111-4111-8111-111111111111', gen_random_uuid(), 'adjust') $$),
  'P0002 batch_not_found', 'an unknown batch is refused');
select is(pg_temp.err($$ select app.batch_settle_state('22222222-2222-4222-8222-222222222222',
    'ba000000-0000-4000-8000-0000000000b1', 'adjust') $$),
  'P0002 batch_not_found', 'a batch of another tenant is refused');
select is(pg_temp.err($$ select app.batch_settle_state('11111111-1111-4111-8111-111111111111',
    'ba000000-0000-4000-8000-0000000000b1', 'foo') $$),
  'P0001 cause_invalid', 'a cause other than discard, adjust, split, staff_meal and consume is refused');

-- lock_batch_rows -------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select app.lock_batch_rows('11111111-1111-4111-8111-111111111111', array[gen_random_uuid()]) $$),
  'P0002 batch_not_found', 'a single unknown id is refused');
select is(pg_temp.err($$ select app.lock_batch_rows('22222222-2222-4222-8222-222222222222',
    array['ba000000-0000-4000-8000-0000000000b1']::uuid[]) $$),
  'P0002 batch_not_found', 'a single id of another tenant is refused');
select is(pg_temp.err($$ select app.lock_batch_rows('11111111-1111-4111-8111-111111111111',
    array['ba000000-0000-4000-8000-0000000000b3', gen_random_uuid()]::uuid[]) $$), 'ok',
  'several ids may include unknown ones (the caller derived them from a query)');
-- Row locks never show in pg_locks, and a lock taken here cannot be told from the key-share locks the foreign keys
-- take; the blocking itself is proved by the two-session race cases (step 10). Here: the statement locks in id order.
select ok(position('order by b.id' in p.prosrc) > 0
    and position('for update' in substr(p.prosrc, position('order by b.id' in p.prosrc))) > 0,
  'lock_batch_rows selects the rows in id order and locks them (for update)')
  from pg_proc p where p.proname = 'lock_batch_rows' and p.pronamespace = 'app'::regnamespace;

-- Closed to every API role ---------------------------------------------------------------------------------
select is_empty(
  $$ select p.proname || ':' || r from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
      where p.pronamespace = 'app'::regnamespace
        and p.proname in ('business_date', 'lock_batch_rows', 'batch_remaining', 'batch_settle_state')
        and has_function_privilege(r, p.oid, 'execute') $$,
  'no API role can execute any helper of this migration');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('business_date', 'lock_batch_rows', 'batch_remaining', 'batch_settle_state')), 4,
  'the four helpers exist, once each');
select is_empty(
  $$ select p.proname from pg_proc p
      where p.pronamespace = 'app'::regnamespace
        and p.proname in ('lock_batch_rows', 'batch_remaining', 'batch_settle_state', 'business_date')
        and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every helper has an empty search_path');

select * from finish();
rollback;
