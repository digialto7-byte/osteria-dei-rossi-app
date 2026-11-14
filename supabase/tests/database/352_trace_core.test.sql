-- P2-2 S1 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.2 and step S1): the trace core. The gate app.require_trace_reader (owner, admin, chef), the lot-code normaliser,
-- the split-family walk and the root lookup, the constants of D-P12, and the four indexes with their exact definitions. Fake data only; dates in 1998.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000eb', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'ragu b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '1998-10-01', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000db', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 1, '1998-10-01', 'Ragù B (demo)', 2, 'kg', 10, 48, 'b1000000-0000-4000-8000-00000000000b');

-- A batch of tenant A or B, produced at p_at (created_at the same), optionally split from a parent. Lot codes are unique per tenant: 981101-RAG-<seq>.
create function pg_temp.mkbatch(p_id uuid, p_tenant uuid, p_parent uuid, p_at timestamptz, p_seq int) returns void language plpgsql as $$
declare
  a boolean := p_tenant = '11111111-1111-4111-8111-111111111111';
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
      portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, split_from_batch_id, created_at, created_by)
    values (p_id, p_tenant,
      case when a then 'ec000000-0000-4000-8000-0000000000e3'::uuid else 'ec000000-0000-4000-8000-0000000000eb'::uuid end,
      case when a then 'ed000000-0000-4000-8000-0000000000d3'::uuid else 'ed000000-0000-4000-8000-0000000000db'::uuid end,
      1, '981101-RAG-' || p_seq, '1998-11-01', 'RAG', p_seq, p_at, case when a then 'a1000000-0000-4000-8000-00000000000a'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end,
      2, 'kg', 10, 10, 48, p_at + interval '48 hours', 'fresh',
      case when a then '10000000-0000-4000-8000-0000000000a1'::uuid else '10000000-0000-4000-8000-0000000000b1'::uuid end,
      p_parent, p_at,
      case when a then 'a1000000-0000-4000-8000-00000000000a'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end);
end $$;
create function pg_temp.act_as(p_auth uuid, p_role text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', p_role, 'aal', p_aal)::text, true) $$;
-- 'ok' or the SQLSTATE of a statement; the message text is kept apart for the P0001 codes.
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
end $$;

-- Family of tenant A: R (root), C1 split from R, C2 split from C1 (created later). Tenant B has a root BR with a child BC.
select pg_temp.mkbatch('ba000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', null, '1998-11-02T10:00Z', 1);
select pg_temp.mkbatch('ba000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-000000000001', '1998-11-03T10:00Z', 2);
select pg_temp.mkbatch('ba000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-000000000002', '1998-11-04T10:00Z', 3);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', null, '1998-11-02T10:00Z', 1);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b2', '22222222-2222-4222-8222-222222222222', 'ba000000-0000-4000-8000-0000000000b1', '1998-11-03T10:00Z', 2);

-- 1. The gate: owner, admin (at aal2, as the P2-1 gate requires) and chef pass; waiter, a signed-out session and an admin at aal1 get 42501.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner', 'aal1');
select is(pg_temp.err('select app.require_trace_reader()'), 'ok', 'gate: the owner passes');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin', 'aal2');
select is(pg_temp.err('select app.require_trace_reader()'), 'ok', 'gate: the admin at aal2 passes');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef', 'aal1');
select is(pg_temp.err('select app.require_trace_reader()'), 'ok', 'gate: the chef passes');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter', 'aal1');
select matches(pg_temp.err('select app.require_trace_reader()'), '^42501 ', 'gate: the waiter is refused with 42501');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin', 'aal1');
select matches(pg_temp.err('select app.require_trace_reader()'), '^42501 ', 'gate: an admin at aal1 (P2-1 claims) is refused with 42501');
select set_config('request.jwt.claims', '', true);
select matches(pg_temp.err('select app.require_trace_reader()'), '^42501 ', 'gate: a signed-out session is refused with 42501');

-- 2. The normaliser: upper case, whitespace stripped, null stays null, immutable.
select is(app.lot_code_norm(' l-demo 0001 '), 'L-DEMO0001', 'lot_code_norm: " l-demo 0001 " becomes L-DEMO0001');
select is(app.lot_code_norm(E'l\tdemo\n1'), 'LDEMO1', 'lot_code_norm: tabs and newlines are whitespace too');
select is(app.lot_code_norm(null), null, 'lot_code_norm: null stays null');
select is((select p.provolatile::text from pg_proc p where p.oid = 'app.lot_code_norm(text)'::regprocedure), 'i', 'lot_code_norm is immutable');

-- 3. The family walk, as tenant A.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner', 'aal1');
select is((select array_agg(batch_id::text order by depth, batch_id) from app.batch_family('11111111-1111-4111-8111-111111111111', array['ba000000-0000-4000-8000-000000000001']::uuid[], null)),
          array['ba000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000003'],
          'batch_family(R) is {R, C1, C2}');
select is((select array_agg(depth order by depth) from app.batch_family('11111111-1111-4111-8111-111111111111', array['ba000000-0000-4000-8000-000000000001']::uuid[], null)),
          array[0, 1, 2], 'with depths 0, 1, 2');
select is((select count(*)::int from app.batch_family('11111111-1111-4111-8111-111111111111', array['ba000000-0000-4000-8000-000000000001']::uuid[], null) f
            where f.root_id = 'ba000000-0000-4000-8000-000000000001'), 3, 'every member names R as its root');
select is((select array_agg(batch_id::text order by depth) from app.batch_family('11111111-1111-4111-8111-111111111111', array['ba000000-0000-4000-8000-000000000001']::uuid[], '1998-11-04T09:59:59Z')),
          array['ba000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000002'], 'p_until before C2''s creation excludes C2');
select is((select array_agg(batch_id::text) from app.batch_family('11111111-1111-4111-8111-111111111111', array['ba000000-0000-4000-8000-000000000001']::uuid[], '1998-11-01T00:00Z')),
          array['ba000000-0000-4000-8000-000000000001'], 'the root itself is always in the family');
select is((select count(*)::int from app.batch_family('11111111-1111-4111-8111-111111111111', array['ba000000-0000-4000-8000-0000000000b1']::uuid[], null)), 0,
          'another tenant''s root yields nothing for tenant A');
select is((select count(*)::int from app.batch_family('22222222-2222-4222-8222-222222222222', array['ba000000-0000-4000-8000-0000000000b1']::uuid[], null)), 2,
          'and tenant B''s family is its own two batches');
select is((select count(*)::int from app.batch_family('11111111-1111-4111-8111-111111111111', array['ba000000-0000-4000-8000-000000000002']::uuid[], null)), 2,
          'a child as root: {C1, C2}');
select is(app.batch_root('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-000000000003'), 'ba000000-0000-4000-8000-000000000001'::uuid, 'batch_root(C2) is R');
select is(app.batch_root('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-000000000001'), 'ba000000-0000-4000-8000-000000000001'::uuid, 'batch_root(R) is R');
select is(app.batch_root('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b2'), null, 'batch_root of another tenant''s batch is null');

-- 3b. The depth guard: a forged chain of 51 descendants below a root (inserted as the test owner) is refused; 50 is still allowed.
select pg_temp.mkbatch(('ba100000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
                       case when g = 0 then null else ('ba100000-0000-4000-8000-' || lpad((g - 1)::text, 12, '0'))::uuid end,
                       timestamptz '1998-11-05T00:00Z' + g * interval '1 minute', 100 + g)
  from generate_series(0, 50) g;
select is(pg_temp.err($$select count(*) from app.batch_family('11111111-1111-4111-8111-111111111111', array['ba100000-0000-4000-8000-000000000000']::uuid[], null)$$), 'ok',
          'a chain of 50 descendants (depth 50) is allowed');
select pg_temp.mkbatch('ba100000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111', 'ba100000-0000-4000-8000-000000000050', '1998-11-05T01:00Z', 151);
select is(pg_temp.err($$select count(*) from app.batch_family('11111111-1111-4111-8111-111111111111', array['ba100000-0000-4000-8000-000000000000']::uuid[], null)$$),
          'P0001 trace_depth_exceeded', 'a 51-deep chain raises P0001 trace_depth_exceeded');
select is(pg_temp.err($$select app.batch_root('11111111-1111-4111-8111-111111111111', 'ba100000-0000-4000-8000-000000000051')$$), 'P0001 trace_depth_exceeded',
          'batch_root on the same chain raises P0001 trace_depth_exceeded');

-- 4. The constants of D-P12.
select is(app.trace_constants(), '{"TRACE_MAX_LOTS": 50, "TRACE_MAX_BATCHES": 200, "TRACE_MAX_PLATE_GROUPS": 400, "TRACE_MAX_LINES": 200, "TRACE_MAX_RANGE_DAYS": 366, "TRACE_SPLIT_DEPTH": 50}'::jsonb,
          'the trace constants are the six of D-P12');

-- 5. The four indexes, with their exact definitions.
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'raw_lot_lot_code_norm_idx'),
          'CREATE INDEX raw_lot_lot_code_norm_idx ON public.raw_lot USING btree (tenant_id, app.lot_code_norm(lot_code) text_pattern_ops) WHERE (lot_code IS NOT NULL)', 'raw_lot_lot_code_norm_idx');
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'raw_lot_received_idx'),
          'CREATE INDEX raw_lot_received_idx ON public.raw_lot USING btree (tenant_id, received_on DESC, id)', 'raw_lot_received_idx');
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'raw_lot_supplier_idx'),
          'CREATE INDEX raw_lot_supplier_idx ON public.raw_lot USING btree (tenant_id, supplier_id, received_on DESC)', 'raw_lot_supplier_idx');
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'batch_split_from_idx'),
          'CREATE INDEX batch_split_from_idx ON public.batch USING btree (tenant_id, split_from_batch_id) WHERE (split_from_batch_id IS NOT NULL)', 'batch_split_from_idx');

-- 6. Privileges and settings: the helpers are executable by nobody outside the owner; none is writable (no insert/update/delete in the bodies).
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('require_trace_reader', 'lot_code_norm', 'trace_constants', 'batch_family', 'batch_root')
             and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'))), 0,
          'the five helpers are executable by none of anon, authenticated and service_role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('batch_family', 'batch_root') and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']), 2,
          'batch_family and batch_root are stable security definer functions with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('require_trace_reader', 'lot_code_norm', 'trace_constants', 'batch_family', 'batch_root')
             and p.prosrc ~* '\y(insert|update|delete|truncate)\y'), 0, 'no helper body writes');

select * from finish();
rollback;
