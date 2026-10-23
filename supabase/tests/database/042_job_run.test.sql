-- M6 step 1 (migration 20261022150000_job_run.sql): app.job_run, its begin/end helpers and the
-- service-role wrappers. The table is outside `public` (a run spans tenants and has none) and no API
-- role can read or write it; only the definer functions touch it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

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
-- The row a run id points at, as text: job|finished?|ok|error_code|items.
create function pg_temp.run(p_id bigint) returns text language sql as $$
  select job || '|' || (finished_at is not null)::text || '|' || coalesce(ok::text, '-') || '|'
         || coalesce(error_code, '-') || '|' || coalesce(items::text, '-')
    from app.job_run where id = p_id
$$;
create temporary table ids (name text primary key, id bigint);

-- Start ---------------------------------------------------------------------------------------------
insert into ids select 'extract', public.job_run_start('extract');
select isnt((select id from ids where name = 'extract'), null, 'job_run_start returns an id');
select is(pg_temp.run((select id from ids where name = 'extract')), 'extract|false|-|-|-',
  'a started run has no end, no result and no item count');
select lives_ok($$ select public.job_run_start('alert-rules') $$, 'the alert-rules job is accepted');
select is(left(pg_temp.err($$ select public.job_run_start('dispatch-alerts') $$), 5), '23514',
  'dispatch-alerts is not a job (M6 sends nothing)');
select is(left(pg_temp.err($$ select public.job_run_start('foo') $$), 5), '23514', 'an unknown job is refused');

-- Finish --------------------------------------------------------------------------------------------
select lives_ok(format('select public.job_run_finish(%s, true, null, 1)', (select id from ids where name = 'extract')),
  'a run can be finished');
select is(pg_temp.run((select id from ids where name = 'extract')), 'extract|true|true|-|1',
  'finishing sets finished_at, ok and items');
select is(pg_temp.err(format('select public.job_run_finish(%s, true, null, 1)', (select id from ids where name = 'extract'))),
  'P0001 job_run_finished', 'a second finish is refused');
select is(pg_temp.run((select id from ids where name = 'extract')), 'extract|true|true|-|1',
  'and changes nothing');
select is(pg_temp.err('select public.job_run_finish(-1, true, null, 0)'), 'P0002 job_run_not_found',
  'an unknown run id is refused');

insert into ids select 'failed', public.job_run_start('extract');
select lives_ok(format('select public.job_run_finish(%s, false, ''config_missing'', 0)', (select id from ids where name = 'failed')),
  'a failed run records an error code');
select is(pg_temp.run((select id from ids where name = 'failed')), 'extract|true|false|config_missing|0',
  'the failure is stored');

insert into ids select 'bad_code', public.job_run_start('extract');
select is(left(pg_temp.err(format('select public.job_run_finish(%s, false, ''Bad Code'', 0)', (select id from ids where name = 'bad_code'))), 5),
  '23514', 'an error code must be lower-case words with underscores');
select is(left(pg_temp.err(format('select public.job_run_finish(%s, false, %L, 0)', (select id from ids where name = 'bad_code'), repeat('a', 41))), 5),
  '23514', 'an error code is at most 40 characters');
select is(left(pg_temp.err(format('select public.job_run_finish(%s, true, null, -1)', (select id from ids where name = 'bad_code'))), 5),
  '23514', 'items cannot be negative');
select is(left(pg_temp.err(format('select public.job_run_finish(%s, null, null, 0)', (select id from ids where name = 'bad_code'))), 5),
  '23514', 'a finished run must say whether it worked');
select is(pg_temp.run((select id from ids where name = 'bad_code')), 'extract|false|-|-|-',
  'the refused finishes left the run open');

select is(left(pg_temp.err($$ insert into app.job_run (job, finished_at) values ('extract', now()) $$), 5),
  '23514', 'finished_at without ok is refused');
select is(left(pg_temp.err($$ insert into app.job_run (job, ok) values ('extract', true) $$), 5),
  '23514', 'ok without finished_at is refused');

-- The app helpers -------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select app.job_run_end(app.job_run_begin('alert-rules'), true, null, 0) $$), 'ok',
  'the app helpers begin and end a run');

-- Latest --------------------------------------------------------------------------------------------
insert into ids select 'newest', public.job_run_start('extract');
select lives_ok(format('select public.job_run_finish(%s, true, null, 7)', (select id from ids where name = 'newest')),
  'the newest extract run is finished');
select is((select items from public.job_run_latest('extract')), 7, 'job_run_latest returns the newest run of the job');
select is((select count(*)::int from public.job_run_latest('extract')), 1, 'and only one row');
select is((select count(*)::int from public.job_run_latest('nothing-here')), 0, 'an unknown job has no latest run');

-- Privileges ----------------------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'app.job_run', 'select, insert, update, delete, truncate'),
  'authenticated has no privilege on app.job_run');
select ok(not has_table_privilege('service_role', 'app.job_run', 'select, insert, update, delete, truncate'),
  'service_role has no privilege on app.job_run');
select ok(not has_table_privilege('anon', 'app.job_run', 'select, insert, update, delete, truncate'),
  'anon has no privilege on app.job_run');
select ok((select relrowsecurity from pg_class where oid = 'app.job_run'::regclass),
  'app.job_run has row level security enabled');
select is((select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'job_run'), 0,
  'and no policy');
select ok(
  not (has_function_privilege('authenticated', 'public.job_run_start(text)', 'execute')
    or has_function_privilege('authenticated', 'public.job_run_finish(bigint, boolean, text, integer)', 'execute')
    or has_function_privilege('authenticated', 'public.job_run_latest(text)', 'execute')
    or has_function_privilege('anon', 'public.job_run_start(text)', 'execute')
    or has_function_privilege('anon', 'public.job_run_finish(bigint, boolean, text, integer)', 'execute')
    or has_function_privilege('anon', 'public.job_run_latest(text)', 'execute')),
  'authenticated and anon cannot execute the wrappers');
select ok(
  has_function_privilege('service_role', 'public.job_run_start(text)', 'execute')
  and has_function_privilege('service_role', 'public.job_run_finish(bigint, boolean, text, integer)', 'execute')
  and has_function_privilege('service_role', 'public.job_run_latest(text)', 'execute'),
  'service_role can execute the wrappers');
select ok(
  not (has_function_privilege('service_role', 'app.job_run_begin(text)', 'execute')
    or has_function_privilege('service_role', 'app.job_run_end(bigint, boolean, text, integer)', 'execute')
    or has_function_privilege('authenticated', 'app.job_run_begin(text)', 'execute')
    or has_function_privilege('authenticated', 'app.job_run_end(bigint, boolean, text, integer)', 'execute')),
  'the app helpers are not executable by an API role');

set local role authenticated;
select throws_ok($$ select public.job_run_start('extract') $$, '42501', null, 'authenticated cannot start a run');
reset role;
set local role anon;
select throws_ok($$ select public.job_run_start('extract') $$, '42501', null, 'anon cannot start a run');
reset role;
set local role service_role;
select lives_ok($$ select public.job_run_start('extract') $$, 'service_role can start a run');

select * from finish();
rollback;
