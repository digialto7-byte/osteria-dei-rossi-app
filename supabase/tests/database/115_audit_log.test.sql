-- M13 step 6: audit_log (M13 plan §3.1.11, §5 step 6; AT4). The fixture runs the real procedures under each role's
-- claims (waste, transfer, reversal, critical flag, count) plus one seeded invoice.approved event; the created_at of
-- the rows is then set to chosen instants (the append-only triggers are switched off for that statement). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

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
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Freezer (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id, number_raw) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a', 'FT-123/A');

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

-- Fixture ---------------------------------------------------------------------------------------------------
select pg_temp.mk('beef', 'Manzo muscolo (demo)', 10);
select pg_temp.mk('farina', 'Farina di mais (demo)', 5);
insert into public.audit_event (id, tenant_id, entity_type, entity_id, action, after, created_by)
  values ('99000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'invoice',
          'e1000000-0000-4000-8000-0000000000e1', 'invoice.approved', '{"status":"approved"}', 'a1000000-0000-4000-8000-00000000000a');
select pg_temp.quiet(pg_temp.run('w', 'chef', format($f$ select public.post_waste(%L, 1.5, 'kg', 'spoilage', '10000000-0000-4000-8000-0000000000a1') $f$, pg_temp.id('beef'))));
select pg_temp.quiet(pg_temp.run('t', 'owner', format($f$ select public.post_transfer(%L, 2, 'kg', '10000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a2') $f$, pg_temp.id('beef'))));
select pg_temp.quiet(pg_temp.run('rv', 'admin', format($f$ select public.reverse_movement(%L) $f$, pg_temp.res('w')->'movements'->0->>'id')));
select pg_temp.quiet(pg_temp.run('k1', 'chef', format($f$ select public.set_ingredient_critical(%L, true) $f$, pg_temp.id('beef'))));
select pg_temp.quiet(pg_temp.run('k2', 'chef', format($f$ select public.set_ingredient_critical(%L, true) $f$, pg_temp.id('farina'))));
select pg_temp.quiet(pg_temp.run('c', 'chef', $$ select public.count_start('daily', '10000000-0000-4000-8000-0000000000a1') $$));
select pg_temp.quiet(pg_temp.rec('x', 'chef', pg_temp.sid('c'), jsonb_build_array(pg_temp.ln('beef', 7.5), pg_temp.ln('farina', 4))));
select pg_temp.quiet(pg_temp.run('cl', 'chef', format($f$ select public.count_close(%L) $f$, pg_temp.sid('c'))));

-- Chosen instants (2026-10-22, Rome): invoice 10:00, waste 10:10, transfer 10:20, reversal 10:30, flags 10:40, count 10:50.
create function pg_temp.stamp() returns void language plpgsql as $$
begin
  alter table public.stock_movement disable trigger stock_movement_append_only;
  alter table public.audit_event disable trigger audit_event_append_only;
  update public.stock_movement set created_at = case
      when ref_id = (pg_temp.res('w')->>'operationId')::uuid then '2026-10-22T08:10:00Z'::timestamptz
      when ref_id = (pg_temp.res('t')->>'operationId')::uuid then '2026-10-22T08:20:00Z'
      when ref_id = (pg_temp.res('rv')->>'operationId')::uuid then '2026-10-22T08:30:00Z'
      when ref_id = pg_temp.sid('c') then '2026-10-22T08:50:00Z'
      else created_at end
   where type <> 'receipt';
  update public.audit_event set created_at = case
      when id = '99000000-0000-4000-8000-0000000000e1' then '2026-10-22T08:00:00Z'::timestamptz
      when action = 'ingredient.critical_changed' then '2026-10-22T08:40:00Z'
      when action = 'count_session.closed' then '2026-10-22T08:51:00Z'
      else created_at end;
  alter table public.stock_movement enable trigger stock_movement_append_only;
  alter table public.audit_event enable trigger audit_event_append_only;
end
$$;
select pg_temp.stamp();

-- Entries -------------------------------------------------------------------------------------------------
select is(pg_temp.run('a', 'owner', $$ select public.audit_log('2026-10-22', '2026-10-22') $$), 'ok', 'the owner reads the log');
select is(jsonb_array_length(pg_temp.res('a')->'entries'), 9, 'nine entries: five stock operations and four events');
select is(pg_temp.res('a')->>'from' || '..' || (pg_temp.res('a')->>'to'), '2026-10-22..2026-10-22', '... for the period asked');
select is((select string_agg(e->>'kind' || ':' || (e->>'action'), ',' order by ord) from jsonb_array_elements(pg_temp.res('a')->'entries') with ordinality x (e, ord) where ord <= 3),
  'event:count_session.closed,stock:count,stock:count', 'newest first');
select is((select count(*)::int from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'kind' = 'stock'), 5, 'five stock entries');
select is((select e->>'byName' from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'waste'), 'Chef Demo', 'the waste names the chef');
select is((select e->>'byName' from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'transfer'), 'Titolare Demo', 'the transfer names the owner');
select is((select e->>'byName' from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'reversal'), 'Admin Demo', 'the reversal names the admin');
select is((select (e->>'at')::timestamptz from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'waste'),
  '2026-10-22T08:10:00Z'::timestamptz, 'at is the created_at of the operation');
select is((select e->>'qty' || ' ' || (e->>'unit') || ' ' || (e->>'reasonCode') from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'waste'),
  '-1.5000 kg spoilage', 'a waste: net quantity, unit and reason');
select is((select count(*)::int from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'transfer'), 1,
  'a transfer is one entry (not four)');
select is((select e->'locationNames' from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'transfer'),
  '["Cella (demo)", "Freezer (demo)"]'::jsonb, '... with both location names, source first');
select is((select (e->>'qty')::numeric from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'transfer'), 2::numeric,
  '... and the quantity moved');
select is((select (e->>'qty')::numeric from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'reversal'), 1.5, 'the reversal gives back 1,5');
select is((select string_agg(trim_scale((e->>'qty')::numeric)::text, ',' order by e->>'ingredientName') from jsonb_array_elements(pg_temp.res('a')->'entries') e
            where e->>'action' = 'count'), '-1,-0.5', 'the count has one entry per ingredient, with its difference');
select is((select e->>'ingredientName' from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'transfer'),
  'Manzo muscolo (demo)', 'stock entries name the ingredient');
select is((select e->>'entityLabel' from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'invoice.approved'), 'FT-123/A',
  'an invoice event is labelled with the invoice number');
select is((select e->>'entityLabel' from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'count_session.closed'), 'Cella (demo)',
  'a count event is labelled with the location');
select is((select string_agg(e->>'entityLabel', ',' order by e->>'entityLabel') from jsonb_array_elements(pg_temp.res('a')->'entries') e
            where e->>'action' = 'ingredient.critical_changed'), 'Farina di mais (demo),Manzo muscolo (demo)',
  'a critical-flag event is labelled with the ingredient');
select is((select e->>'byName' from jsonb_array_elements(pg_temp.res('a')->'entries') e where e->>'action' = 'count_session.closed'), 'Chef Demo',
  'the closing event names the chef');
select ok((select bool_and((pg_temp.res('a')->'entries'->(n - 1)->>'at')::timestamptz >= (pg_temp.res('a')->'entries'->n->>'at')::timestamptz)
            from generate_series(1, 8) n), 'entries are in newest-first order');
select ok(not (pg_temp.res('a')::text ~* '"(before|after|reason)"\s*:'), 'no entry has before, after or reason');
select ok(not (pg_temp.res('a')::text ~* '"[^"]*(cost|price|eur|value|amount|margin)[^"]*"\s*:'), 'no cost-like key anywhere');

-- Filters and paging ----------------------------------------------------------------------------------------
select pg_temp.quiet(pg_temp.run('ks', 'owner', $$ select public.audit_log('2026-10-22', '2026-10-22', 'stock') $$));
select is((select count(*)::int from jsonb_array_elements(pg_temp.res('ks')->'entries') e where e->>'kind' = 'stock'), 5, 'kind stock: five stock entries');
select is(jsonb_array_length(pg_temp.res('ks')->'entries'), 5, '... and nothing else');
select pg_temp.quiet(pg_temp.run('ke', 'owner', $$ select public.audit_log('2026-10-22', '2026-10-22', 'events') $$));
select is(jsonb_array_length(pg_temp.res('ke')->'entries'), 4, 'kind events: four events');
select is((select count(*)::int from jsonb_array_elements(pg_temp.res('ke')->'entries') e where e->>'kind' = 'event'), 4, '... all of kind event');
create function pg_temp.page_all(p_limit int) returns text language plpgsql as $$
declare
  v_cur jsonb := null;
  v_ids text := '';
  v_page jsonb;
  v_n int := 0;
begin
  loop
    perform pg_temp.as_('owner');
    select public.audit_log('2026-10-22', '2026-10-22', 'all', (v_cur->>'at')::timestamptz, (v_cur->>'id')::uuid, p_limit) into v_page;
    perform pg_temp.as_('super');
    select v_ids || coalesce(string_agg(e->>'id', ',' order by ord), '') || ';' into v_ids
      from jsonb_array_elements(v_page->'entries') with ordinality x (e, ord);
    v_cur := v_page->'nextCursor';
    v_n := v_n + 1;
    exit when v_cur is null or jsonb_typeof(v_cur) = 'null' or v_n > 20;
  end loop;
  return v_ids;
end
$$;
select is(pg_temp.page_all(2) = pg_temp.page_all(2), true, 'paging is deterministic');
select is((select count(distinct x)::int from unnest(string_to_array(replace(pg_temp.page_all(2), ';', ','), ',')) x where x <> ''), 9,
  'pages of 2 cover the nine entries without a repeat');
select is((select count(*)::int from unnest(string_to_array(replace(pg_temp.page_all(2), ';', ','), ',')) x where x <> ''), 9, '... and without a gap');
select is(replace(pg_temp.page_all(2), ';', ','),
  (select string_agg(e->>'id', ',' order by ord) from jsonb_array_elements(pg_temp.res('a')->'entries') with ordinality x (e, ord)) || ',',
  'the pages concatenate to the full list');

-- Defaults, errors, roles ---------------------------------------------------------------------------------
select is(pg_temp.run('df', 'owner', $$ select public.audit_log() $$), 'ok', 'the defaults work');
select is(pg_temp.res('df')->>'from', (select date_trunc('month', now() at time zone t.timezone)::date::text from public.tenant t
            where t.name = 'Osteria Demo A'), '... from the first of the current month');
select is(pg_temp.res('df')->>'to', (select (now() at time zone t.timezone)::date::text from public.tenant t where t.name = 'Osteria Demo A'),
  '... to today');
select is(pg_temp.run('x', 'owner', $$ select public.audit_log('2026-10-23', '2026-10-22') $$), 'P0001 range_invalid', 'from after to is range_invalid');
select is(pg_temp.run('x', 'owner', $$ select public.audit_log('2026-01-01', '2027-01-02') $$), 'P0001 range_too_long', '367 days is range_too_long');
select is(pg_temp.run('x', 'owner', $$ select public.audit_log('2026-10-01', '2026-10-31', 'weekly') $$), '22023 invalid_request', 'an unknown kind is invalid');
select is(pg_temp.run('x', 'owner', $$ select public.audit_log('2026-10-01', '2026-10-31', 'all', null, null, 0) $$), '22023 invalid_request', 'limit 0 is invalid');
select is(pg_temp.run('x', 'owner', $$ select public.audit_log('2026-10-01', '2026-10-31', 'all', now(), null, 5) $$), '22023 invalid_request', 'half a cursor is invalid');
select is(pg_temp.run('x', 'chef', $$ select public.audit_log('2026-10-22', '2026-10-22') $$), '42501 permission denied: the activity log needs owner or admin', 'the chef is refused');
select is(pg_temp.run('x', 'waiter', $$ select public.audit_log('2026-10-22', '2026-10-22') $$), '42501 permission denied: the activity log needs owner or admin', 'the waiter is refused');
select pg_temp.quiet(pg_temp.run('ad', 'admin', $$ select public.audit_log('2026-10-22', '2026-10-22') $$));
select is(jsonb_array_length(pg_temp.res('ad')->'entries'), 9, 'the admin reads the same log');
select pg_temp.quiet(pg_temp.run('b', 'ownerb', $$ select public.audit_log('2026-10-22', '2026-10-22') $$));
select is(jsonb_array_length(pg_temp.res('b')->'entries'), 0, 'owner B sees none of A''s entries');
select is((select count(*)::int from (values ('anon'), ('service_role')) r (rolname)
            where has_function_privilege(r.rolname, 'public.audit_log(date, date, text, timestamptz, uuid, integer)', 'execute')), 0,
  'anon and service_role cannot execute it');

select * from finish();
rollback;
