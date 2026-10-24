-- M13 step 9: the role catalogue of the counts (M13 plan §3.1.12, §5 step 9; V6). The eleven public M13 functions are
-- called under each role's claims: the waiter and a caller without claims get 42501 from all of them, the chef from
-- count_variance_costs and audit_log only, the owner and admin from none. Direct writes to the count and ledger tables
-- are refused to every API role. Nothing a chef reads carries a cost-like key. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('e0000000-0000-4000-8000-0000000000e0', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111',
   'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('e1000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-0000000000e0', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
-- Two invoices that wait for approval (review, received) and one already approved.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e3000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e3000000-0000-4000-8000-0000000000e3.pdf',
   'application/pdf', 2048, 'received', null);
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status) values
  ('e4000000-0000-4000-8000-0000000000e4', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e4000000-0000-4000-8000-0000000000e4.pdf',
   'application/pdf', 2048, 'rejected');

create temporary table reg (k text primary key, id uuid not null);
create temporary table results (k text primary key, j jsonb);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create function pg_temp.res(p_k text) returns jsonb language sql as $$ select j from results where k = p_k $$;
create function pg_temp.sid(p_k text) returns uuid language sql as $$ select (j->>'id')::uuid from results where k = p_k $$;

-- Switch identity: 'super' is the migration owner; the others set the role and the claims.
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
    ('admin', 'ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111'),
    ('chef', 'c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111'),
    ('waiter', 'e0000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111'),
    ('ownerb', 'b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222')) w (who, auth_id, tenant)
   where w.who = p_who;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v.auth_id, 'role', 'authenticated',
    'tenant_id', v.tenant, 'app_role', case p_who when 'ownerb' then 'owner' else p_who end)::text, true);
end
$$;
-- Runs a statement that returns jsonb as p_who; stores the answer under p_key; returns 'ok' or 'SQLSTATE message'.
create function pg_temp.run(p_key text, p_who text, p_sql text) returns text language plpgsql as $$
declare
  v jsonb;
  state text;
  msg text;
begin
  perform pg_temp.as2(p_who);
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

create sequence pg_temp.line_seq;
create function pg_temp.new_line() returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1',
            v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  return v_line;
end
$$;
-- An ingredient of tenant A with a lot of p_qty kg at Cella (receipt at unit_cost 10) and, when p_price is set, a
-- purchase price (the cost basis the count rows freeze).
create function pg_temp.mk(p_k text, p_name text, p_qty numeric, p_critical boolean default false, p_price numeric default 10,
    p_stock boolean default true, p_active boolean default true) returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock, is_critical, is_active)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', p_name, 'kg', p_stock, p_critical, p_active);
  if p_qty > 0 then
    insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
        expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
      values (v_lot, '11111111-1111-4111-8111-111111111111', pg_temp.id(p_k), '10000000-0000-4000-8000-0000000000a1',
        '5a000000-0000-4000-8000-00000000005a', v_line, 'L-' || p_k, '2026-11-20', '2026-10-20', p_qty, 'kg', p_qty,
        'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
        ref_type, ref_id, effective_on, created_by)
      values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_k), v_lot, '10000000-0000-4000-8000-0000000000a1',
        'receipt', p_qty, 10, 'invoice_line', v_line, '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');
  end if;
  if p_price is not null then
    insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
        effective_on, created_by)
      values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_k), '5a000000-0000-4000-8000-00000000005a',
        pg_temp.new_line(), p_price, 'kg', '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');
  end if;
end
$$;
create function pg_temp.on_hand(p_k text) returns numeric language sql as $$
  select app.location_on_hand('11111111-1111-4111-8111-111111111111', pg_temp.id(p_k), '10000000-0000-4000-8000-0000000000a1')
$$;
create function pg_temp.counts(p_k text) returns numeric language sql as $$
  select coalesce(sum(qty), 0) from public.stock_movement where ingredient_id = pg_temp.id(p_k) and type = 'count'
$$;
create function pg_temp.count_rows(p_session uuid) returns bigint language sql as $$
  select count(*) from public.stock_movement where ref_type = 'count_session' and ref_id = p_session
$$;
-- One line element for count_record_lines.
create function pg_temp.ln(p_k text, p_qty numeric, p_unit text default 'kg') returns jsonb language sql as $$
  select jsonb_build_object('ingredient_id', pg_temp.id(p_k), 'qty', p_qty, 'unit', p_unit)
$$;
create function pg_temp.rec(p_key text, p_who text, p_session uuid, p_lines jsonb) returns text language sql as $$
  select pg_temp.run(p_key, p_who, format($f$ select public.count_record_lines(%L, %L::jsonb) $f$, p_session, p_lines::text))
$$;
create function pg_temp.audit_n(p_action text) returns bigint language sql as $$
  select count(*) from public.audit_event where action = p_action
$$;


create function pg_temp.bad_keys(j jsonb) returns boolean language sql as $$
  select j::text ~* '"[^"]*(cost|price|eur|value|amount|margin)[^"]*"\s*:'
$$;
-- Identity for the matrix: 'noclaims' is an authenticated session without claims.
create function pg_temp.as2(p_who text) returns void language plpgsql as $$
begin
  if p_who = 'noclaims' then
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', '', true);
  else
    perform pg_temp.as_(p_who);
  end if;
end
$$;
-- The result of one statement as 'ok' or the SQLSTATE, run under p_who.
create function pg_temp.state(p_who text, p_sql text) returns text language plpgsql as $$
declare
  state text;
begin
  perform pg_temp.as2(p_who);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics state = returned_sqlstate;
    perform pg_temp.as_('super');
    return state;
  end;
  perform pg_temp.as_('super');
  return 'ok';
end
$$;
-- The state of one run: 'ok' or the SQLSTATE.
create function pg_temp.st(p_run text) returns text language sql as $$ select case when p_run = 'ok' then 'ok' else left(p_run, 5) end $$;
-- The eleven functions in a fixed order (start, save, close, cancel, critical flag, list, view, variance, variance in EUR,
-- reconciliation, activity log). A caller who may write runs the chain start, save, close, start, cancel on real sessions;
-- the others run it on p_closed (the role check comes first, so nothing else is reached). p_closed is a closed session.
create function pg_temp.matrix(p_who text, p_closed uuid) returns text language plpgsql as $$
declare
  v_loc text := '10000000-0000-4000-8000-0000000000a1';
  v_out text[] := '{}';
  v_a uuid;
  v_b uuid;
begin
  delete from results where k like 'm\_%';
  v_out := v_out || pg_temp.st(pg_temp.run('m_start', p_who, $f$ select public.count_start('daily') $f$));
  v_a := coalesce((select (j->>'id')::uuid from results where k = 'm_start'), p_closed);
  v_out := v_out || pg_temp.st(pg_temp.run('m_rec', p_who, format($f$ select public.count_record_lines(%L, %L::jsonb) $f$, v_a,
    jsonb_build_array(pg_temp.ln('beef', 4))::text)));
  v_out := v_out || pg_temp.st(pg_temp.run('m_close', p_who, format($f$ select public.count_close(%L) $f$, v_a)));
  perform pg_temp.run('m_start2', p_who, $f$ select public.count_start('daily') $f$);
  v_b := coalesce((select (j->>'id')::uuid from results where k = 'm_start2'), p_closed);
  v_out := v_out || pg_temp.st(pg_temp.run('m_cancel', p_who, format($f$ select public.count_cancel(%L) $f$, v_b)));
  v_out := v_out || pg_temp.st(pg_temp.run('m_crit', p_who, format($f$ select public.set_ingredient_critical(%L, true) $f$, pg_temp.id('beef'))));
  v_out := v_out || pg_temp.st(pg_temp.run('m_list', p_who, $f$ select public.count_sessions() $f$));
  v_out := v_out || pg_temp.st(pg_temp.run('m_view', p_who, format($f$ select public.count_session_view(%L) $f$, p_closed)));
  v_out := v_out || pg_temp.st(pg_temp.run('m_var', p_who, format($f$ select public.count_variance(%L) $f$, p_closed)));
  v_out := v_out || pg_temp.st(pg_temp.run('m_varc', p_who, format($f$ select public.count_variance_costs(%L) $f$, p_closed)));
  v_out := v_out || pg_temp.st(pg_temp.run('m_rec2', p_who, format($f$ select public.stock_reconciliation('2026-10-01', '2026-10-31', %L) $f$, v_loc)));
  v_out := v_out || pg_temp.st(pg_temp.run('m_audit', p_who, $f$ select public.audit_log('2026-10-01', '2026-10-31') $f$));
  return array_to_string(v_out, ',');
end
$$;

select pg_temp.mk('beef', 'Manzo muscolo (demo)', 5, true);
-- A closed count to read.
select pg_temp.quiet(pg_temp.run('s0', 'owner', $$ select public.count_start('daily') $$));
select pg_temp.quiet(pg_temp.rec('x', 'owner', pg_temp.sid('s0'), jsonb_build_array(pg_temp.ln('beef', 4.5))));
select pg_temp.quiet(pg_temp.run('x', 'owner', format($f$ select public.count_close(%L) $f$, pg_temp.sid('s0'))));

select is(pg_temp.matrix('waiter', pg_temp.sid('s0')), '42501,42501,42501,42501,42501,42501,42501,42501,42501,42501,42501',
  'the waiter is refused by all eleven functions');
select is(pg_temp.matrix('noclaims', pg_temp.sid('s0')), '42501,42501,42501,42501,42501,42501,42501,42501,42501,42501,42501',
  'a session without claims is refused by all eleven');
select is(pg_temp.matrix('owner', pg_temp.sid('s0')), 'ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok', 'the owner may call all eleven');
select is(pg_temp.matrix('admin', pg_temp.sid('s0')), 'ok,ok,ok,ok,ok,ok,ok,ok,ok,ok,ok', 'the admin may call all eleven');
select is(pg_temp.matrix('chef', pg_temp.sid('s0')), 'ok,ok,ok,ok,ok,ok,ok,ok,42501,ok,42501',
  'the chef may call nine: count_variance_costs and audit_log are refused');
select ok(not (pg_temp.bad_keys(pg_temp.res('m_list')) or pg_temp.bad_keys(pg_temp.res('m_view')) or pg_temp.bad_keys(pg_temp.res('m_var'))
               or pg_temp.bad_keys(pg_temp.res('m_rec2')) or pg_temp.bad_keys(pg_temp.res('m_start')) or pg_temp.bad_keys(pg_temp.res('m_rec'))
               or pg_temp.bad_keys(pg_temp.res('m_close'))), 'what the chef reads has no cost-like key');
select ok(not ((pg_temp.res('m_list')::text || pg_temp.res('m_view') || pg_temp.res('m_var') || pg_temp.res('m_rec2') || pg_temp.res('m_close')) like '%€%'),
  '... and no euro sign');

-- Direct writes: no API role -----------------------------------------------------------------------------------------
select is((select count(*)::int
             from (values ('owner'), ('admin'), ('chef'), ('waiter')) w (who)
             cross join (values
               ($$ insert into public.count_session (location_id, type, started_by) values ('10000000-0000-4000-8000-0000000000a1', 'daily', 'a1000000-0000-4000-8000-00000000000a') $$),
               ($$ update public.count_session set status = 'cancelled' $$),
               ($$ delete from public.count_session $$),
               ($$ insert into public.count_line (session_id, ingredient_id, position) values (gen_random_uuid(), gen_random_uuid(), 1) $$),
               ($$ update public.count_line set counted_qty = 1 $$),
               ($$ delete from public.count_line $$),
               ($$ insert into public.stock_movement (ingredient_id, location_id, type, qty, effective_on) values (gen_random_uuid(), gen_random_uuid(), 'count', 1, '2026-10-31') $$),
               ($$ update public.stock_movement set qty = 1 $$),
               ($$ delete from public.stock_movement $$)) s (sql)
            where pg_temp.state(w.who, s.sql) <> '42501'), 0,
  'owner, admin, chef and waiter cannot insert, update or delete count_session, count_line or stock_movement');

select pg_temp.as_('waiter');
select is((select count(*)::int from public.count_session) + (select count(*)::int from public.count_line), 0, 'the waiter reads no session and no line');
select pg_temp.as_('super');

-- Execute grants ---------------------------------------------------------------------------------------------------------
select is((select count(*)::int
             from (values ('public.count_start(text, uuid)'), ('public.count_record_lines(uuid, jsonb)'), ('public.count_close(uuid)'),
                          ('public.count_cancel(uuid)'), ('public.set_ingredient_critical(uuid, boolean)'),
                          ('public.count_sessions(text, timestamptz, uuid, integer)'), ('public.count_session_view(uuid)'),
                          ('public.count_variance(uuid)'), ('public.count_variance_costs(uuid)'),
                          ('public.stock_reconciliation(date, date, uuid)'),
                          ('public.audit_log(date, date, text, timestamptz, uuid, integer)')) f (sig)
             cross join (values ('anon'), ('service_role')) r (rolname)
            where has_function_privilege(r.rolname, f.sig, 'execute')), 0, 'anon and service_role cannot execute any of the eleven');
select is((select count(*)::int
             from (values ('public.count_start(text, uuid)'), ('public.count_record_lines(uuid, jsonb)'), ('public.count_close(uuid)'),
                          ('public.count_cancel(uuid)'), ('public.set_ingredient_critical(uuid, boolean)'),
                          ('public.count_sessions(text, timestamptz, uuid, integer)'), ('public.count_session_view(uuid)'),
                          ('public.count_variance(uuid)'), ('public.count_variance_costs(uuid)'),
                          ('public.stock_reconciliation(date, date, uuid)'),
                          ('public.audit_log(date, date, text, timestamptz, uuid, integer)')) f (sig)
            where has_function_privilege('authenticated', f.sig, 'execute')), 11, 'authenticated can execute all eleven');
select ok(has_function_privilege('service_role', 'public.ledger_invariants_run(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.ledger_invariants_run(timestamptz)', 'execute'),
  'ledger_invariants_run: service_role yes, authenticated no');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('count_start', 'count_record_lines', 'count_close', 'count_cancel',
              'set_ingredient_critical', 'count_sessions', 'count_session_view', 'count_variance', 'count_variance_costs',
              'stock_reconciliation', 'audit_log', 'ledger_invariants_run')
              and not (p.prosecdef and p.proconfig @> array['search_path=""'])), 0,
  'every M13 public function is SECURITY DEFINER with an empty search_path');

select * from finish();
rollback;
