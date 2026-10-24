-- M13 step 2: the count core in schema app (M13 plan §3.1.5, §3.1.14, §3.2, §5 step 2; ADR-012).
-- The posting engine app.post_count_adjustment is called as the migration owner with an explicit tenant, user and
-- instant. Fake data only. "D" = 2026-10-23 (Rome), the date of the default instant 2026-10-23T10:00Z.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('e0000000-0000-4000-8000-0000000000e0', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111',
   'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('e1000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-0000000000e0', 'waiter', 'Cameriere Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');

create temporary table reg (k text primary key, id uuid not null);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
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
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
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
create function pg_temp.mk_ing(p_k text, p_unit text default 'kg', p_stock boolean default true) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', p_k || ' (demo)', p_unit::public.base_unit, p_stock);
end
$$;
-- A lot with its receipt (unit_cost 10) at Cella.
create function pg_temp.mk_lot(p_key text, p_code text, p_ing text, p_expiry date, p_qty numeric)
  returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
      expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    select v_lot, '11111111-1111-4111-8111-111111111111', i.id, '10000000-0000-4000-8000-0000000000a1',
           '5a000000-0000-4000-8000-00000000005a', v_line, p_code, p_expiry, '2026-10-20', p_qty, i.base_unit, p_qty,
           i.base_unit::text, 1, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
      ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, '10000000-0000-4000-8000-0000000000a1',
      'receipt', p_qty, 10, 'invoice_line', v_line, '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- The standard ingredient: lots L-D2 (2 kg, expiry D+2) and L-D5 (2 kg, expiry D+5), inserted out of FEFO order.
create function pg_temp.std(p_k text) returns void language plpgsql as $$
begin
  perform pg_temp.mk_ing(p_k);
  perform pg_temp.mk_lot(p_k || '_d5', 'L-D5', p_k, '2026-10-28', 2);
  perform pg_temp.mk_lot(p_k || '_d2', 'L-D2', p_k, '2026-10-25', 2);
end
$$;
-- A plain waste of p_qty through the real M12 engine (lots in FEFO order, the rest unlotted).
create function pg_temp.waste(p_ing text, p_qty numeric) returns void language plpgsql as $$
begin
  perform count(*) from app.post_stock_outflow('11111111-1111-4111-8111-111111111111',
    'c1000000-0000-4000-8000-00000000000c', pg_temp.id(p_ing), '10000000-0000-4000-8000-0000000000a1', p_qty,
    'waste', 'spoilage', null, 'manual', gen_random_uuid(), '2026-10-23T10:00Z', null, 'test_caller');
end
$$;

-- One call of the engine. The rows are collected first and read back by a LATER statement (rows written by a
-- function are not visible to the statement that called it). Result: 'lotcode qty, lotcode qty' in insert order
-- ('null' = unlotted), or the unit costs / effective dates / sums of the rows.
create temporary table lastadj (ord bigint, movement_id uuid, raw_lot_id uuid, qty numeric);
create function pg_temp.adj(p_ing text, p_diff numeric, p_cost numeric default 10,
    p_at timestamptz default '2026-10-23T10:00Z', p_what text default 'lots',
    p_session uuid default '51000000-0000-4000-8000-000000000001') returns text language plpgsql as $$
declare
  v_out text;
begin
  truncate lastadj;
  insert into lastadj
    select r.ord, r.movement_id, r.raw_lot_id, r.qty
      from app.post_count_adjustment('11111111-1111-4111-8111-111111111111', 'c1000000-0000-4000-8000-00000000000c',
             pg_temp.id(p_ing), '10000000-0000-4000-8000-0000000000a1', p_diff, p_session, p_at, p_cost)
           with ordinality r (movement_id, raw_lot_id, qty, ord);
  select coalesce(string_agg(
           case p_what when 'lots' then coalesce(l.lot_code, 'null') || ' ' || trim_scale(a.qty)::text
                       when 'cost' then coalesce(m.unit_cost::text, 'null')
                       when 'date' then m.effective_on::text end,
           ', ' order by a.ord), '')
    into v_out
    from lastadj a
    join public.stock_movement m on m.id = a.movement_id
    left join public.raw_lot l on l.id = a.raw_lot_id;
  return v_out;
end
$$;
-- Shape and sums of the last call: rows sum to the difference, no lot bucket below zero.
create function pg_temp.sum_last() returns numeric language sql as $$ select coalesce(sum(qty), 0) from lastadj $$;
create function pg_temp.neg_lots(p_ing text) returns bigint language sql as $$
  select count(*) from (select raw_lot_id from public.stock_movement
                         where ingredient_id = pg_temp.id(p_ing) and raw_lot_id is not null
                         group by raw_lot_id having sum(qty) < 0) x
$$;
create function pg_temp.unlotted(p_ing text) returns numeric language sql as $$
  select coalesce(sum(qty), 0) from public.stock_movement
   where ingredient_id = pg_temp.id(p_ing) and raw_lot_id is null
$$;

-- Allocation --------------------------------------------------------------------------------------------
select pg_temp.std('a1');
select is(pg_temp.adj('a1', -1.5), 'L-D2 -1.5', 'd -1,5 takes 1,5 from the earliest lot');
select is(pg_temp.sum_last(), -1.5, '... and the rows sum to d');

select pg_temp.std('a2');
select is(pg_temp.adj('a2', -3), 'L-D2 -2, L-D5 -1', 'd -3 empties the earliest lot and takes 1 from the next');
select is(pg_temp.sum_last(), -3::numeric, '... rows sum to d');
select is(pg_temp.neg_lots('a2'), 0::bigint, '... no lot below zero');

select pg_temp.std('a3');
select is(pg_temp.adj('a3', 1), 'null 1', 'd +1 is one unlotted row');
select is(pg_temp.adj('a3', 0.25), 'null 0.25', 'a second surplus is another unlotted row');

-- After a waste of 5 kg: L-D2 -2, L-D5 -2, unlotted -1 (total -1). Counted 0 means d +1.
select pg_temp.std('a4');
select pg_temp.waste('a4', 5);
select is(pg_temp.unlotted('a4'), -1::numeric, 'fixture: the shortfall left unlotted -1');
select is(pg_temp.adj('a4', 1), 'null 1', 'counted 0 after a shortfall: one unlotted row +1, no lot row');
select is(pg_temp.unlotted('a4'), 0::numeric, '... the unlotted bucket is 0 again');

-- A lot of 2 kg with the unlotted bucket at -1 (total 1), d -0,5: T 0,5 < P 2.
select pg_temp.mk_ing('a5');
select pg_temp.mk_lot('a5_old', 'L-OLD', 'a5', '2026-10-24', 2);
select pg_temp.waste('a5', 3);
select pg_temp.mk_lot('a5_d5', 'L-D5', 'a5', '2026-10-28', 2);
select is(pg_temp.unlotted('a5'), -1::numeric, 'fixture: unlotted -1 beside a lot of 2 kg');
select is(pg_temp.adj('a5', -0.5), 'L-D5 -1.5, null 1', 'T below the lots: take from the lot and clear the unlotted bucket');
select is(pg_temp.sum_last(), -0.5::numeric, '... rows sum to d');
select is(pg_temp.unlotted('a5'), 0::numeric, '... the unlotted bucket is 0');

select pg_temp.std('a6');
select is(pg_temp.adj('a6', -5), 'L-D2 -2, L-D5 -2, null -1', 'T < 0: every lot to zero and the rest unlotted');
select is(pg_temp.sum_last(), -5::numeric, '... rows sum to d');
select is(pg_temp.neg_lots('a6'), 0::bigint, '... no lot below zero');

select pg_temp.std('a7');
select is(pg_temp.adj('a7', 3), 'null 3', 'a surplus on full lots is unlotted');
select is(pg_temp.adj('a7', -0.5), 'null -0.5', 'T above the lots: only the unlotted bucket moves');

select pg_temp.std('a8');
select is(pg_temp.adj('a8', 0), '', 'd 0 writes no row');
select is((select count(*)::int from public.stock_movement where ingredient_id = pg_temp.id('a8') and type = 'count'), 0,
  '... none in the ledger');

-- Row shape ---------------------------------------------------------------------------------------------
select pg_temp.std('a9');
select is(pg_temp.adj('a9', -3, 10, '2026-10-23T10:00Z', 'cost'), '10.0000, 10.0000', 'the unit cost is the one passed');
select is((select count(*)::int from public.stock_movement m
            where m.ingredient_id = pg_temp.id('a9') and m.type = 'count'
              and m.ref_type = 'count_session' and m.ref_id = '51000000-0000-4000-8000-000000000001'
              and m.reason_code is null and m.created_by = 'c1000000-0000-4000-8000-00000000000c'), 2,
  'rows are type count, ref_type count_session, ref_id the session, no reason, created_by the closer');
select pg_temp.std('b1');
select is(pg_temp.adj('b1', -1, null, '2026-10-23T10:00Z', 'cost'), 'null', 'no cost known: unit_cost is null');
select is((select count(*)::int from public.stock_movement m where m.ingredient_id = pg_temp.id('b1') and m.unit_cost = 0), 0,
  '... never 0');

-- Effective date (Europe/Rome, DST change 2026-10-25 and 2027-03-28) --------------------------------------
select pg_temp.std('d1');
select is(pg_temp.adj('d1', 1, 10, '2026-10-25T22:30Z', 'date'), '2026-10-25', '2026-10-25T22:30Z is still 25 October in Rome');
select is(pg_temp.adj('d1', 1, 10, '2026-10-25T23:30Z', 'date'), '2026-10-26', '2026-10-25T23:30Z is 26 October in Rome');
select is(pg_temp.adj('d1', 1, 10, '2027-03-27T22:59Z', 'date'), '2027-03-27', '2027-03-27T22:59Z is still 27 March');
select is(pg_temp.adj('d1', 1, 10, '2027-03-27T23:00Z', 'date'), '2027-03-28', '2027-03-27T23:00Z is 28 March');

-- Errors ------------------------------------------------------------------------------------------------
select is(pg_temp.err(format($f$ select count(*) from app.post_count_adjustment('11111111-1111-4111-8111-111111111111',
    'c1000000-0000-4000-8000-00000000000c', %L, '10000000-0000-4000-8000-0000000000a1', 1, gen_random_uuid(), now(), 10) $f$,
    gen_random_uuid())), 'P0002 ingredient_not_found', 'an unknown ingredient is P0002');
select is(pg_temp.err($$ select count(*) from app.post_count_adjustment('11111111-1111-4111-8111-111111111111',
    'c1000000-0000-4000-8000-00000000000c', null, '10000000-0000-4000-8000-0000000000a1', null, gen_random_uuid(), now(), 10) $$),
  'P0001 qty_invalid', 'a null difference is refused');

-- Quantity conversion -----------------------------------------------------------------------------------
select pg_temp.mk_ing('q1');
select is(app.count_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('q1'), 0, 'kg'), 0::numeric, '0 kg counts as 0');
select is(app.count_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('q1'), 500, 'g'), 0.5::numeric, '500 g on a kg ingredient is 0,5');
select is(app.count_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('q1'), 100000, 'kg'), 100000::numeric, 'COUNT_QTY_MAX itself is accepted');
select is(pg_temp.err(format($f$ select app.count_qty_base('11111111-1111-4111-8111-111111111111', %L, -1, 'kg') $f$, pg_temp.id('q1'))),
  'P0001 qty_invalid', 'a negative quantity is refused');
select is(pg_temp.err(format($f$ select app.count_qty_base('11111111-1111-4111-8111-111111111111', %L, 100001, 'kg') $f$, pg_temp.id('q1'))),
  'P0001 qty_invalid', 'a quantity over COUNT_QTY_MAX is refused');
select is(pg_temp.err(format($f$ select app.count_qty_base('11111111-1111-4111-8111-111111111111', %L, 1.00001, 'kg') $f$, pg_temp.id('q1'))),
  'P0001 qty_invalid', 'more than 4 decimals after conversion is refused');
select is(pg_temp.err(format($f$ select app.count_qty_base('11111111-1111-4111-8111-111111111111', %L, 1, 'ml') $f$, pg_temp.id('q1'))),
  'P0001 unit_mismatch', 'ml on a kg ingredient is a unit mismatch');
select pg_temp.mk_ing('q2', 'kg', false);
select is(pg_temp.err(format($f$ select app.count_qty_base('11111111-1111-4111-8111-111111111111', %L, 1, 'kg') $f$, pg_temp.id('q2'))),
  'P0001 ingredient_not_stock', 'a non-stock ingredient is refused');
select is(pg_temp.err(format($f$ select app.count_qty_base('11111111-1111-4111-8111-111111111111', %L, 1, 'kg') $f$, gen_random_uuid())),
  'P0002 ingredient_not_found', 'an unknown ingredient is P0002');

-- Lock order and grants ---------------------------------------------------------------------------------
select cmp_ok(position('app.lock_ingredient_stock(' in pg_get_functiondef('app.post_count_adjustment(uuid, uuid, uuid, uuid, numeric, uuid, timestamptz, numeric)'::regprocedure)), '>', 0,
  'post_count_adjustment takes the stock lock');
select cmp_ok(position('app.lock_ingredient_stock(' in pg_get_functiondef('app.post_count_adjustment(uuid, uuid, uuid, uuid, numeric, uuid, timestamptz, numeric)'::regprocedure)), '<',
  position('app.fefo_buckets(' in pg_get_functiondef('app.post_count_adjustment(uuid, uuid, uuid, uuid, numeric, uuid, timestamptz, numeric)'::regprocedure)),
  '... before it reads the buckets');
select is((select count(*)::int
             from (values ('app.post_count_adjustment(uuid, uuid, uuid, uuid, numeric, uuid, timestamptz, numeric)'),
                          ('app.count_qty_base(uuid, uuid, numeric, text)'), ('app.require_audit_reader()')) f (sig)
             cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
            where has_function_privilege(r.rolname, f.sig, 'execute')), 0,
  'no API role can execute the three core functions');

-- require_audit_reader -----------------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err($$ select app.require_audit_reader() $$), 'ok', 'owner passes require_audit_reader');
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err($$ select app.require_audit_reader() $$), 'ok', 'admin passes require_audit_reader');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err($$ select app.require_audit_reader() $$), 5), '42501', 'chef is refused');
select pg_temp.act_as('e0000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$ select app.require_audit_reader() $$), 5), '42501', 'waiter is refused');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err($$ select app.require_audit_reader() $$), 5), '42501', 'no claims is refused');

select * from finish();
rollback;
