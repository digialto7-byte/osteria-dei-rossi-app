-- Opening stock, step 5 (docs/plans/2026-11-18-opening-stock.md §3.2, §5 step 5): the tables public.stock_opening (append-only, one row per booked operation) and
-- public.opening_draft_line (the draft, not ledger), their RLS and grants, the audit values and the purge list. Rows are written here as the table owner (a fixture): no API role
-- may write either table. B-against-A cases for these tables are in 408 (X). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
set local timezone = 'UTC';
select plan(31);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000fa', 'admin-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000ca', 'chef-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000da', 'waiter-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'owner-c@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('a1000000-0000-4000-8000-0000000000fa', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000fa', 'admin', 'Admin Demo'),
  ('a1000000-0000-4000-8000-0000000000ca', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000ca', 'chef', 'Chef Demo'),
  ('a1000000-0000-4000-8000-0000000000da', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000da', 'waiter', 'Cameriere Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-00000000000c', 'owner', 'Titolare C Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Frigo 1 (demo)'),
  ('10000000-0000-4000-8000-0000000000c1', '33333333-3333-4333-8333-333333333333', 'Dispensa C (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Farina 00 (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Mozzarella (demo)', 'kg', true);

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  cons text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, cons = constraint_name;
  return state || ' ' || coalesce(nullif(cons, ''), msg);
end
$$;
create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role,
    'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
create function pg_temp.rows_seen() returns text language sql as $$
  select (select count(*) from public.stock_opening) || '/' || (select count(*) from public.opening_draft_line)
$$;
grant execute on function pg_temp.err(text), pg_temp.rows_seen() to authenticated;
-- A draft line as the table owner: 'ok' or "SQLSTATE constraint".
create function pg_temp.draft(p_id uuid, p_ing uuid, p_loc uuid, p_qty numeric, p_cost numeric) returns text language sql as $$
  select pg_temp.err(format('insert into public.opening_draft_line (id, tenant_id, location_id, ingredient_id, qty, unit_cost, created_by, updated_by) values (%L, %L, %L, %L, %s, %s, %L, %L)',
    p_id, '11111111-1111-4111-8111-111111111111', p_loc, p_ing, p_qty, p_cost, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'))
$$;

-- 1. The tables exist, with RLS on and their keys ------------------------------------------------------------------------------------------------------------------
select ok(to_regclass('public.stock_opening') is not null and (select relrowsecurity from pg_class where oid = to_regclass('public.stock_opening'))
          and exists (select 1 from pg_constraint where conname = 'stock_opening_request_uq' and pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, request_id)'),
  'public.stock_opening exists with RLS on and a unique (tenant_id, request_id)');
select ok(to_regclass('public.opening_draft_line') is not null and (select relrowsecurity from pg_class where oid = to_regclass('public.opening_draft_line'))
          and exists (select 1 from pg_constraint where conname = 'opening_draft_line_ingredient_uq' and pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, location_id, ingredient_id)'),
  'public.opening_draft_line exists with RLS on and a unique (tenant_id, location_id, ingredient_id)');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' order by a.attnum) from pg_attribute a
            where a.attrelid = 'public.stock_opening'::regclass and a.attnum > 0 and not a.attisdropped),
  'id:uuid:true,tenant_id:uuid:true,location_id:uuid:true,effective_on:date:true,request_id:uuid:true,line_count:integer:true,created_at:timestamp with time zone:true,created_by:uuid:true',
  'stock_opening has the columns of plan 3.2, all not null');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' order by a.attnum) from pg_attribute a
            where a.attrelid = 'public.opening_draft_line'::regclass and a.attnum > 0 and not a.attisdropped),
  'id:uuid:true,tenant_id:uuid:true,location_id:uuid:true,ingredient_id:uuid:true,qty:numeric(12,4):true,unit_cost:numeric(12,4):true,created_at:timestamp with time zone:true,updated_at:timestamp with time zone:true,created_by:uuid:true,updated_by:uuid:true',
  'opening_draft_line has the columns of plan 3.2, all not null');
select is((select string_agg(conname, ',' order by conname) from pg_constraint where contype = 'f' and conrelid in ('public.stock_opening'::regclass, 'public.opening_draft_line'::regclass)
            and pg_get_constraintdef(oid) like 'FOREIGN KEY (tenant_id, %'),
  'opening_draft_line_created_by_fk,opening_draft_line_ingredient_fk,opening_draft_line_location_fk,opening_draft_line_updated_by_fk,stock_opening_created_by_fk,stock_opening_location_fk',
  'every reference to a location, an ingredient or a user is a composite key on the tenant');
select has_index('public', 'stock_opening', 'stock_opening_location_idx', array['tenant_id', 'location_id', 'created_at'], 'stock_opening is indexed by tenant, location and time');

-- 2. Grants: select to authenticated only; no API role writes either table -----------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role), unnest(array['public.stock_opening', 'public.opening_draft_line']) t(tbl)
            where has_table_privilege(r.role, t.tbl, 'insert') or has_table_privilege(r.role, t.tbl, 'update') or has_table_privilege(r.role, t.tbl, 'delete')
               or has_table_privilege(r.role, t.tbl, 'truncate')), 0,
  'no insert, update, delete or truncate privilege for anon, authenticated or service_role on either table');
select is((select string_agg(r.role || ':' || t.tbl, ',' order by r.role, t.tbl) from unnest(array['anon', 'authenticated', 'service_role']) r(role),
            unnest(array['public.opening_draft_line', 'public.stock_opening']) t(tbl) where has_table_privilege(r.role, t.tbl, 'select')),
  'authenticated:public.opening_draft_line,authenticated:public.stock_opening,service_role:public.opening_draft_line,service_role:public.stock_opening',
  'authenticated may select (RLS decides which rows) and service_role reads, as on invoice_vat_summary; anon has nothing');
select is((select string_agg(polname || ':' || polcmd::text, ',' order by polname) from pg_policy where polrelid in ('public.stock_opening'::regclass, 'public.opening_draft_line'::regclass)),
  'opening_draft_line_select:r,stock_opening_select:r', 'one select policy each, and no other policy');

-- Fixture rows, as the table owner.
insert into public.stock_opening (id, tenant_id, location_id, effective_on, request_id, line_count, created_by) values
  ('0e000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', '2026-12-01', 'e0000000-0000-4000-8000-0000000000a1', 2, 'a1000000-0000-4000-8000-00000000000a');
select is(pg_temp.draft('0d000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', 25, 0.8), 'ok', 'a draft line (25 kg at 0,80) is accepted');

-- 3. RLS: owner and admin read; chef and waiter read nothing -----------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner');
select is(pg_temp.rows_seen(), '1/1', 'the owner reads A''s operation and draft line');
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000fa', 'admin');
select is(pg_temp.rows_seen(), '1/1', 'the admin (aal2) reads them too');
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000ca', 'chef');
select is(pg_temp.rows_seen(), '0/0', 'the chef reads none (the carico sets costs)');
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000da', 'waiter');
select is(pg_temp.rows_seen(), '0/0', 'the waiter reads none');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner');
select is(pg_temp.err($$ insert into public.opening_draft_line (id, tenant_id, location_id, ingredient_id, qty, unit_cost, created_by, updated_by)
  values (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000002', 1, 1,
          'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a') $$), '42501 permission denied for table opening_draft_line',
  'the owner cannot insert a draft line directly (only the procedures write)');
select is(pg_temp.err($$ delete from public.opening_draft_line $$), '42501 permission denied for table opening_draft_line', 'nor delete one');
select is(pg_temp.err($$ update public.stock_opening set line_count = 3 $$), '42501 permission denied for table stock_opening', 'nor update an operation');
reset role;

-- 4. stock_opening is append-only ---------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ update public.stock_opening set line_count = 3 where id = '0e000000-0000-4000-8000-0000000000a1' $$), 'P0001 append_only', 'UPDATE of an operation is refused (append_only)');
select is(pg_temp.err($$ delete from public.stock_opening where id = '0e000000-0000-4000-8000-0000000000a1' $$), 'P0001 append_only', 'DELETE of an operation is refused (append_only)');
select is(pg_temp.err($$ truncate public.stock_opening $$), 'P0001 append_only', 'TRUNCATE of stock_opening is refused (append_only)');
select is(pg_temp.err($$ insert into public.stock_opening (tenant_id, location_id, effective_on, request_id, line_count, created_by)
  values ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a2', '2026-12-01', 'e0000000-0000-4000-8000-0000000000a1', 1, 'a1000000-0000-4000-8000-00000000000a') $$),
  '23505 stock_opening_request_uq', 'a second operation with the same request_id is refused (stock_opening_request_uq)');
select is(pg_temp.err($$ insert into public.stock_opening (tenant_id, location_id, effective_on, request_id, line_count, created_by)
  values ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a2', '2026-12-01', gen_random_uuid(), 201, 'a1000000-0000-4000-8000-00000000000a') $$),
  '23514 stock_opening_line_count_ck', 'line_count 201 is refused');
select is(pg_temp.err($$ insert into public.stock_opening (tenant_id, location_id, effective_on, request_id, line_count, created_by)
  values ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000c1', '2026-12-01', gen_random_uuid(), 1, 'a1000000-0000-4000-8000-00000000000a') $$),
  '23503 stock_opening_location_fk', 'an operation at another tenant''s location is refused (composite key)');

-- 5. The draft CHECKs and the one-row-per-ingredient rule ---------------------------------------------------------------------------------------------------------
select is(pg_temp.draft(gen_random_uuid(), '1a000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1', 0, 1), '23514 opening_draft_line_qty_ck', 'a draft qty 0 is refused');
select is(pg_temp.draft(gen_random_uuid(), '1a000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1', 100000.0001, 1), '23514 opening_draft_line_qty_ck', 'a draft qty 100000.0001 is refused');
select is(pg_temp.draft(gen_random_uuid(), '1a000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1', 1, -1), '23514 opening_draft_line_unit_cost_ck', 'a draft unit_cost -1 is refused');
select is(pg_temp.draft(gen_random_uuid(), '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', 3, 1), '23505 opening_draft_line_ingredient_uq',
  'a second draft line for the same ingredient at the same location is refused');
select is(pg_temp.draft(gen_random_uuid(), '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a2', 3, 1), 'ok', 'the same ingredient at another location is accepted');

-- 6. The audit values ------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'stock_opening', '0e000000-0000-4000-8000-0000000000a1', 'stock.opening_posted', '{"lines": 2}', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'stock_opening', '0e000000-0000-4000-8000-0000000000a1', 'stock.opening_reversed', '{"lines": 2}', 'a1000000-0000-4000-8000-00000000000a') $$), 'ok',
  'the audit checks accept the entity stock_opening and the actions stock.opening_posted and stock.opening_reversed');

-- 7. The purge list ---------------------------------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(n order by o) from unnest(app.demo_purge_tables()) with ordinality t(n, o)
            where o between (select o2 from unnest(app.demo_purge_tables()) with ordinality t2(n2, o2) where n2 = 'raw_lot') and
                            (select o2 + 3 from unnest(app.demo_purge_tables()) with ordinality t2(n2, o2) where n2 = 'raw_lot')),
  array['raw_lot', 'opening_draft_line', 'stock_opening', 'price_history'], 'the purge list has opening_draft_line and stock_opening right after raw_lot, before price_history');
-- Tenant C has a location only (master data counts already); its operation makes the check read stock_opening. The function skips only the login and audit tables.
insert into public.stock_opening (tenant_id, location_id, effective_on, request_id, line_count, created_by) values
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-0000000000c1', '2026-12-01', gen_random_uuid(), 1, 'c1000000-0000-4000-8000-00000000000c');
select ok(app.tenant_has_operational_data('33333333-3333-4333-8333-333333333333')
          and pg_get_functiondef('app.tenant_has_operational_data(uuid)'::regprocedure) not like '%opening%',
  'tenant_has_operational_data is true for a tenant with a carico, and it skips neither opening table');

select * from finish();
rollback;
