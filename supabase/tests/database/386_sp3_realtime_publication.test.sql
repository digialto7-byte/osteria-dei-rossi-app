-- SP3 step 20 (plan section 3.10): the supabase_realtime publication holds zero tables, so there is nothing to signal to a console session.
-- A table joining it is a stop: the plan's variant V5 is drafted for that day. Skipped where the publication does not exist (the native test database).
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select case
  when exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    then is(
      (select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime'),
      0,
      'the supabase_realtime publication holds no table')
  else skip('the supabase_realtime publication does not exist here (native shim); the Supabase stack runs this check', 1)
end;

select * from finish();
rollback;
