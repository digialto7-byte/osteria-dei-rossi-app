-- SP1 step 2 (docs/plans/2026-11-15-sp01-tenant-config.md §5 step 2; platform plan §6.5 rule 4): X, the cross-tenant suite on the
-- multi-venue fixture. "Osteria Demo A" has a coperto, "Osteria Demo B" has none; both have rows, owners on example.test, fake data only.
-- A catalogue loop covers EVERY table of `public` that has a tenant_id column (so a table added by a later milestone is covered
-- without editing this file):
--   * read: as B's owner (role authenticated, B's claims) `select count(*) ... where tenant_id = A` is 0, or the read is denied (42501);
--   * write: as B's owner an insert that names A's tenant_id is refused with 42501 (no grant, or the row level security check).
-- Controls so the loop is not vacuous: A holds rows in many tables, and B's owner reads its own rows in several.
-- The proof that the loop can fail is the mutation block: a temporary policy that lets B read A must make the loop report that table.
-- Later SP1 steps add rows to the fixture (B's sale list [10, 22] from step 3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{"sale_vat_pct": 10}'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"sale_vat_pct": 22}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A Demo');

-- A: menu with two prices, coperto 2,50 at 10 %, two tables, an open session, a fired line, a day_close entry.
insert into public.menu_item (id, tenant_id, name, category, course_default, position, created_by, updated_by) values
  ('31000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('32000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Acqua B (demo)', 'Bevande', 'bevande', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000001', 14.00, 10, '2026-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('22222222-2222-4222-8222-222222222222', '32000000-0000-4000-8000-000000000001', 2.00, 22, '2026-01-01 00:00+00', 'b1000000-0000-4000-8000-00000000000b');
insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 2.50, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('22222222-2222-4222-8222-222222222222', null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('33000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('43000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('34000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '33000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 3,
          '2026-01-02 19:00+00', 'd1000000-0000-4000-8000-00000000000d', '2026-01-02', 2.50, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  values ('35000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
          'secondi', 2, 14.00, 10, 'menu', '2026-01-02 20:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
          '2026-01-02 20:01+00', 'd1000000-0000-4000-8000-00000000000d');
insert into public.day_close (tenant_id, business_date, register_total, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2026-01-02', 33.00, 'a1000000-0000-4000-8000-00000000000a'),
         ('22222222-2222-4222-8222-222222222222', '2026-01-02', 2.00, 'b1000000-0000-4000-8000-00000000000b');

-- The loop. Runs as B's owner. Result: {tables, read_leaks, insert_leaks, odd_inserts, own_read_tables}.
--   read_leaks     tables where B's owner counted at least one row of A
--   insert_leaks   tables where B's owner could insert a row naming A's tenant_id
--   odd_inserts    tables where the insert failed with something other than 42501 (reported, so the rule stays exactly "42501")
--   own_read_tables  tables where B's owner reads at least one row of B (the control: the role is not simply denied everywhere)
create function pg_temp.loop_as_b(p_a uuid, p_b uuid, p_b_auth uuid) returns jsonb language plpgsql as $$
declare
  t text;
  n bigint;
  st text;
  v_tables int := 0;
  v_read_leaks text[] := '{}';
  v_insert_leaks text[] := '{}';
  v_odd text[] := '{}';
  v_own int := 0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_b_auth, 'role', 'authenticated', 'tenant_id', p_b,
                                                             'app_role', 'owner', 'aal', 'aal1')::text, true);
  set local role authenticated;
  for t in
    select c.relname::text from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind in ('r', 'p')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped)
     order by 1
  loop
    v_tables := v_tables + 1;
    begin
      execute format('select count(*) from public.%I where tenant_id = %L', t, p_a) into n;
      if n > 0 then v_read_leaks := v_read_leaks || t; end if;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('select count(*) from public.%I where tenant_id = %L', t, p_b) into n;
      if n > 0 then v_own := v_own + 1; end if;
    exception when insufficient_privilege then null;
    end;
    begin
      -- public.tenant is the one table whose tenant_id is a generated column of id: its insert names A's id.
      execute format('insert into public.%I (%I) values (%L)', t,
                     case when exists (select 1 from pg_attribute a where a.attrelid = ('public.' || quote_ident(t))::regclass and a.attname = 'tenant_id' and a.attgenerated <> '')
                          then 'id' else 'tenant_id' end, p_a);
      v_insert_leaks := v_insert_leaks || t;
    exception when others then
      get stacked diagnostics st = returned_sqlstate;
      if st <> '42501' then v_odd := v_odd || (t || ':' || st); end if;
    end;
  end loop;
  reset role;
  return jsonb_build_object('tables', v_tables, 'read_leaks', to_jsonb(v_read_leaks), 'insert_leaks', to_jsonb(v_insert_leaks),
                            'odd_inserts', to_jsonb(v_odd), 'own_read_tables', v_own);
end
$$;

-- Controls on the fixture itself.
select cmp_ok((select count(*)::int from information_schema.tables t where t.table_schema = 'public'
                  and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'tenant_id')
                  and t.table_type = 'BASE TABLE'), '>=', 59, 'the catalogue holds at least the 59 tables with a tenant_id that main has (the loop is not vacuous)');
create temp table a_rows (t text primary key, n bigint);
do $$
declare
  t text;
  n bigint;
begin
  for t in select c.relname::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
              and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) order by 1 loop
    execute format('select count(*) from public.%I where tenant_id = %L', t, '11111111-1111-4111-8111-111111111111') into n;
    if n > 0 then insert into a_rows values (t, n); end if;
  end loop;
end
$$;
select cmp_ok((select count(*)::int from a_rows), '>=', 8, 'Demo A holds rows in at least eight tables');
select is((select count(*)::int from a_rows where t in ('menu_item', 'menu_item_price', 'sale_settings', 'dining_table', 'table_session', 'order_line', 'day_close', 'app_user')),
  8, 'including menu, price, coperto, tables, session, line, register and users');

create temp table x as select pg_temp.loop_as_b('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b') as j;

select cmp_ok((select (j ->> 'tables')::int from x), '>=', 59, 'the loop visited every table with a tenant_id');
select cmp_ok((select (j ->> 'own_read_tables')::int from x), '>=', 5, 'control: B''s owner reads its own rows in at least five tables');
select is((select j -> 'read_leaks' from x), '[]'::jsonb, 'X: as B''s owner, A''s rows read 0 in every table');
select is((select j -> 'insert_leaks' from x), '[]'::jsonb, 'X: as B''s owner, no table accepts an insert naming A''s tenant_id');
select is((select j -> 'odd_inserts' from x), '[]'::jsonb, 'X: every refused insert is 42501 (no grant, or the row level security check)');

-- Mutation: a temporary policy that lets B's owner read A's menu items. The loop must report exactly that table.
create policy x_mutation_read_all on public.menu_item for select to authenticated using (true);
select is((select pg_temp.loop_as_b('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b') -> 'read_leaks'),
  '["menu_item"]'::jsonb, 'mutation: a policy granting B a read on A makes the loop report menu_item (so a green run above means something)');

select * from finish();
rollback;
