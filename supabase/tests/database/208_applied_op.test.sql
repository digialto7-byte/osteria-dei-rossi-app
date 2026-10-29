-- M20 step 1 (docs/plans/2026-10-29-m20-offline.md §3.2, §5; ADR-022): public.applied_op, the record of every offline operation the
-- server decided, and app.sync_op_kinds(). The table is append-only, tenant-keyed (tenant_id, op_id), RLS on with no policy, and no API
-- role can read it (only apply_op, a definer, does; service_role may select, for integration reads). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'waiter-a2@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('d1000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-0000000000d2', 'waiter', 'Cameriere Due Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

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
-- One applied_op row as plain SQL text; overrides replace single columns.
create function pg_temp.ins(p_tenant uuid, p_op uuid, p_user uuid, p_kind text default 'add_line', p_seq bigint default 1,
    p_outcome text default 'applied', p_hash text default repeat('a', 64), p_created_by uuid default null) returns text language sql as $$
  select format($f$ insert into public.applied_op (tenant_id, op_id, user_id, kind, seq, client_ts, received_at, outcome, payload_hash, result, created_by)
                    values (%L, %L, %L, %L, %s, now(), now(), %L, %L, '{}'::jsonb, %L) $f$,
                p_tenant, p_op, p_user, p_kind, p_seq, p_outcome, p_hash, coalesce(p_created_by, p_user))
$$;

-- Columns --------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
             from information_schema.columns where table_schema = 'public' and table_name = 'applied_op'),
          'tenant_id:uuid:NO,op_id:uuid:NO,user_id:uuid:NO,kind:text:NO,seq:bigint:NO,client_ts:timestamp with time zone:NO,received_at:timestamp with time zone:NO,outcome:text:NO,payload_hash:text:NO,result:jsonb:NO,created_at:timestamp with time zone:NO,created_by:uuid:NO',
          'the columns and types are those of plan §3.2, all not null');
select is((select pg_get_expr(adbin, adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
            where d.adrelid = 'public.applied_op'::regclass and a.attname = 'tenant_id'), 'app.tenant_id()', 'tenant_id defaults to app.tenant_id()');

-- Key: (tenant_id, op_id) --------------------------------------------------------------------------------------------------------
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.applied_op'::regclass and contype = 'p'),
          'PRIMARY KEY (tenant_id, op_id)', 'the primary key is (tenant_id, op_id)');
select is(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-00000000000d')),
          'ok', 'an op id inserts in tenant A');
select is(pg_temp.err(pg_temp.ins('22222222-2222-4222-8222-222222222222', '0a000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-00000000000b')),
          'ok', 'the same op id inserts in tenant B (keys are tenant-scoped)');
select is(left(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-0000000000d2')), 5), '23505', 'the same op id twice in tenant A is a unique violation');

-- Checks ---------------------------------------------------------------------------------------------------------------------------
select is(left(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-00000000000d', 'close_table')), 5), '23514', 'kind close_table is refused (M21 adds it)');
select is(left(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-00000000000d', 'add_line', 0)), 5), '23514', 'seq 0 is refused');
select is(left(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-00000000000d', 'add_line', 1, 'duplicate')), 5), '23514', 'outcome duplicate is refused (a duplicate stores nothing)');
select is(left(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-00000000000d', 'add_line', 1, 'applied', 'xyz')), 5), '23514', 'a payload hash that is not 64 hex digits is refused');
select is(left(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-00000000000d', 'add_line', 1, 'applied', repeat('A', 64))), 5), '23514', 'upper-case hex is refused (the hash is lower-case)');
select is(left(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-00000000000d', 'add_line', 1, 'applied', repeat('a', 64), 'd1000000-0000-4000-8000-0000000000d2')), 5), '23514', 'created_by must equal user_id');
select is(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-000000000008', 'd1000000-0000-4000-8000-0000000000d2', 'void_line', 7, 'conflict')),
          'ok', 'a valid second row (another waiter, kind void_line, outcome conflict) inserts');
select is(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-00000000000d', 'open_table', 2, 'rejected')),
          'ok', 'outcome rejected inserts');

-- Foreign keys ---------------------------------------------------------------------------------------------------------------------
select is(left(pg_temp.err(pg_temp.ins('11111111-1111-4111-8111-111111111111', '0a000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000b')), 5), '23503', 'a tenant-B user on a tenant-A row is a foreign key violation');
select is(left(pg_temp.err(pg_temp.ins('33333333-3333-4333-8333-333333333333', '0a000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b')), 5), '23503', 'an unknown tenant is a foreign key violation');

-- Append-only ----------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ update public.applied_op set outcome = 'rejected' where op_id = '0a000000-0000-4000-8000-000000000001' $$), 'P0001 append_only', 'UPDATE is refused');
select is(pg_temp.err($$ delete from public.applied_op where op_id = '0a000000-0000-4000-8000-000000000001' $$), 'P0001 append_only', 'DELETE is refused');
select is(pg_temp.err($$ truncate public.applied_op $$), 'P0001 append_only', 'TRUNCATE is refused');
select is((select count(*)::int from public.applied_op), 4, 'and the rows are all still there');
select is((select array_agg(tgname::text order by tgname::text) from pg_trigger where tgrelid = 'public.applied_op'::regclass and not tgisinternal),
          array['applied_op_append_only', 'applied_op_no_truncate'], 'the two guard triggers are named like the other ledgers');

-- RLS and privileges ---------------------------------------------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'public.applied_op'::regclass), true, 'RLS is enabled');
select is((select count(*)::int from pg_policy where polrelid = 'public.applied_op'::regclass), 0, 'and there is no policy');
create function pg_temp.sel_as(p_who text, p_sub uuid, p_tenant uuid) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_who)::text, true);
  set local role authenticated;
  perform count(*) from public.applied_op;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state;
end
$$;
select is(pg_temp.sel_as('owner', 'a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111'), '42501', 'the owner cannot select');
select is(pg_temp.sel_as('admin', 'f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111'), '42501', 'the admin cannot select');
select is(pg_temp.sel_as('chef', 'c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111'), '42501', 'the chef cannot select');
select is(pg_temp.sel_as('waiter', 'd0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111'), '42501', 'the waiter cannot select');
select is(has_table_privilege('service_role', 'public.applied_op', 'select'), true, 'service_role may select (integration reads)');
select is((select bool_or(has_table_privilege('service_role', 'public.applied_op', p)) from unnest(array['insert', 'update', 'delete', 'truncate']) p), false,
          'but not insert, update, delete or truncate');
select is((select bool_or(has_table_privilege(r, 'public.applied_op', p)) from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references']) p),
          false, 'anon and authenticated hold no privilege at all');

-- app.sync_op_kinds() --------------------------------------------------------------------------------------------------------------
select is(app.sync_op_kinds(), array['open_table', 'add_line', 'edit_line', 'remove_line', 'fire', 'void_line'], 'the six kinds, in plan §3.1.2 order');
select is((select provolatile from pg_proc where oid = 'app.sync_op_kinds()'::regprocedure), 'i', 'sync_op_kinds is immutable');
select is((select bool_or(has_function_privilege(r, 'app.sync_op_kinds()', 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r), false,
          'no API role can execute sync_op_kinds');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.applied_op'::regclass and conname = 'applied_op_kind_ck') like '%sync_op_kinds%', true,
          'the kind check reads the function (so M21 changes one list)');
select is((select count(*)::int from pg_proc where pronamespace = 'app'::regnamespace and proname = 'sync_op_kinds'), 1, 'one definition');
select is((select has_table_privilege('postgres', 'public.applied_op', 'select')), true, 'the migration owner reads the table (the definer runs as the owner)');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'applied_op' and column_name = 'tenant_id'), 1, 'tenant_id is a column (the purge list test 194 relies on it)');
select is((select count(*)::int from pg_constraint where conrelid = 'public.applied_op'::regclass and contype = 'f'), 2, 'two foreign keys: tenant and (tenant, user)');
select is((select string_agg(conname::text, ',' order by conname::text collate "C") from pg_constraint where conrelid = 'public.applied_op'::regclass and contype = 'f'),
          'applied_op_tenant_fkey,applied_op_user_fkey', 'named as in the plan');

select * from finish();
rollback;
