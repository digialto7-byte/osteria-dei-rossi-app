-- M0 acceptance test 2: every table in `public` has RLS enabled, a tenant_id column and at least
-- one policy. New tables in later milestones are covered automatically.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select isnt_empty(
  $$ select 1 from pg_tables where schemaname = 'public' $$,
  'public has tables to check'
);

select is_empty(
  $$ select c.relname::text
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'every public table has row level security enabled'
);

select is_empty(
  $$ select t.tablename::text
       from pg_tables t
      where t.schemaname = 'public'
        and not exists (
          select 1 from information_schema.columns col
           where col.table_schema = 'public'
             and col.table_name = t.tablename
             and col.column_name = 'tenant_id'
             and col.is_nullable = 'NO'
        ) $$,
  'every public table has a non-null tenant_id column'
);

select is_empty(
  $$ select t.tablename::text
       from pg_tables t
      where t.schemaname = 'public'
        and not exists (
          select 1 from pg_policies p
           where p.schemaname = 'public' and p.tablename = t.tablename
        ) $$,
  'every public table has at least one policy'
);

select is_empty(
  $$ select c.relname::text
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and (has_table_privilege('authenticated', c.oid, 'delete')
             or has_table_privilege('authenticated', c.oid, 'truncate')) $$,
  'no public table can be deleted from or truncated by authenticated users'
);

select is_empty(
  $$ select c.relname::text
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
        and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate')
             or has_any_column_privilege('anon', c.oid, 'select, insert, update')) $$,
  'anon has no privilege on any public table or view'
);

select * from finish();
rollback;
