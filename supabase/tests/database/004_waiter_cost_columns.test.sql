-- M0 acceptance test 10: no column a waiter can read has a cost-like name. Every public table
-- and view gets fixture rows (extend the fixture below when a milestone adds a table); the test
-- then collects the columns of every relation where a waiter sees at least one row.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

-- Fixture: one tenant with a waiter. Later milestones add rows for their own tables here.
insert into auth.users (id, email)
  values ('c0000000-0000-4000-8000-00000000000c', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number)
  values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (tenant_id, auth_id, role, display_name)
  values ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c',
          'waiter', 'Cameriere A');

-- Every public table must have a fixture row, so a new table cannot slip past this test.
select is_empty(
  $$ select t.tablename::text from pg_tables t
      where t.schemaname = 'public'
        and (xpath('/row/c/text()',
               query_to_xml(format('select count(*) as c from public.%I', t.tablename),
                            false, true, '')))[1]::text::int = 0 $$,
  'every public table has a fixture row (extend the fixture when adding a table)');

create temporary table waiter_visible_column (relation text, column_name text);
grant insert on waiter_visible_column to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'c0000000-0000-4000-8000-00000000000c', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter')::text, true);

do $$
declare
  rel record;
  visible_rows bigint;
begin
  for rel in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm')
       and has_table_privilege('authenticated', c.oid, 'select')
  loop
    execute format('select count(*) from public.%I', rel.relname) into visible_rows;
    if visible_rows > 0 then
      insert into waiter_visible_column
        select rel.relname, a.attname
          from pg_attribute a
         where a.attrelid = format('public.%I', rel.relname)::regclass
           and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select');
    end if;
  end loop;
end
$$;

reset role;

select isnt_empty(
  $$ select 1 from waiter_visible_column $$,
  'the fixture makes some rows visible to the waiter (the test is not vacuous)');

select is_empty(
  $$ select relation || '.' || column_name
       from waiter_visible_column
      where column_name ~* '(cost|margin|unit_price|total_cost|price_history|gp_pct)' $$,
  'no waiter-readable column has a cost-like name');

select * from finish();
rollback;
