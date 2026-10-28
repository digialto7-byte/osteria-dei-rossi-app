-- UX plan B1 (docs/plans/2026-10-28-ux-flows.md, P1-1; migration 20261107100000_today_counts.sql): public.today_counts(),
-- the counts behind GET /api/today, and the shared predicate app.payable_is_overdue.
-- Fixture, tenant A (owner, admin, chef, waiter), days relative to today at the venue, instants relative to now():
--   invoices: review, duplicate, extraction_failed (3 to review); approved, rejected, received, extracting (not)
--   payables: open +10, scheduled +2, disputed -1 (overdue), paid -5, open -10 (overdue)  -> 4 unpaid, 2 overdue
--   batches: due_soon with 10 portions, expired with 5 portions (2 count); due_soon with no portions and an ok batch
--            with 8 portions (do not)
--   count sessions: one open at Cella, one closed at Frigo
-- Tenant B has one overdue payable and one review invoice and nothing else; tenant C has an owner and nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'owner-c@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '33333333-3333-4333-8333-333333333333', 'e0000000-0000-4000-8000-00000000000e', 'owner', 'Titolare C Demo');

create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'Europe/Rome')::date
$$;
create function pg_temp.id(prefix text, n int) returns uuid language sql as $$
  select (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.today(), pg_temp.id(text, int), pg_temp.act_as(uuid, uuid, text) to authenticated;

-- Master data of A (one of each) and the supplier of B.
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Frigo (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222', 'Fornitore B Srl', 'IT00000000000');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('a2000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Pomodoro (demo)', 'kg');
insert into public.dining_table (id, tenant_id, name, created_by, updated_by) values
  ('d2000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'Tavolo 1', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('b2000000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111', 'Spaghetti (demo)', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.venue_device (id, tenant_id, label, token_hash, created_by) values
  ('de000000-0000-4000-8000-0000000000de', '11111111-1111-4111-8111-111111111111', 'Telefono cucina (demo)', repeat('a', 64), 'a1000000-0000-4000-8000-00000000000a');

-- Invoices: one row per status for A; a review invoice for B.
create function pg_temp.inv(n int, tenant uuid, supplier uuid, status text) returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values (pg_temp.id('e0000000', n), tenant, tenant || '/2026/' || pg_temp.id('e0000000', n) || '.pdf', 'application/pdf', 2048,
          status::public.invoice_status, supplier)
$$;
select pg_temp.inv(1, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', 'review');
select pg_temp.inv(2, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', 'review');
update public.invoice set duplicate_of = pg_temp.id('e0000000', 1), status = 'duplicate' where id = pg_temp.id('e0000000', 2);
select pg_temp.inv(3, '11111111-1111-4111-8111-111111111111', null, 'extraction_failed');
select pg_temp.inv(4, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', 'approved');
select pg_temp.inv(5, '11111111-1111-4111-8111-111111111111', null, 'rejected');
select pg_temp.inv(6, '11111111-1111-4111-8111-111111111111', null, 'received');
select pg_temp.inv(7, '11111111-1111-4111-8111-111111111111', null, 'extracting');
select pg_temp.inv(8, '22222222-2222-4222-8222-222222222222', '5b000000-0000-4000-8000-00000000005b', 'review');

-- Payables (each on its own invoice, which is a plain received one).
create function pg_temp.pay(n int, tenant uuid, supplier uuid, creator uuid, due int, status text) returns void language plpgsql as $$
begin
  perform pg_temp.inv(100 + n, tenant, supplier, 'received');
  insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date,
                              due_date_source, status, paid_at, paid_on, created_by)
  values (pg_temp.id('90000000', n), tenant, pg_temp.id('e0000000', 100 + n), supplier, 100, 0, 100,
          pg_temp.today() + due, 'invoice', status::public.payable_status,
          case when status = 'paid' then now() end, case when status = 'paid' then pg_temp.today() - 2 end, creator);
end
$$;
select pg_temp.pay(1, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', 'a1000000-0000-4000-8000-00000000000a', 10, 'open');
select pg_temp.pay(2, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', 'a1000000-0000-4000-8000-00000000000a', 2, 'scheduled');
select pg_temp.pay(3, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', 'a1000000-0000-4000-8000-00000000000a', -1, 'disputed');
select pg_temp.pay(4, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', 'a1000000-0000-4000-8000-00000000000a', -5, 'paid');
select pg_temp.pay(5, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', 'a1000000-0000-4000-8000-00000000000a', -10, 'open');
select pg_temp.pay(6, '22222222-2222-4222-8222-222222222222', '5b000000-0000-4000-8000-00000000005b', 'b1000000-0000-4000-8000-00000000000b', -4, 'open');

-- Batches, straight into the tables as the migration owner (the production procedure is covered by 122-125).
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  values ('c2000000-0000-4000-8000-0000000000c2', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'sugo', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch,
    shelf_life_hours, created_by)
  values ('c3000000-0000-4000-8000-0000000000c3', '11111111-1111-4111-8111-111111111111', 'c2000000-0000-4000-8000-0000000000c2', 1,
          '2026-10-01T00:00Z', 'Sugo (demo)', 6, 'kg', 30, 72, 'a1000000-0000-4000-8000-00000000000a');
create function pg_temp.batch(n int, hours_ago int, shelf int, portions int) returns void language plpgsql as $$
declare
  v_id uuid := pg_temp.id('ba000000', n);
  v_at timestamptz := now() - make_interval(hours => hours_ago);
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq,
      produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by,
      location_id, created_by)
  values (v_id, '11111111-1111-4111-8111-111111111111', 'c2000000-0000-4000-8000-0000000000c2', 'c3000000-0000-4000-8000-0000000000c3', 1,
          '261101-SUGO-' || n, '2026-11-01', 'SUGO', n, v_at, 'c1000000-0000-4000-8000-00000000000c', 6, 'kg', 30, 30, shelf,
          v_at + make_interval(hours => shelf), '10000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-00000000000c');
  if portions > 0 then
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', portions, 'batch', v_id, '2026-11-01',
            'c1000000-0000-4000-8000-00000000000c');
  end if;
end
$$;
select pg_temp.batch(1, 60, 72, 10);   -- use_by in 12 h: due_soon, 10 portions
select pg_temp.batch(2, 100, 72, 5);   -- use_by 28 h ago: expired, 5 portions
select pg_temp.batch(3, 60, 72, 0);    -- due_soon, no portions left
select pg_temp.batch(4, 1, 72, 8);     -- use_by in 71 h: ok

-- Count sessions.
insert into public.count_session (id, tenant_id, location_id, type, status, started_by)
  values ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', 'daily', 'open',
          'c1000000-0000-4000-8000-00000000000c');
insert into public.count_session (id, tenant_id, location_id, type, status, started_by, closed_at, closed_by)
  values ('c6000000-0000-4000-8000-0000000000c6', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a2', 'daily', 'closed',
          'c1000000-0000-4000-8000-00000000000c', now(), 'c1000000-0000-4000-8000-00000000000c');

-- The function: kind, tenant, search path, grants ------------------------------------------------------------------------
select is((select p.prosecdef from pg_proc p where p.oid = 'public.today_counts()'::regprocedure), false,
  'today_counts is SECURITY INVOKER, so RLS applies to the caller');
select is((select p.proconfig from pg_proc p where p.oid = 'public.today_counts()'::regprocedure), array['search_path=""'],
  'and has an empty search_path');
select is((select p.provolatile from pg_proc p where p.oid = 'public.today_counts()'::regprocedure), 's', 'and is STABLE');
select is((select p.prorettype::regtype::text from pg_proc p where p.oid = 'public.today_counts()'::regprocedure), 'jsonb', 'and returns jsonb');
select is((select count(*)::int from unnest(array['anon', 'service_role']) r where has_function_privilege(r, 'public.today_counts()', 'execute')), 0,
  'anon and service_role cannot execute it');
select is(has_function_privilege('authenticated', 'public.today_counts()', 'execute'), true, 'authenticated can');
select is((select count(*)::int from pg_proc p where p.oid = 'public.today_counts()'::regprocedure and pg_get_functiondef(p.oid) ~ 'tenant_id\s*=\s*v_tenant'), 1,
  'the body filters on the tenant it took from app.tenant_id()');
select is((select pg_get_functiondef('public.today_counts()'::regprocedure) ~ 'app\.tenant_id\(\)'), true, 'and takes it from app.tenant_id()');

-- The shared predicate -------------------------------------------------------------------------------------------------
select is(app.payable_is_overdue('open', date '2026-10-01', date '2026-10-02'), true, 'overdue: unpaid and due before today');
select is(app.payable_is_overdue('open', date '2026-10-02', date '2026-10-02'), false, 'due today is not overdue');
select is(app.payable_is_overdue('paid', date '2026-10-01', date '2026-10-02'), false, 'a paid payable is never overdue');
select is(app.payable_is_overdue('disputed', date '2026-10-01', date '2026-10-02'), true, 'a disputed one is overdue as payable_item says');
select is(has_function_privilege('anon', 'app.payable_is_overdue(public.payable_status, date, date)', 'execute'), false, 'anon cannot execute the predicate');

select is(app.use_by_is_pending(now() - interval '1 hour', now()), true, 'use-by: expired is pending');
select is(app.use_by_is_pending(now() + interval '24 hours', now()), true, 'use-by: exactly 24 hours is due_soon, pending');
select is(app.use_by_is_pending(now() + interval '25 hours', now()), false, 'use-by: beyond 24 hours is ok, not pending');
select is((select p.prosecdef from pg_proc p where p.oid = 'app.use_by_is_pending(timestamptz, timestamptz)'::regprocedure), true,
  'the use-by wrapper is the one DEFINER piece: a scalar function that reads no table');
select is((select p.proconfig from pg_proc p where p.oid = 'app.use_by_is_pending(timestamptz, timestamptz)'::regprocedure), array['search_path=""'],
  'with an empty search_path');
select is((select count(*)::int from unnest(array['anon', 'service_role']) r
            where has_function_privilege(r, 'app.use_by_is_pending(timestamptz, timestamptz)', 'execute')), 0, 'closed to anon and service_role');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r, pg_proc p
            where p.pronamespace = 'app'::regnamespace and p.proname in ('use_by_state', 'venue_date')
              and has_function_privilege(r, p.oid, 'execute')), 0, 'use_by_state and venue_date stay closed to every API role');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r, pg_proc p
            where p.pronamespace = 'app'::regnamespace and p.proname = 'payable_item' and has_function_privilege(r, p.oid, 'execute')), 0,
  'payable_item (redefined here) is still closed to every API role');

-- Owner of A -----------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select public.today_counts() ->> 'invoicesToReview'), '3', 'owner: review, duplicate and extraction_failed count; approved, rejected, received, extracting do not');
select is((select public.today_counts() ->> 'payablesOverdue'), '2', 'owner: two overdue payables');
select is((select public.today_counts() ->> 'payablesUnpaid'), '4', 'owner: four unpaid payables');
select is((select public.today_counts() ->> 'batchesUseBy'), '2', 'owner: the due_soon and the expired batch with portions; not the finished one, not the ok one');
select is((select public.today_counts() -> 'countOpen'), 'true'::jsonb, 'owner: a count is open');
select is((select public.today_counts() -> 'setup'), jsonb_build_object('hasLocations', true, 'hasSuppliers', true, 'hasIngredients', true,
  'hasApprovedInvoice', true, 'hasStaff', true, 'hasDevice', true, 'hasTables', true, 'hasMenuItems', true), 'owner: every set-up step is done');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(public.today_counts()) k),
  array['batchesUseBy', 'countOpen', 'invoicesToReview', 'payablesOverdue', 'payablesUnpaid', 'setup'], 'owner: exactly these keys');
select is((select count(*)::int from jsonb_object_keys(public.today_counts()) k where k ~* 'cost|amount|eur|price|margin'), 0, 'no key is about money');

-- The same predicates as the lists ----------------------------------------------------------------------------------------
select is((select count(*)::int from jsonb_array_elements(public.payable_list('unpaid') -> 'items') i where (i ->> 'overdue')::boolean),
  (select (public.today_counts() ->> 'payablesOverdue')::int), 'payablesOverdue equals the overdue rows of payable_list');
select is((select (public.payable_list('unpaid') -> 'totals' ->> 'count')::int), (select (public.today_counts() ->> 'payablesUnpaid')::int),
  'payablesUnpaid equals the unpaid total of payable_list');
select is((select count(*)::int from jsonb_array_elements(public.batch_list() -> 'items') i
            where i ->> 'useByState' in ('expired', 'due_soon') and (i ->> 'portionsRemaining')::numeric > 0),
  (select (public.today_counts() ->> 'batchesUseBy')::int), 'batchesUseBy equals the use-by rows with portions of batch_list');
select is((select jsonb_agg(i ->> 'useByState' order by i ->> 'lotCode' collate "C") from jsonb_array_elements(public.batch_list() -> 'items') i),
  '["due_soon", "expired", "due_soon", "ok"]'::jsonb, 'batch_list still reports the same use-by states');
select is((select jsonb_agg(i ->> 'overdue' order by i ->> 'invoiceNumber' collate "C", i ->> 'id' collate "C") from jsonb_array_elements(public.payable_list('all') -> 'items') i
            where (i ->> 'overdue')::boolean), jsonb_build_array('true', 'true'), 'payable_list still marks the same two payables overdue');
reset role;

-- Admin of A -----------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select public.today_counts() ->> 'invoicesToReview'), '3', 'admin: invoices to review');
select is((select public.today_counts() ->> 'payablesOverdue'), '2', 'admin: overdue payables');
select is((select public.today_counts() -> 'setup' ->> 'hasDevice'), 'true', 'admin: set-up steps are read');
reset role;

-- Chef of A: quantities only, no invoices, payables or set-up --------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(public.today_counts()) k), array['batchesUseBy', 'countOpen'],
  'chef: only the batches and the count');
select is((select public.today_counts() ->> 'batchesUseBy'), '2', 'chef: use-by batches');
select is((select public.today_counts() -> 'countOpen'), 'true'::jsonb, 'chef: the open count');
reset role;

-- Waiter: refused, and tenant 3 sees nothing -------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select throws_ok('select public.today_counts()', '42501', null, 'waiter: refused with 42501 before any count');
reset role;

-- Tenant B: its own data only ---------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select public.today_counts() ->> 'invoicesToReview'), '1', 'tenant B: its own review invoice only');
select is((select public.today_counts() ->> 'payablesOverdue'), '1', 'tenant B: its own overdue payable only');
select is((select public.today_counts() ->> 'payablesUnpaid'), '1', 'tenant B: one unpaid payable');
select is((select public.today_counts() ->> 'batchesUseBy'), '0', 'tenant B: no batch of tenant A');
select is((select public.today_counts() -> 'countOpen'), 'false'::jsonb, 'tenant B: no count of tenant A');
select is((select public.today_counts() -> 'setup' ->> 'hasStaff'), 'false', 'tenant B: its owner is not staff');
reset role;

-- Tenant C: nothing at all ------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '33333333-3333-4333-8333-333333333333', 'owner');
select is((select public.today_counts() - 'setup' - 'countOpen'),
  jsonb_build_object('invoicesToReview', 0, 'payablesOverdue', 0, 'payablesUnpaid', 0, 'batchesUseBy', 0), 'tenant C: all counts are 0');
select is((select public.today_counts() -> 'setup'), jsonb_build_object('hasLocations', false, 'hasSuppliers', false, 'hasIngredients', false,
  'hasApprovedInvoice', false, 'hasStaff', false, 'hasDevice', false, 'hasTables', false, 'hasMenuItems', false), 'tenant C: nothing is set up');
reset role;

-- The venue day is app.venue_date's (as superuser; the function computes it inline because the helper is closed to the API roles)
select is((select (now() at time zone t.timezone)::date = app.venue_date(now(), t.timezone) from public.tenant t where t.id = '11111111-1111-4111-8111-111111111111'), true,
  'the inline venue day equals app.venue_date for tenant A');
update public.tenant set timezone = 'Pacific/Kiritimati' where id = '22222222-2222-4222-8222-222222222222';
select is((select (now() at time zone t.timezone)::date = app.venue_date(now(), t.timezone) from public.tenant t where t.id = '22222222-2222-4222-8222-222222222222'), true,
  'and for a tenant in another time zone');
select is((select count(*)::int from public.payable p where p.tenant_id = '22222222-2222-4222-8222-222222222222' and p.status <> 'paid'
             and p.due_date < app.venue_date(now(), 'Pacific/Kiritimati')),
  (select count(*)::int from public.payable p where p.tenant_id = '22222222-2222-4222-8222-222222222222' and app.payable_is_overdue(p.status, p.due_date, (now() at time zone 'Pacific/Kiritimati')::date)),
  'overdue by app.venue_date and by the inline day agree');
create temp table expected_overdue as
  select count(*)::int as n from public.payable p where p.tenant_id = '22222222-2222-4222-8222-222222222222' and p.status <> 'paid'
     and p.due_date < app.venue_date(now(), 'Pacific/Kiritimati');
grant select on expected_overdue to authenticated;
set local role authenticated;
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select (public.today_counts() ->> 'payablesOverdue')::int), (select n from expected_overdue),
  'today_counts uses the tenant''s venue day: its overdue count equals the one computed with app.venue_date');
reset role;

-- A deactivated row does not count as set up ------------------------------------------------------------------------------
update public.location set is_active = false where tenant_id = '33333333-3333-4333-8333-333333333333';
insert into public.location (tenant_id, name) values ('33333333-3333-4333-8333-333333333333', 'Cella C (demo)');
update public.location set is_active = false where tenant_id = '33333333-3333-4333-8333-333333333333';
set local role authenticated;
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '33333333-3333-4333-8333-333333333333', 'owner');
select is((select public.today_counts() -> 'setup' ->> 'hasLocations'), 'false', 'only inactive locations: not set up');
reset role;

-- No session ----------------------------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select throws_ok('select public.today_counts()', '42501', null, 'no claims: refused');
reset role;

select * from finish();
rollback;
