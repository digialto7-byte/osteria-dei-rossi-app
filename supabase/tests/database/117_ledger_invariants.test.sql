-- M13 step 8: the nightly invariant check (M13 plan §3.1.10, §3.9, §5 step 8; AT5). The runner is called with a fixed
-- p_at (2027-06-15T02:45Z, a summer night: Rome date 2027-06-15) over the October 2026 fixture of pgTAP 114, which is
-- consistent on every check; app.job_run rows are inserted with chosen times. Each inconsistency is seeded in a
-- savepoint and rolled back afterwards. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('e0000000-0000-4000-8000-0000000000e0', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('e1000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-0000000000e0', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Freezer (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222', 'Fornitore B Demo', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e2000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/e2000000-0000-4000-8000-0000000000e2.pdf',
   'application/pdf', 2048, 'review', '5b000000-0000-4000-8000-00000000005b');

create temporary table reg (k text primary key, id uuid not null);
create temporary table results (k text primary key, j jsonb);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create function pg_temp.res(p_k text) returns jsonb language sql as $$ select j from results where k = p_k $$;
create function pg_temp.as_(p_who text) returns void language plpgsql as $$
declare
  v record;
begin
  if p_who = 'super' then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'none', true);
    return;
  end if;
  select * into v from (values
    ('owner', 'a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111'),
    ('chef', 'c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111'),
    ('waiter', 'e0000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111'),
    ('ownerb', 'b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222')) w (who, auth_id, tenant)
   where w.who = p_who;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v.auth_id, 'role', 'authenticated',
    'tenant_id', v.tenant, 'app_role', case p_who when 'ownerb' then 'owner' else p_who end)::text, true);
end
$$;
create function pg_temp.run(p_key text, p_who text, p_sql text) returns text language plpgsql as $$
declare
  v jsonb;
  state text;
  msg text;
begin
  perform pg_temp.as_(p_who);
  begin
    execute p_sql into v;
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    perform pg_temp.as_('super');
    return state || ' ' || msg;
  end;
  perform pg_temp.as_('super');
  insert into results values (p_key, v) on conflict (k) do update set j = excluded.j;
  return 'ok';
end
$$;
-- Runs a call for its effect: a bare select would print 'ok', which pg_prove reads as a TAP line.
create function pg_temp.quiet(p text) returns void language plpgsql as $$ begin return; end $$;

create sequence pg_temp.line_seq;
create function pg_temp.new_line(p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, p_tenant,
      case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'e1000000-0000-4000-8000-0000000000e1'
           else 'e2000000-0000-4000-8000-0000000000e2' end::uuid,
      v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  return v_line;
end
$$;
create function pg_temp.mk_ing(p_k text, p_name text, p_unit text default 'kg') returns void language sql as $$
  with r as (insert into reg values (p_k, gen_random_uuid()) returning id)
  insert into public.ingredient (id, tenant_id, name, base_unit)
    select r.id, '11111111-1111-4111-8111-111111111111', p_name, p_unit::public.base_unit from r
$$;
-- A lot with its receipt (unit_cost 10) at a location on a date.
create function pg_temp.lot(p_key text, p_ing text, p_loc text, p_qty numeric, p_on date, p_expiry date) returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line();
  v_lot uuid := gen_random_uuid();
  v_loc uuid := case p_loc when 'cella' then '10000000-0000-4000-8000-0000000000a1' else '10000000-0000-4000-8000-0000000000a2' end;
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
      expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    select v_lot, '11111111-1111-4111-8111-111111111111', i.id, v_loc, '5a000000-0000-4000-8000-00000000005a', v_line,
           upper(p_key), p_expiry, p_on, p_qty, i.base_unit, p_qty, i.base_unit::text, 1, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
      ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, v_loc, 'receipt', p_qty, 10,
      'invoice_line', v_line, p_on, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- One movement of tenant A at a location on a date.
create function pg_temp.mv(p_ing text, p_type text, p_qty numeric, p_on date, p_lot text default null, p_loc text default 'cella',
    p_ref_type text default 'manual', p_ref uuid default gen_random_uuid(), p_reason text default null,
    p_cost numeric default null) returns uuid language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code,
      ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), case when p_lot is null then null else pg_temp.id(p_lot) end,
      case p_loc when 'cella' then '10000000-0000-4000-8000-0000000000a1' else '10000000-0000-4000-8000-0000000000a2' end::uuid,
      p_type::public.stock_movement_type, p_qty, p_cost, p_reason, p_ref_type, p_ref, p_on, 'c1000000-0000-4000-8000-00000000000c')
  returning id
$$;
-- A closed count session at Cella with its lines (key, expected, counted). Lines are written while it is open.
create function pg_temp.count_session(p_key text, p_type text, p_closed timestamptz, p_lines jsonb) returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  e jsonb;
  n int := 0;
begin
  insert into reg values (p_key, v_id);
  insert into public.count_session (id, tenant_id, location_id, type, started_by, started_at)
    values (v_id, '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', p_type,
            'c1000000-0000-4000-8000-00000000000c', p_closed - interval '1 hour');
  for e in select x from jsonb_array_elements(p_lines) x loop
    n := n + 1;
    insert into public.count_line (tenant_id, session_id, ingredient_id, position, expected_qty, counted_qty, entered_at,
        entered_by, created_by)
      values ('11111111-1111-4111-8111-111111111111', v_id, pg_temp.id(e->>'k'), n, (e->>'expected')::numeric,
              (e->>'counted')::numeric, p_closed - interval '30 minutes', 'c1000000-0000-4000-8000-00000000000c',
              'c1000000-0000-4000-8000-00000000000c');
  end loop;
  update public.count_session set status = 'closed', closed_at = p_closed, closed_by = 'c1000000-0000-4000-8000-00000000000c'
   where id = v_id;
end
$$;

-- The month ----------------------------------------------------------------------------------------------
select pg_temp.mk_ing('beef', 'Manzo muscolo (demo)');
select pg_temp.mk_ing('farina', 'Farina di mais (demo)');
select pg_temp.mk_ing('uova', 'Uova (demo)', 'pz');
select pg_temp.mk_ing('sale', 'Sale grosso (demo)');
select pg_temp.mk_ing('burro', 'Burro (demo)');
select pg_temp.mk_ing('olio', 'Olio EVO (demo)', 'l');

select pg_temp.count_session('p', 'monthly', '2026-09-30T20:00Z', '[{"k":"beef","expected":6,"counted":4}]');
select pg_temp.count_session('d', 'daily', '2026-10-20T14:00Z', '[{"k":"farina","expected":21,"counted":20}]');
select pg_temp.count_session('m', 'monthly', '2026-10-31T10:00Z', jsonb_build_array(
  jsonb_build_object('k', 'beef', 'expected', 7, 'counted', 6.8), jsonb_build_object('k', 'farina', 'expected', 20, 'counted', 20),
  jsonb_build_object('k', 'olio', 'expected', 9, 'counted', 9), jsonb_build_object('k', 'sale', 'expected', 1, 'counted', 1.5),
  jsonb_build_object('k', 'burro', 'expected', 2, 'counted', 1.75), jsonb_build_object('k', 'uova', 'expected', -6, 'counted', 0)));

-- Beef: opening 4 (6 received in September, count -2), receipts 10, consumption 3, waste 2 (a 0,5 operation reversed), 2 to the Freezer
select pg_temp.lot('b1', 'beef', 'cella', 6, '2026-09-10', '2026-11-01');
select pg_temp.mv('beef', 'count', -2, '2026-09-30', 'b1', 'cella', 'count_session', pg_temp.id('p'));
select pg_temp.lot('b2', 'beef', 'cella', 10, '2026-10-05', '2026-11-20');
select pg_temp.mv('beef', 'consumption', -3, '2026-10-08', 'b1');
select pg_temp.mv('beef', 'waste', -1, '2026-10-09', 'b1', 'cella', 'manual', '99000000-0000-4000-8000-000000000001', 'spoilage');
select pg_temp.mv('beef', 'waste', -1, '2026-10-09', 'b2', 'cella', 'manual', '99000000-0000-4000-8000-000000000001', 'spoilage');
select pg_temp.mv('beef', 'waste', -0.5, '2026-10-09', 'b2', 'cella', 'manual', '99000000-0000-4000-8000-000000000002', 'spoilage');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, reason_code, ref_type, ref_id,
    reverses_id, effective_on, created_by)
  select tenant_id, ingredient_id, raw_lot_id, location_id, type, 0.5, reason_code, 'reversal', gen_random_uuid(), id, '2026-10-10', created_by
    from public.stock_movement where ref_id = '99000000-0000-4000-8000-000000000002';
select pg_temp.mv('beef', 'transfer', -2, '2026-10-12', 'b2', 'cella', 'transfer', '99000000-0000-4000-8000-000000000003');
select pg_temp.mv('beef', 'transfer', 2, '2026-10-12', 'b2', 'freezer', 'transfer', '99000000-0000-4000-8000-000000000003');
select pg_temp.mv('beef', 'count', -0.2, '2026-10-31', 'b2', 'cella', 'count_session', pg_temp.id('m'), null, 10);

-- Farina: receipts 25, consumption 4, daily count -1 on 20 October, no difference at the monthly count
select pg_temp.lot('f1', 'farina', 'cella', 25, '2026-10-03', '2026-12-01');
select pg_temp.mv('farina', 'consumption', -4, '2026-10-10', 'f1');
select pg_temp.mv('farina', 'count', -1, '2026-10-20', 'f1', 'cella', 'count_session', pg_temp.id('d'), null, 10);

-- Uova: opening 30, receipts 60, consumption 90, waste 6 on top of an empty stock (unlotted -6), count +6
select pg_temp.lot('u1', 'uova', 'cella', 30, '2026-09-12', '2026-10-30');
select pg_temp.lot('u2', 'uova', 'cella', 60, '2026-10-04', '2026-11-10');
select pg_temp.mv('uova', 'consumption', -30, '2026-10-15', 'u1');
select pg_temp.mv('uova', 'consumption', -60, '2026-10-15', 'u2');
select pg_temp.mv('uova', 'waste', -6, '2026-10-16', null, 'cella', 'manual', gen_random_uuid(), 'breakage');
select pg_temp.mv('uova', 'count', 6, '2026-10-31', null, 'cella', 'count_session', pg_temp.id('m'), null, 10);

-- Sale: 1 kg from the Freezer, count +0,5 without a price
select pg_temp.lot('s1', 'sale', 'freezer', 1, '2026-09-15', null);
select pg_temp.mv('sale', 'transfer', -1, '2026-10-15', 's1', 'freezer', 'transfer', '99000000-0000-4000-8000-000000000004');
select pg_temp.mv('sale', 'transfer', 1, '2026-10-15', 's1', 'cella', 'transfer', '99000000-0000-4000-8000-000000000004');
select pg_temp.mv('sale', 'count', 0.5, '2026-10-31', null, 'cella', 'count_session', pg_temp.id('m'));

-- Burro: opening 2, count -0,25
select pg_temp.lot('r1', 'burro', 'cella', 2, '2026-09-20', '2026-11-30');
select pg_temp.mv('burro', 'count', -0.25, '2026-10-31', 'r1', 'cella', 'count_session', pg_temp.id('m'), null, 10);

-- Olio: opening 5, receipts 10, consumption 6 dated on the DST day
select pg_temp.lot('o1', 'olio', 'cella', 5, '2026-09-18', null);
select pg_temp.lot('o2', 'olio', 'cella', 10, '2026-10-06', null);
select pg_temp.mv('olio', 'consumption', -5, '2026-10-25', 'o1');
select pg_temp.mv('olio', 'consumption', -1, '2026-10-25', 'o2');

-- Tenant B: one ingredient, one receipt
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('2a000000-0000-4000-8000-00000000002a', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on,
    qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  values ('10700000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
    '2a000000-0000-4000-8000-00000000002a', '10000000-0000-4000-8000-0000000000b1',
    '5b000000-0000-4000-8000-00000000005b', pg_temp.new_line('22222222-2222-4222-8222-222222222222'), 'L-B1',
    '2026-10-02', 2, 'kg', 2, 'kg', 1, 'b1000000-0000-4000-8000-00000000000b');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id,
    effective_on, created_by)
  values ('22222222-2222-4222-8222-222222222222', '2a000000-0000-4000-8000-00000000002a',
    '10700000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'receipt', 2, 10, 'invoice_line',
    (select id from public.invoice_line where tenant_id = '22222222-2222-4222-8222-222222222222' limit 1),
    '2026-10-02', 'b1000000-0000-4000-8000-00000000000b');

-- Helpers ----------------------------------------------------------------------------------------------------
create function pg_temp.pat() returns timestamptz language sql as $$ select '2027-06-15T02:45:00Z'::timestamptz $$;
create function pg_temp.runs(p_job text, p_ago interval, p_ok boolean default true) returns void language sql as $$
  insert into app.job_run (job, started_at, finished_at, ok, error_code, items)
    values (p_job, pg_temp.pat() - p_ago, pg_temp.pat() - p_ago + interval '1 minute', p_ok,
            case when p_ok then null else 'internal' end, 0)
$$;
-- Healthy scheduler: alert-rules ran an hour ago, ledger-invariants 24 hours ago, the oldest record is 48 hours old.
create function pg_temp.healthy() returns void language plpgsql as $$
begin
  delete from app.job_run;
  perform pg_temp.runs('extract', interval '48 hours');
  perform pg_temp.runs('alert-rules', interval '1 hour');
  perform pg_temp.runs('ledger-invariants', interval '24 hours');
end
$$;
create function pg_temp.go() returns integer language sql as $$ select app.run_ledger_invariants(pg_temp.pat()) $$;
create function pg_temp.n_alerts(p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns bigint language sql as $$
  select count(*) from public.alert where kind = 'ledger_drift' and tenant_id = p_tenant
$$;
-- The checks of a tenant's alert: key[/job]:rows, ordered.
create function pg_temp.summary(p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns text language sql as $$
  select coalesce(string_agg(c->>'check_key' || coalesce('/' || (c->>'job_key'), '') || ':' || (c->>'rows_count'), ','
                             order by c->>'check_key', c->>'job_key'), '-')
    from public.alert a cross join lateral jsonb_array_elements(a.payload->'checks') c
   where a.kind = 'ledger_drift' and a.tenant_id = p_tenant
$$;
-- One run over the current state: summary | first sample id | audience | business date | alerts of A | alerts of B.
create function pg_temp.drift_case() returns text language plpgsql as $$
declare
  v_runs integer := pg_temp.go();
begin
  return v_runs || '|' || pg_temp.summary() || '|'
    || coalesce((select a.payload->'checks'->0->'sample_ids'->>0 from public.alert a
                  where a.kind = 'ledger_drift' and a.tenant_id = '11111111-1111-4111-8111-111111111111'), '-') || '|'
    || coalesce((select a.audience_roles::text || ' ' || a.business_date::text || ' ' || a.severity::text from public.alert a
                  where a.kind = 'ledger_drift' and a.tenant_id = '11111111-1111-4111-8111-111111111111'), '-') || '|'
    || pg_temp.n_alerts() || '|' || pg_temp.n_alerts('22222222-2222-4222-8222-222222222222');
end
$$;
create function pg_temp.bad_lot(p_id uuid, p_qty numeric) returns void language sql as $$
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on,
      qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', pg_temp.id('beef'), '10000000-0000-4000-8000-0000000000a1',
      '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(), 'L-BAD', '2026-10-20', p_qty, 'kg', p_qty, 'kg', 1,
      'a1000000-0000-4000-8000-00000000000a')
$$;
create function pg_temp.raw_mv(p_id uuid, p_ing text, p_type text, p_qty numeric, p_lot uuid, p_loc text, p_ref_type text, p_ref uuid,
    p_by uuid default 'c1000000-0000-4000-8000-00000000000c', p_reverses uuid default null, p_reason text default null,
    p_cost numeric default null) returns void language sql as $$
  insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code,
      ref_type, ref_id, reverses_id, effective_on, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), p_lot,
      case p_loc when 'cella' then '10000000-0000-4000-8000-0000000000a1' else '10000000-0000-4000-8000-0000000000a2' end::uuid,
      p_type::public.stock_movement_type, p_qty, p_cost, p_reason, p_ref_type, p_ref, p_reverses, '2026-10-31', p_by)
$$;
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

select pg_temp.healthy();

-- Clean ---------------------------------------------------------------------------------------------------
savepoint clean;
select is(pg_temp.drift_case(), '0|-|-|-|0|0', 'AT5 clean: the run finds no tenant with findings and raises no alert');
select is((select ok::text || ' ' || items::text || ' ' || coalesce(error_code, '-') from app.job_run
            where job = 'ledger-invariants' order by id desc limit 1), 'true 0 -', '... and records one ok run with 0 items');
select is((select count(*)::int from app.alert_refusal), 0, '... and no refusal');
rollback to savepoint clean;

-- Each ledger check, one seeded inconsistency at a time ----------------------------------------------------------
savepoint c1;
select pg_temp.bad_lot('ff000000-0000-4000-8000-000000000001', 3);
select is(pg_temp.drift_case(), '1|lot_receipt_missing:1|ff000000-0000-4000-8000-000000000001|{owner} 2027-06-15 critical|1|0',
  'a lot without a receipt: one alert for A, owner only, dated by the Rome day of p_at, none for B');
rollback to savepoint c1;

savepoint c2;
select pg_temp.raw_mv('ff000000-0000-4000-8000-000000000002', 'beef', 'receipt', 1, pg_temp.id('b1'), 'cella', 'invoice_line',
  pg_temp.new_line(), p_cost => 10);
select is(pg_temp.drift_case(), '1|receipt_lot_mismatch:1|ff000000-0000-4000-8000-000000000002|{owner} 2027-06-15 critical|1|0',
  'a receipt that does not match its lot');
rollback to savepoint c2;

savepoint c3;
select pg_temp.raw_mv('ff000000-0000-4000-8000-000000000003', 'farina', 'consumption', -0.1, pg_temp.id('f1'), 'cella', 'manual',
  gen_random_uuid(), 'b1000000-0000-4000-8000-00000000000b');
select is(pg_temp.drift_case(), '1|movement_user:1|ff000000-0000-4000-8000-000000000003|{owner} 2027-06-15 critical|1|0',
  'a movement whose user belongs to another tenant');
rollback to savepoint c3;

savepoint c4;
select pg_temp.raw_mv('ff000000-0000-4000-8000-000000000004', 'burro', 'consumption', -3, pg_temp.id('r1'), 'cella', 'manual', gen_random_uuid());
select is(pg_temp.drift_case(), '1|lot_negative:1|' || pg_temp.id('r1') || '|{owner} 2027-06-15 critical|1|0', 'a lot bucket below zero');
rollback to savepoint c4;

savepoint c5;
alter table public.stock_movement disable trigger stock_movement_reversal_guard;
select pg_temp.raw_mv('ff000000-0000-4000-8000-000000000005', 'beef', 'waste', 0.7, pg_temp.id('b1'), 'cella', 'reversal', gen_random_uuid(),
  p_reverses => (select id from public.stock_movement where ref_id = '99000000-0000-4000-8000-000000000001' and raw_lot_id = pg_temp.id('b1')),
  p_reason => 'spoilage');
select is(pg_temp.drift_case(), '1|reversal_mirror:1|ff000000-0000-4000-8000-000000000005|{owner} 2027-06-15 critical|1|0',
  'a reversal that does not mirror its original');
rollback to savepoint c5;

savepoint c6;
select pg_temp.raw_mv('ff000000-0000-4000-8000-000000000006', 'sale', 'transfer', -1, pg_temp.id('s1'), 'cella', 'transfer', gen_random_uuid());
select is(pg_temp.drift_case(), '1|transfer_unbalanced:1|ff000000-0000-4000-8000-000000000006|{owner} 2027-06-15 critical|1|0',
  'a transfer operation with one leg');
rollback to savepoint c6;

savepoint c7;
select pg_temp.raw_mv('ff000000-0000-4000-8000-000000000007', 'farina', 'count', 1, pg_temp.id('f1'), 'cella', 'count_session', pg_temp.id('m'), p_cost => 10);
select is(pg_temp.drift_case(), '1|count_mismatch:1|' || (select l.id from public.count_line l where l.session_id = pg_temp.id('m')
    and l.ingredient_id = pg_temp.id('farina')) || '|{owner} 2027-06-15 critical|1|0',
  'a count row on a line whose difference is 0');
rollback to savepoint c7;

savepoint c8;
insert into public.count_session (id, tenant_id, location_id, type, started_by)
  values ('ff000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a2', 'daily',
          'c1000000-0000-4000-8000-00000000000c');
select pg_temp.raw_mv('ff000000-0000-4000-8000-000000000009', 'beef', 'count', -0.1, pg_temp.id('b2'), 'freezer', 'count_session',
  'ff000000-0000-4000-8000-000000000008', p_cost => 10);
select is(pg_temp.drift_case(), '1|count_mismatch:1|ff000000-0000-4000-8000-000000000009|{owner} 2027-06-15 critical|1|0',
  'a count row on an open session');
rollback to savepoint c8;

-- Two inconsistencies: one alert listing two checks; a second run the same day: still one alert.
savepoint two;
select pg_temp.bad_lot('ff000000-0000-4000-8000-000000000001', 3);
select pg_temp.raw_mv('ff000000-0000-4000-8000-000000000004', 'burro', 'consumption', -3, pg_temp.id('r1'), 'cella', 'manual', gen_random_uuid());
select is(split_part(pg_temp.drift_case(), '|', 1) || '|' || split_part(pg_temp.drift_case(), '|', 2), '1|lot_negative:1,lot_receipt_missing:1',
  'two inconsistencies: one alert listing two checks');
select is(pg_temp.n_alerts(), 1::bigint, 'a second run the same Rome day: still one alert');
rollback to savepoint two;

-- Job health -------------------------------------------------------------------------------------------------
savepoint j1;
select pg_temp.healthy();
delete from app.job_run where job = 'alert-rules';
select pg_temp.runs('alert-rules', interval '4 hours');
select is(pg_temp.drift_case(), '2|job_stale/alert-rules:1|-|{owner} 2027-06-15 critical|1|1',
  'no alert-rules run for 4 hours: job_stale in every tenant''s alert');
rollback to savepoint j1;

savepoint j1b;
delete from app.job_run where job = 'ledger-invariants';
select pg_temp.runs('ledger-invariants', interval '27 hours');
select is(pg_temp.drift_case(), '2|job_stale/ledger-invariants:1|-|{owner} 2027-06-15 critical|1|1', 'the previous nightly run 27 hours ago: job_stale');
rollback to savepoint j1b;

savepoint j1c;
delete from app.job_run where job = 'ledger-invariants';
select pg_temp.runs('ledger-invariants', interval '25 hours');
select is(pg_temp.drift_case(), '0|-|-|-|0|0', 'the previous nightly run 25 hours ago is still fine (window 26 hours)');
rollback to savepoint j1c;

savepoint j2;
select pg_temp.runs('extract', interval '3 hours', false);
select is(pg_temp.drift_case(), '2|job_failed/extract:1|-|{owner} 2027-06-15 critical|1|1', 'a failed extract run 3 hours ago: job_failed');
rollback to savepoint j2;

savepoint j3;
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, created_at)
  values ('e5000000-0000-4000-8000-0000000000e5', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2027/e5000000-0000-4000-8000-0000000000e5.pdf', 'application/pdf', 2048,
          'received', pg_temp.pat() - interval '2 hours');
select is(pg_temp.drift_case(), '1|extract_backlog:1|e5000000-0000-4000-8000-0000000000e5|{owner} 2027-06-15 critical|1|0',
  'an invoice waiting 2 hours: extract_backlog for A only');
rollback to savepoint j3;

savepoint j3b;
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, created_at, next_attempt_at)
  values ('e5000000-0000-4000-8000-0000000000e5', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2027/e5000000-0000-4000-8000-0000000000e5.pdf', 'application/pdf', 2048,
          'received', pg_temp.pat() - interval '2 hours', pg_temp.pat() + interval '1 hour');
select is(pg_temp.drift_case(), '0|-|-|-|0|0', 'an invoice whose retry is not due yet is not a backlog');
rollback to savepoint j3b;

savepoint j4;
insert into app.alert_refusal (tenant_id, kind, caller, code, sqlstate, at)
  values ('11111111-1111-4111-8111-111111111111', 'negative_stock', 'test_caller', 'check_failed', '22012', pg_temp.pat() - interval '2 hours');
select is(pg_temp.drift_case(), '1|alerts_refused:1|-|{owner} 2027-06-15 critical|1|0', 'a refused alert 2 hours ago: alerts_refused for A only');
rollback to savepoint j4;

-- The look-back is everything since the previous ledger-invariants run started (the run is a few tenths of a second
-- later every night, so a fixed 24 hours would miss what happened right after the previous check).
savepoint j8;
select pg_temp.healthy();
delete from app.job_run where job = 'ledger-invariants';
select pg_temp.runs('ledger-invariants', interval '24 hours 0.3 seconds');
select pg_temp.runs('extract', interval '24 hours 0.2 seconds', false);
select is(pg_temp.drift_case(), '2|job_failed/extract:1|-|{owner} 2027-06-15 critical|1|1',
  'a failed run 24 hours 0.2 s ago, after the previous check started 24 hours 0.3 s ago: reported');
rollback to savepoint j8;

savepoint j8b;
select pg_temp.healthy();
delete from app.job_run where job = 'ledger-invariants';
select pg_temp.runs('ledger-invariants', interval '24 hours 0.3 seconds');
select pg_temp.runs('extract', interval '24 hours 1 second', false);
select is(pg_temp.drift_case(), '0|-|-|-|0|0', 'a failed run before the previous check started was reported then: not reported twice');
rollback to savepoint j8b;

savepoint j8c;
select pg_temp.healthy();
delete from app.job_run where job = 'ledger-invariants';
select pg_temp.runs('ledger-invariants', interval '24 hours 0.3 seconds');
insert into app.alert_refusal (tenant_id, kind, caller, code, sqlstate, at)
  values ('11111111-1111-4111-8111-111111111111', 'negative_stock', 'test_caller', 'check_failed', '22012',
          pg_temp.pat() - interval '24 hours 0.2 seconds');
select is(pg_temp.drift_case(), '1|alerts_refused:1|-|{owner} 2027-06-15 critical|1|0',
  'a refusal 24 hours 0.2 s ago, after the previous check started: reported for that tenant only');
rollback to savepoint j8c;

savepoint j9;
select pg_temp.healthy();
select pg_temp.runs('auth-purge', interval '27 hours');
select is(pg_temp.drift_case(), '2|job_stale/auth-purge:1|-|{owner} 2027-06-15 critical|1|1', 'the last auth-purge run 27 hours ago: job_stale');
rollback to savepoint j9;

savepoint j9b;
select pg_temp.healthy();
select pg_temp.runs('auth-purge', interval '25 hours');
select is(pg_temp.drift_case(), '0|-|-|-|0|0', 'the last auth-purge run 25 hours ago is still fine (window 26 hours)');
rollback to savepoint j9b;

savepoint j9c;
select pg_temp.healthy();
select pg_temp.runs('auth-purge', interval '30 hours');
select pg_temp.runs('auth-purge', interval '2 hours', false);
select is(pg_temp.drift_case(), '2|job_failed/auth-purge:1,job_stale/auth-purge:1|-|{owner} 2027-06-15 critical|1|1',
  'only failed runs for 26 hours: auth-purge is stale (a successful run is needed) and failed');
rollback to savepoint j9c;

savepoint j5;
delete from app.job_run;
select pg_temp.runs('alert-rules', interval '1 hour');
select is(pg_temp.drift_case(), '0|-|-|-|0|0', 'a database whose oldest run record is 1 hour old: nothing is judged stale');
rollback to savepoint j5;

savepoint j5b;
delete from app.job_run;
insert into app.job_run (job, started_at, finished_at, ok, items)
  select 'alert-rules', pg_temp.pat() - g * interval '1 hour', pg_temp.pat() - g * interval '1 hour' + interval '1 minute', true, 0
    from generate_series(1, 720) g;
select is(pg_temp.drift_case(), '0|-|-|-|0|0',
  'weeks of alert-rules history and the very first ledger-invariants run: the new job is not judged stale');
rollback to savepoint j5b;

savepoint j6;
select cron.unschedule('alert-rules');
select is(pg_temp.drift_case(), '2|job_unscheduled/alert-rules:1|-|{owner} 2027-06-15 critical|1|1', 'a missing cron job: job_unscheduled');
rollback to savepoint j6;

savepoint j7;
select cron.alter_job((select jobid from cron.job where jobname = 'extract-invoices'), active => false);
select is(pg_temp.drift_case(), '2|job_unscheduled/extract-invoices:1|-|{owner} 2027-06-15 critical|1|1', 'an inactive cron job: job_unscheduled');
rollback to savepoint j7;

savepoint j7b;
select cron.alter_job((select jobid from cron.job where jobname = 'auth-purge'), active => false);
select is(pg_temp.drift_case(), '2|job_unscheduled/auth-purge:1|-|{owner} 2027-06-15 critical|1|1', 'the M11 auth-purge job is watched too');
rollback to savepoint j7b;

-- Containment ----------------------------------------------------------------------------------------------------
savepoint contain;
create or replace function app.ledger_checks_body(p_tenant uuid, p_at timestamptz)
  returns table (check_key text, rows_count integer, sample_ids uuid[])
  language plpgsql security definer set search_path = ''
as $$
begin
  if p_tenant = '11111111-1111-4111-8111-111111111111' then
    perform 1 / 0;
  end if;
  return query select 'lot_negative'::text, 1, '{}'::uuid[];
end
$$;
select is(pg_temp.go(), 1, 'a failing tenant does not stop the others: the run returns normally');
select is(pg_temp.n_alerts('22222222-2222-4222-8222-222222222222'), 1::bigint, '... tenant B was still checked');
select is(pg_temp.n_alerts(), 0::bigint, '... tenant A raised nothing');
select is((select code || ' ' || sqlstate || ' ' || caller || ' ' || kind from app.alert_refusal
            where tenant_id = '11111111-1111-4111-8111-111111111111'), 'check_failed 22012 ledger_invariants ledger_drift',
  '... and one check_failed refusal was recorded for A');
select is((select ok::text || ' ' || coalesce(error_code, '-') || ' ' || items::text from app.job_run
            where job = 'ledger-invariants' order by id desc limit 1), 'false check_failed 1', '... the run is recorded as failed with 1 item');
rollback to savepoint contain;

-- A tenant whose check raises two nights in a row still reaches its owner: the second night reports last night's
-- check_failed refusal and the failed ledger-invariants run, though that tenant's ledger checks raise again.
savepoint twice;
create or replace function app.ledger_checks_body(p_tenant uuid, p_at timestamptz)
  returns table (check_key text, rows_count integer, sample_ids uuid[])
  language plpgsql security definer set search_path = ''
as $$
begin
  if p_tenant = '11111111-1111-4111-8111-111111111111' then
    perform 1 / 0;
  end if;
  return;
end
$$;
delete from app.job_run;
select pg_temp.go();
select is(pg_temp.n_alerts(), 0::bigint, 'night 1, a body that raises: no alert yet, a check_failed refusal is recorded');
-- the first night happened 24 hours 0.3 s earlier
update app.job_run set started_at = pg_temp.pat() - interval '24 hours 0.3 seconds',
  finished_at = pg_temp.pat() - interval '24 hours 0.3 seconds' + interval '1 minute' where job = 'ledger-invariants';
update app.alert_refusal set at = pg_temp.pat() - interval '24 hours' where code = 'check_failed';
select pg_temp.runs('alert-rules', interval '1 hour');
select pg_temp.go();
select is(pg_temp.n_alerts(), 1::bigint, 'night 2, the body raises again: the owner of that tenant still gets an alert');
select is(pg_temp.summary(), 'alerts_refused:1,job_failed/ledger-invariants:1',
  '... it reports last night''s check_failed refusal and the failed nightly run');
select is((select count(*)::int from app.alert_refusal where tenant_id = '11111111-1111-4111-8111-111111111111'), 2,
  '... and night 2 records its own refusal for night 3');
rollback to savepoint twice;

-- Shape, schedule, grants ---------------------------------------------------------------------------------------
select is((select length(p.prosrc) - length(replace(p.prosrc, ';', '')) from pg_proc p
            where p.oid = 'app.ledger_checks_body(uuid, timestamptz)'::regprocedure), 1,
  'the ledger checks are one statement (one snapshot)');
select ok((select p.prosrc ~ '^\s*(#variable_conflict use_column\s+)?begin\s+return query' from pg_proc p where p.oid = 'app.ledger_checks_body(uuid, timestamptz)'::regprocedure),
  '... a single return query');
select is((select j.schedule || ' | ' || j.command from cron.job j where j.jobname = 'ledger-invariants'),
  '45 2 * * * | select app.run_ledger_invariants()', 'the nightly job runs at 02:45 UTC');
select is((select j.schedule from cron.job j where j.jobname = 'alert-rules'), '0 * * * *', 'alert-rules is unchanged');
select is((select j.schedule from cron.job j where j.jobname = 'extract-invoices'), '* * * * *', 'extract-invoices is unchanged');
select ok(has_function_privilege('service_role', 'public.ledger_invariants_run(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.ledger_invariants_run(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.ledger_invariants_run(timestamptz)', 'execute'),
  'ledger_invariants_run is for service_role only');
select is((select count(*)::int
             from (values ('app.ledger_checks_body(uuid, timestamptz)'), ('app.job_health_checks(uuid, timestamptz)'),
                          ('app.run_ledger_invariants(timestamptz)')) f (sig)
             cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
            where has_function_privilege(r.rolname, f.sig, 'execute')), 0, 'no API role can execute the app functions');
select is(public.ledger_invariants_run(pg_temp.pat()), '{"tenantsWithFindings": 0}'::jsonb, 'the service wrapper answers with the count of tenants');

select * from finish();
rollback;
