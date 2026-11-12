-- P2-0b A4 (sell by weight, plan §3.1 D-7, §3.3, §5 A4): firing a weighted line depletes weight / reference portion weight portions, FEFO, and freezes the
-- cost as the same fraction; void_line (unchanged) mirrors those fractional rows; the nightly fire_depletion check and the forecast count the fraction.
-- Each scenario has its own stew key, beef (raw stock, 0,4 kg a plate), salt (non-stock) and plate. Lines are inserted directly (A3 proves the entry).
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4,
   'a1000000-0000-4000-8000-00000000000a', '1998-10-24', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1'), ('s1', '14000000-0000-4000-8000-000000000001');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create function pg_temp.name_of(p_id uuid) returns text language sql as $$ select k from reg where id = p_id $$;
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
create function pg_temp.as_waiter() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-4000-8000-00000000000d', 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter')::text, true) $$;
create sequence pg_temp.batch_seq;
create sequence pg_temp.line_seq;
create function pg_temp.new_inv_line() returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  return v_line;
end
$$;
create function pg_temp.mk_ing(p_k text, p_stock boolean) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', p_k || ' (demo)', 'kg', p_stock);
end
$$;
create function pg_temp.mk_lot(p_key text, p_ing text, p_qty numeric) returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_inv_line();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on,
      qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, '11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), pg_temp.id('cella'), '5a000000-0000-4000-8000-00000000005a', v_line,
      upper(p_key), current_date + 9, current_date - 5, p_qty, 'kg', p_qty, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, pg_temp.id('cella'), 'receipt', p_qty, 10, 'invoice_line', v_line, current_date - 5,
      'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.buy(p_ing text, p_price numeric) returns void language sql as $$
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), '5a000000-0000-4000-8000-00000000005a', pg_temp.new_inv_line(), p_price, 'kg', current_date - 10,
            'a1000000-0000-4000-8000-00000000000a') $$;
create function pg_temp.mkb(p_set int, p_letter text, p_prod_h int, p_left numeric) returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_seq int := nextval('pg_temp.batch_seq');
  v_prod timestamptz := date_trunc('hour', now()) + make_interval(hours => p_prod_h);
begin
  insert into reg values ('s' || p_set || p_letter, v_id);
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
      output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', pg_temp.id('s' || p_set || 'key'), pg_temp.id('s' || p_set || 'rec'), 1, '981023-LOT-' || v_seq,
      '1998-10-23', 'LOT', v_seq, v_prod, 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 10, 10, 72, v_prod + interval '72 hours', 'fresh', pg_temp.id('cella'),
      'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', 10, 'batch', v_id, '1998-10-23', 'a1000000-0000-4000-8000-00000000000a');
  if p_left < 10 then
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
      values ('11111111-1111-4111-8111-111111111111', v_id, 'count', p_left - 10, 'batch_adjust', gen_random_uuid(), '1998-10-23', 'a1000000-0000-4000-8000-00000000000a');
  end if;
  insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, cost_at, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', 25, 2.5, false, now(), 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- Scenario n: stew key with A (a_left, expires first) and B (b_left); beef (stock, 10 kg at 10,00), salt (non-stock, 2,00 a kg); the plate = 1 porz of the stew + 400 g
-- beef + 20 g salt (6,54 a portion: 2,50 + 4,00 + 0,04); a weighted item mapped to it.
create function pg_temp.mkscn(p_n int, p_a numeric, p_b numeric) returns void language plpgsql as $$
begin
  insert into reg values ('s' || p_n || 'key', gen_random_uuid()), ('s' || p_n || 'rec', gen_random_uuid()), ('pl' || p_n, gen_random_uuid()),
    ('r' || p_n, gen_random_uuid()), ('w' || p_n, gen_random_uuid());
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
    (pg_temp.id('s' || p_n || 'key'), '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brasato ' || p_n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'),
    (pg_temp.id('pl' || p_n), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto ' || p_n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by)
    values (pg_temp.id('s' || p_n || 'rec'), '11111111-1111-4111-8111-111111111111', pg_temp.id('s' || p_n || 'key'), 1, now() - interval '9 days', 'Brasato ' || p_n, 6, 'kg', 30, 72,
            'a1000000-0000-4000-8000-00000000000a');
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
    values (pg_temp.id('r' || p_n), '11111111-1111-4111-8111-111111111111', pg_temp.id('pl' || p_n), 1, now() - interval '9 days', 'Piatto ' || p_n, 'a1000000-0000-4000-8000-00000000000a');
  perform pg_temp.mk_ing('beef' || p_n, true); perform pg_temp.mk_ing('salt' || p_n, false);
  perform pg_temp.mk_lot('lot' || p_n, 'beef' || p_n, 10);
  perform pg_temp.buy('beef' || p_n, 10); perform pg_temp.buy('salt' || p_n, 2);
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by) values
    ('11111111-1111-4111-8111-111111111111', pg_temp.id('r' || p_n), 1, null, pg_temp.id('s' || p_n || 'key'), 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
    ('11111111-1111-4111-8111-111111111111', pg_temp.id('r' || p_n), 2, pg_temp.id('beef' || p_n), null, 400, 'g', 1, 'a1000000-0000-4000-8000-00000000000a'),
    ('11111111-1111-4111-8111-111111111111', pg_temp.id('r' || p_n), 3, pg_temp.id('salt' || p_n), null, 20, 'g', 1, 'a1000000-0000-4000-8000-00000000000a');
  perform pg_temp.mkb(p_n, 'A', -48, p_a);
  perform pg_temp.mkb(p_n, 'B', -24, p_b);
  insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by)
    values (pg_temp.id('w' || p_n), '11111111-1111-4111-8111-111111111111', 'Brasato ' || p_n || ' a peso (demo)', 'Secondi', 'secondi', pg_temp.id('pl' || p_n),
            'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.menu_item_price (tenant_id, menu_item_id, price, price_unit, portion_weight_g, vat_rate, valid_from, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id('w' || p_n), 5.5, 'etto', 400, 10, now() - interval '9 days', 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- A draft line of scenario n: weighted (weight in g on a reference portion in g) or, with a null weight, a portion line of qty 1.
create function pg_temp.mkline(p_k text, p_n int, p_weight int, p_portion int default 400) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  if p_weight is null then
    insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
      values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', pg_temp.id('s1'), pg_temp.id('w' || p_n), 'secondi', 1, 14, 10, 'menu', '1998-10-24 12:00+00',
              'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
  else
    insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, weight_g, price_per_100g,
        portion_weight_g, created_by, updated_by)
      values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', pg_temp.id('s1'), pg_temp.id('w' || p_n), 'secondi', 1, app.weight_line_price(5.5, p_weight), 10, 'menu',
              '1998-10-24 12:00+00', p_weight, 5.5, p_portion, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
  end if;
end
$$;
create function pg_temp.fire(p_line text) returns jsonb language sql as $$
  select public.fire_course(pg_temp.id('s1'), jsonb_build_object('lineIds', jsonb_build_array(pg_temp.id(p_line)))) $$;
create function pg_temp.void(p_line text, p_reason text) returns jsonb language sql as $$
  select public.void_line(pg_temp.id(p_line), jsonb_build_object('reason', p_reason, 'clientUpdatedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) $$;
-- Net batch consumption of a scenario, 'A=-2 B=-1' (originals only); the beef rows 'lot -1.2'.
create function pg_temp.cons(p_n int) returns text language sql as $$
  select coalesce(string_agg(substr(pg_temp.name_of(m.batch_id), length('s' || p_n) + 1) || '=' || trim_scale(m.s)::text, ' ' order by pg_temp.name_of(m.batch_id) collate "C"), '-')
    from (select batch_id, sum(portions) s from public.batch_movement where type = 'consume' and reverses_id is null
           and batch_id in (select id from reg where k ~ ('^s' || p_n || '[AB]$')) group by batch_id) m $$;
create function pg_temp.beef(p_n int) returns text language sql as $$
  select coalesce(string_agg(trim_scale(m.qty)::text, ' ' order by m.qty), '-') from public.stock_movement m where m.ingredient_id = pg_temp.id('beef' || p_n) and m.type = 'consumption' $$;
create function pg_temp.cost_of(p_line text) returns text language sql as $$
  select coalesce(trim_scale(total_cost)::text, 'null') || ' ' || coalesce(trim_scale(unit_cost_at_sale)::text, 'null') || ' ' || incomplete::text
    from public.order_line_cost where order_line_id = pg_temp.id(p_line) $$;
create function pg_temp.checks(p_key text) returns int language sql as $$
  select coalesce((select c.rows_count from app.ledger_checks_body('11111111-1111-4111-8111-111111111111', now()) c where c.check_key = p_key), 0) $$;

select pg_temp.mkscn(1, 2, 10);   -- the main case: A has 2 left, B 10
select pg_temp.mkscn(2, 10, 10);  -- 1000 g on a 300 g reference
select pg_temp.mkscn(3, 2, 1);    -- shortage: 3 portions left
select pg_temp.mkscn(4, 10, 10);  -- a portion line, as before
select pg_temp.mkscn(5, 10, 10);  -- void after fire
select pg_temp.as_waiter();

-- Fire: 1200 g on a 400 g reference is 3 portions --------------------------------------------------------------------------------------
select pg_temp.mkline('l1', 1, 1200);
select is(pg_temp.err($$ select pg_temp.fire('l1') $$), 'ok', 'the waiter fires a 1200 g line on a 400 g reference');
select is(pg_temp.cons(1), 'A=-2 B=-1', 'FEFO: 2 portions from A (the earlier expiry, 2 left) and 1 from B');
select is(pg_temp.beef(1), '-1.2', 'the raw beef takes 3 x 0,4 kg = 1,2 kg');
select is(pg_temp.cost_of('l1'), '19.62 19.62 false', 'the cost is 3 x 6,54 = 19,62, and unit_cost_at_sale is that total (qty 1)');
select is((select qty from public.order_line where id = pg_temp.id('l1')) || '/' || (select state from public.order_line where id = pg_temp.id('l1')), '1.0/fired', 'the line is fired, still qty 1');
select is(pg_temp.checks('fire_depletion'), 0, 'fire_depletion stays clean');

-- 1000 g on a 300 g reference: 3,3333... portions, rounded once per row ----------------------------------------------------------------
select pg_temp.mkline('l2', 2, 1000, 300);
select is(pg_temp.err($$ select pg_temp.fire('l2') $$), 'ok', 'a 1000 g line on a 300 g reference fires');
select is(pg_temp.cons(2), 'A=-3.3333', 'the batch takes round(3.3333... x 1, 4) = 3.3333 (FEFO: A holds 10)');
select is(pg_temp.beef(2), '-1.3333', 'the beef takes round(3.3333... x 0,4, 4) = 1.3333 kg');
select is(pg_temp.checks('fire_depletion'), 0, 'fire_depletion stays clean with the unrounded fraction');
select is((select incomplete from public.order_line_cost where order_line_id = pg_temp.id('l2')), false, 'and the cost is complete');

-- Shortage: 5 portions needed, 3 left ------------------------------------------------------------------------------------------------
select pg_temp.mkline('l3', 3, 2000);
select is(pg_temp.err($$ select pg_temp.fire('l3') $$), 'ok', 'a 2000 g line fires with 3 portions left');
select is(pg_temp.cons(3), 'A=-2 B=-3', 'A gives 2, B gives its 1 and goes below zero: 3 (booked, never refused)');
select is((select (payload ->> 'short_portions_qty') from public.alert where kind = 'negative_stock' and entity_id = pg_temp.id('s3key')), '2', 'negative_stock is raised with short_portions_qty 2');
select is(pg_temp.checks('fire_depletion'), 0, 'the shortage still balances for the nightly check');

-- A portion line fires exactly as before -----------------------------------------------------------------------------------------------
select pg_temp.mkline('l4', 4, null);
select is(pg_temp.err($$ select pg_temp.fire('l4') $$), 'ok', 'a portion line fires');
select is(pg_temp.cons(4), 'A=-1', 'one portion from A');
select is(pg_temp.beef(4), '-0.4', 'and 0,4 kg of beef');
select is(pg_temp.cost_of('l4'), '6.54 6.54 false', 'cost 6,54 a plate: unit_cost_at_sale = total / qty as before');

-- Void after fire (void_line is unchanged): the same fractional rows are mirrored ----------------------------------------------------------
select pg_temp.mkline('l5', 5, 1200);
select pg_temp.fire('l5');
select is(pg_temp.err($$ select pg_temp.void('l5', 'kitchen_error') $$), 'ok', 'the weighted fired line is voided');
select is((select count(*)::int from public.batch_movement m where m.type = 'consume' and m.ref_id = pg_temp.id('l5') and m.reverses_id is not null), 1,
  'one reversal per consume row (A holds the 3 portions: FEFO takes all from the earlier batch)');
select is((select sum(m.portions) from public.batch_movement m where m.type = 'consume' and m.ref_id = pg_temp.id('l5') and m.reverses_id is not null), 3.0000, 'of the same 3 portions');
select is((select count(*)::int || ':' || sum(m.portions) from public.batch_movement m where m.type = 'waste' and m.ref_type = 'order_void' and m.ref_id = pg_temp.id('l5')), '1:-3.0000', 'and one waste row of -3');
select is((select count(*)::int from public.order_line_cost where order_line_id = pg_temp.id('l5')), 1, 'the cost row stays');
select is(pg_temp.checks('fire_depletion'), 0, 'fire_depletion is empty after the void');

-- app.ledger_checks_body reports a tampered consume row of a weighted line -------------------------------------------------------------------
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('s1B'), 'consume', -0.5, 'order_line', pg_temp.id('l1'), '1998-10-24', 'a1000000-0000-4000-8000-00000000000a');
select is(pg_temp.checks('fire_depletion'), 1, 'an extra consume row on a fired weighted line is reported by fire_depletion');
select is((select count(*)::int from (select * from app.ledger_checks_body('11111111-1111-4111-8111-111111111111', now())) c), 1, 'and it is the only finding');
select is((select length(p.prosrc) - length(replace(p.prosrc, ';', '')) from pg_proc p where p.oid = 'app.ledger_checks_body(uuid, timestamptz)'::regprocedure), 1,
  'ledger_checks_body is still one statement (pgTAP 117 counts its semicolons)');

-- forecast_portion_lines -----------------------------------------------------------------------------------------------------------
-- A closed weighted line of 1200 g / 400 g contributes 3 portions to its batch key.
update public.table_session set closed_at = now(), closed_by = 'a1000000-0000-4000-8000-00000000000a', closed_business_date = date '1998-10-24',
       receipt_type = 'scontrino', payment_type = 'card', total = 100.00
 where id = pg_temp.id('s1');
select is((select f.portions from app.forecast_portion_lines('11111111-1111-4111-8111-111111111111', array[date '1998-10-24']) f where f.batch_key = pg_temp.id('s1key')), 3.0000,
  'forecast_portion_lines: the closed weighted line counts 3 portions for its batch key');
select is((select f.portions from app.forecast_portion_lines('11111111-1111-4111-8111-111111111111', array[date '1998-10-24']) f where f.batch_key = pg_temp.id('s4key')), 1.0000,
  'and a closed portion line counts its qty');
select is((select round(f.portions, 4) from app.forecast_portion_lines('11111111-1111-4111-8111-111111111111', array[date '1998-10-24']) f where f.batch_key = pg_temp.id('s2key')), 3.3333,
  'a 1000 g line on 300 g counts 3.3333 portions');

select * from finish();
rollback;
