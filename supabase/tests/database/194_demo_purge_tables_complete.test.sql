-- Demo data step 4 (ADR-018, plan §3.9): app.demo_purge_tables() lists every public table that has a tenant_id column, once,
-- and nothing else. A milestone that adds a tenant table must add it to the list (in delete order, in a migration of its own);
-- until then this test fails, and so does a purge (a foreign key from the new table to the tenant or its users).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is_empty(
  $$ select c.table_name::text
       from information_schema.columns c
       join pg_tables t on t.schemaname = c.table_schema and t.tablename = c.table_name
      where c.table_schema = 'public' and c.column_name = 'tenant_id'
        and c.table_name <> all (app.demo_purge_tables()) $$,
  'every public table with a tenant_id column is in the purge list');

select is_empty(
  $$ select n::text from unnest(app.demo_purge_tables()) n
      where not exists (select 1 from information_schema.columns c
                         where c.table_schema = 'public' and c.table_name = n and c.column_name = 'tenant_id') $$,
  'every name in the list is a public table with a tenant_id column');

select is((select count(*)::int from unnest(app.demo_purge_tables())), (select count(distinct n)::int from unnest(app.demo_purge_tables()) n), 'the list has no duplicates');

select is((select array_agg(c.table_name::text order by c.table_name) from information_schema.columns c
            where c.table_schema = 'app' and c.column_name = 'tenant_id'),
          array['alert_refusal', 'demo_purge_log', 'demo_state'], 'the only tables in schema app with a tenant_id are alert_refusal and demo_state (both purged) and demo_purge_log (the record of every purge)');

select is((select array_agg(c.table_name::text order by c.table_name) from information_schema.columns c
            where c.table_schema = 'app' and c.column_name = 'tenant_id' and c.table_name not in ('demo_purge_log', 'demo_state')),
          array['alert_refusal'], 'and the counts and the purge treat alert_refusal as the one extra table (demo_state is deleted by the purge itself)');

select is(app.demo_tenant_counts('00000000-0000-0000-0000-000000000000') ? 'alert_refusal', true, 'demo_tenant_counts covers alert_refusal');
select is((select count(*)::int from jsonb_object_keys(app.demo_tenant_counts('00000000-0000-0000-0000-000000000000'))),
          cardinality(app.demo_purge_tables()) + 1, 'and every listed table, nothing more');

select * from finish();
rollback;
