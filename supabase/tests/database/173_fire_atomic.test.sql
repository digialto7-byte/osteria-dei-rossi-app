-- M19 step 5: fire_course and void_line are atomic (M19 plan §3.2, §5 step 5; AT5). A test-only trigger raises on demand
-- (set_config('test.fail', ..., true) names the fault, 'test.fail_line' the line it applies to): a fault in the cost row of
-- the second line, in the raw outflow of the second line, in the waste row of a void, leaves nothing behind - not even the
-- first line's movements, the shortage alert or the settled batch states. Without the flag the same calls succeed.
-- Every scenario has its own stew batch key, ingredients, lots, plate and menu item. Dates are relative to now(). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review',
   '5a000000-0000-4000-8000-00000000005a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Tavolo 3 (demo)', 3, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
-- S1 and S2 open, S3 closed (owner fixture), B1 of tenant B.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, closed_at, closed_by, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24', null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24', null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24', now(), 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '13000000-0000-4000-8000-0000000000b1', 'Tavolo B (demo)', 2, 'b1000000-0000-4000-8000-00000000000b', '2026-10-24', null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

-- Registry and helpers ------------------------------------------------------------------------------------------------------
create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1'), ('disp', '10000000-0000-4000-8000-0000000000a2'),
  ('s1', '14000000-0000-4000-8000-000000000001'), ('s2', '14000000-0000-4000-8000-000000000002'),
  ('s3', '14000000-0000-4000-8000-000000000003'), ('sb', '14000000-0000-4000-8000-0000000000b1');
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
create function pg_temp.claims(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',
    case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f'
               when 'chef' then 'c0000000-0000-4000-8000-00000000000c' when 'ownerb' then 'b0000000-0000-4000-8000-00000000000b'
               when 'waiter2' then 'e0000000-0000-4000-8000-00000000000e'
               else 'd0000000-0000-4000-8000-00000000000d' end,
    'role', 'authenticated',
    'tenant_id', case when p_who = 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end,
    'app_role', case when p_who = 'ownerb' then 'owner' when p_who = 'waiter2' then 'waiter' else p_who end)::text, true)
$$;
create temporary table res (nm text primary key, j jsonb);
-- fire_course as a role; 'ok' (the reply stored under nm) or "SQLSTATE message". A failed call rolls back all of its writes.
create function pg_temp.fire(p_nm text, p_who text, p_session uuid, p_body jsonb) returns text language plpgsql as $$
declare
  v_j jsonb;
  state text;
  msg text;
begin
  perform pg_temp.claims(p_who);
  begin
    set local role authenticated;
    v_j := public.fire_course(p_session, p_body);
    reset role;
    insert into res values (p_nm, v_j);
    return 'ok';
  exception when others then
    reset role;
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    return state || ' ' || msg;
  end;
end
$$;
create function pg_temp.upd(p_who text, p_line uuid, p_patch jsonb) returns jsonb language plpgsql as $$
declare
  v_j jsonb;
begin
  perform pg_temp.claims(p_who);
  set local role authenticated;
  v_j := public.update_order_line(p_line, p_patch);
  reset role;
  return v_j;
end
$$;
create function pg_temp.body(variadic p_keys text[]) returns jsonb language sql as $$
  select jsonb_build_object('lineIds', coalesce(jsonb_agg(pg_temp.id(k) order by k collate "C"), '[]'::jsonb)) from unnest(p_keys) k
$$;
create function pg_temp.j(p_nm text) returns jsonb language sql as $$ select j from res where nm = p_nm $$;

create sequence pg_temp.batch_seq;
create sequence pg_temp.price_seq;
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
create function pg_temp.mk_ing(p_k text, p_stock boolean default true) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', p_k || ' (demo)', 'kg', p_stock);
end
$$;
create function pg_temp.mk_lot(p_key text, p_ing text, p_loc text, p_expiry_days int, p_qty numeric) returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_inv_line();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on,
      qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, '11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), pg_temp.id(p_loc),
      '5a000000-0000-4000-8000-00000000005a', v_line, upper(p_key), current_date + p_expiry_days, current_date - 5, p_qty, 'kg', p_qty,
      'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, pg_temp.id(p_loc), 'receipt', p_qty, 10, 'invoice_line',
      v_line, current_date - 5, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.buy(p_ing text, p_price numeric, p_days_ago int default 10) returns void language sql as $$
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), '5a000000-0000-4000-8000-00000000005a', pg_temp.new_inv_line(),
            p_price, 'kg', current_date - p_days_ago, 'a1000000-0000-4000-8000-00000000000a')
$$;
create function pg_temp.mkb(p_set int, p_letter text, p_state text, p_prod_h int, p_shelf int, p_left numeric, p_initial int default 10) returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_seq int := nextval('pg_temp.batch_seq');
  v_prod timestamptz := date_trunc('hour', now()) + make_interval(hours => p_prod_h);
begin
  insert into reg values ('s' || p_set || p_letter, v_id);
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at,
      produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', pg_temp.id('s' || p_set || 'key'), pg_temp.id('s' || p_set || 'rec'), 1,
      '261023-LOT-' || v_seq, '2026-10-23', 'LOT', v_seq, v_prod, 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', p_initial, p_initial,
      p_shelf, v_prod + make_interval(hours => p_shelf), p_state::public.batch_state,
      case when p_letter in ('B', 'E') then pg_temp.id('disp') else pg_temp.id('cella') end, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', p_initial, 'batch', v_id, '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
  if p_left < p_initial then
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
      values ('11111111-1111-4111-8111-111111111111', v_id, 'count', p_left - p_initial, 'batch_adjust', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
  end if;
  insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, cost_at, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', 25, 2.5, false, now(), 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- A scenario n: stew key with A (a_left), B (b_left), C expired, D finished, E discarded; polenta (P2 Cella 0,1 kg expiring first,
-- P1 Dispensa 1 kg), pane (Dispensa 5 kg), prices 1,20 and 3,00; the plate = 1 porz stew + 150 g polenta + 50 g pane (yield 0,5)
-- and a menu item mapped to it. Keys: sNkey, sNA.., polN, paneN, plN (plate key), rN (plate version 1), iN (menu item).
create function pg_temp.mkscn(p_n int, p_a numeric default 2, p_b numeric default 5, p_live_state text default 'fresh') returns void language plpgsql as $$
begin
  insert into reg values ('s' || p_n || 'key', gen_random_uuid()), ('s' || p_n || 'rec', gen_random_uuid()), ('pl' || p_n, gen_random_uuid()),
    ('r' || p_n, gen_random_uuid()), ('i' || p_n, gen_random_uuid());
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
    (pg_temp.id('s' || p_n || 'key'), '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino ' || p_n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'),
    (pg_temp.id('pl' || p_n), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto ' || p_n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by)
    values (pg_temp.id('s' || p_n || 'rec'), '11111111-1111-4111-8111-111111111111', pg_temp.id('s' || p_n || 'key'), 1, now() - interval '9 days',
            'Spezzatino ' || p_n, 6, 'kg', 30, 72, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
    values (pg_temp.id('r' || p_n), '11111111-1111-4111-8111-111111111111', pg_temp.id('pl' || p_n), 1, now() - interval '9 days',
            'Piatto ' || p_n, 'a1000000-0000-4000-8000-00000000000a');
  perform pg_temp.mk_ing('pol' || p_n); perform pg_temp.mk_ing('pane' || p_n);
  perform pg_temp.mk_lot('p' || p_n || '2', 'pol' || p_n, 'cella', 8, 0.1);
  perform pg_temp.mk_lot('p' || p_n || '1', 'pol' || p_n, 'disp', 10, 1);
  perform pg_temp.mk_lot('n' || p_n, 'pane' || p_n, 'disp', 9, 5);
  perform pg_temp.buy('pol' || p_n, 1.2); perform pg_temp.buy('pane' || p_n, 3);
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by) values
    ('11111111-1111-4111-8111-111111111111', pg_temp.id('r' || p_n), 1, null, pg_temp.id('s' || p_n || 'key'), 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
    ('11111111-1111-4111-8111-111111111111', pg_temp.id('r' || p_n), 2, pg_temp.id('pol' || p_n), null, 150, 'g', 1, 'a1000000-0000-4000-8000-00000000000a'),
    ('11111111-1111-4111-8111-111111111111', pg_temp.id('r' || p_n), 3, pg_temp.id('pane' || p_n), null, 50, 'g', 0.5, 'a1000000-0000-4000-8000-00000000000a');
  perform pg_temp.mkb(p_n, 'C', 'fresh', -120, 100, 5);
  perform pg_temp.mkb(p_n, 'A', p_live_state, -48, 72, p_a);
  perform pg_temp.mkb(p_n, 'B', p_live_state, -24, 72, p_b);
  perform pg_temp.mkb(p_n, 'D', 'finished', -12, 96, 0, 2);
  perform pg_temp.mkb(p_n, 'E', 'discarded', -6, 96, 4, 4);
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id('s' || p_n || 'E'), 'waste', -4, 'spoilage', 'batch_discard', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by)
    values (pg_temp.id('i' || p_n), '11111111-1111-4111-8111-111111111111', 'Piatto ' || p_n || ' (demo)', 'Secondi', 'secondi',
            pg_temp.id('pl' || p_n), 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- An order line (draft) by key on a session.
create function pg_temp.mkline(p_k text, p_item text, p_qty numeric default 1, p_course text default 'secondi',
    p_session text default 's1', p_shared boolean default false, p_segue boolean default false) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, segue, is_shared, unit_price, vat_rate,
      price_source, client_updated_at, created_by, updated_by)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', pg_temp.id(p_session), pg_temp.id(p_item), p_course::public.course,
            p_qty, p_segue, p_shared, 14, 10, 'menu', '2026-10-24 12:00+00', 'd1000000-0000-4000-8000-00000000000d',
            'd1000000-0000-4000-8000-00000000000d');
end
$$;
-- Net consumption per batch of a scenario, 'A=-2 B=-8'; stock rows per lot of an ingredient, 'P2@cella -0.1,...'.
create function pg_temp.cons(p_n int) returns text language sql as $$
  select coalesce(string_agg(substr(pg_temp.name_of(m.batch_id), length('s' || p_n) + 1) || '=' || trim_scale(m.s)::text, ' '
           order by pg_temp.name_of(m.batch_id) collate "C"), '-')
    from (select batch_id, sum(portions) s from public.batch_movement
           where type = 'consume' and batch_id in (select id from reg where k ~ ('^s' || p_n || '[A-E]$')) group by batch_id) m
$$;
create function pg_temp.stock(p_ing text) returns text language sql as $$
  select coalesce(string_agg(coalesce(pg_temp.name_of(m.raw_lot_id), 'unlotted') || '@' || pg_temp.name_of(m.location_id) || ' ' || trim_scale(m.qty)::text,
           ', ' order by coalesce(pg_temp.name_of(m.raw_lot_id), 'zz') collate "C", m.qty), '-')
    from public.stock_movement m where m.ingredient_id = pg_temp.id(p_ing) and m.type = 'consumption'
$$;
create function pg_temp.bal(p_k text) returns numeric language sql as $$
  select trim_scale(app.batch_remaining('11111111-1111-4111-8111-111111111111', pg_temp.id(p_k))) $$;
create function pg_temp.cost_of(p_line text) returns text language sql as $$
  select coalesce(trim_scale(total_cost)::text, 'null') || ' ' || coalesce(trim_scale(unit_cost_at_sale)::text, 'null') || ' ' || incomplete::text
    from public.order_line_cost where order_line_id = pg_temp.id(p_line) $$;
create function pg_temp.all_keys(j jsonb) returns setof text language plpgsql as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next k;
      return query select * from pg_temp.all_keys(v);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for v in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.all_keys(v);
    end loop;
  end if;
end
$$;
create function pg_temp.counts() returns text language sql as $$
  select (select count(*) from public.batch_movement where type = 'consume')::text || '/'
      || (select count(*) from public.stock_movement where type = 'consumption')::text || '/'
      || (select count(*) from public.order_line_cost)::text || '/'
      || (select count(*) from public.alert where kind = 'negative_stock')::text $$;
grant execute on function pg_temp.claims(text), pg_temp.id(text) to authenticated;
grant select on reg to authenticated;

create function pg_temp.void(p_nm text, p_who text, p_line uuid, p_body jsonb) returns text language plpgsql as $$
declare
  v_j jsonb;
  state text;
  msg text;
begin
  perform pg_temp.claims(p_who);
  begin
    set local role authenticated;
    v_j := public.void_line(p_line, p_body);
    reset role;
    insert into res values (p_nm, v_j);
    return 'ok';
  exception when others then
    reset role;
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    return state || ' ' || msg;
  end;
end
$$;
-- The detail of the error of a void (null when none): conflicts must not raise, so there is none.
create function pg_temp.void_detail(p_who text, p_line uuid, p_body jsonb) returns text language plpgsql as $$
declare
  d text;
begin
  perform pg_temp.claims(p_who);
  begin
    set local role authenticated;
    perform public.void_line(p_line, p_body);
    reset role;
    return 'no error';
  exception when others then
    reset role;
    get stacked diagnostics d = pg_exception_detail;
    return coalesce(d, 'error without detail');
  end;
end
$$;
create function pg_temp.vb(p_reason text, p_stamp text default null, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('reason', p_reason,
           'clientUpdatedAt', coalesce(p_stamp, to_char((clock_timestamp() - interval '1 minute') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) || p_extra
$$;
-- All the rows of one line in both ledgers, as comparable text.
create function pg_temp.brows(p_line text) returns text language sql as $$
  select coalesce(string_agg(m.type::text || ' ' || trim_scale(m.portions)::text || ' ' || m.ref_type || ' ' || coalesce(m.reason_code, '-') || ' '
           || (m.reverses_id is not null)::text, ', ' order by m.ref_type collate "C", m.type::text collate "C", m.portions), 'none')
    from public.batch_movement m where m.ref_id = pg_temp.id(p_line) $$;
create function pg_temp.srows(p_line text) returns text language sql as $$
  select coalesce(string_agg(s.type::text || ' ' || trim_scale(s.qty)::text || ' ' || coalesce(pg_temp.name_of(s.raw_lot_id), 'unlotted') || '@'
           || pg_temp.name_of(s.location_id) || ' ' || coalesce(s.reason_code, '-') || ' ' || s.ref_type || ' ' || coalesce(trim_scale(s.unit_cost)::text, 'null') || ' '
           || (s.reverses_id is not null)::text, ', ' order by s.ref_type collate "C", s.type::text collate "C", pg_temp.name_of(s.raw_lot_id) collate "C", s.qty), 'none')
    from public.stock_movement s where s.ref_id = pg_temp.id(p_line) $$;
-- Net quantity per lot bucket of an ingredient: 'lot qty, lot qty' (all rows, receipts included).
create function pg_temp.buckets(p_ing text) returns text language sql as $$
  select string_agg(coalesce(pg_temp.name_of(s.raw_lot_id), 'unlotted') || ' ' || trim_scale(s.q)::text, ', ' order by coalesce(pg_temp.name_of(s.raw_lot_id), 'unlotted') collate "C")
    from (select raw_lot_id, sum(qty) q from public.stock_movement where ingredient_id = pg_temp.id(p_ing) group by raw_lot_id) s $$;
create function pg_temp.counts2() returns text language sql as $$
  select (select count(*) from public.batch_movement)::text || '/' || (select count(*) from public.stock_movement)::text $$;


create function public.test_fault_cost() returns trigger language plpgsql as $$
begin
  if current_setting('test.fail', true) = 'cost' and new.order_line_id::text = current_setting('test.fail_line', true) then
    raise exception 'test_fault' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create function public.test_fault_stock() returns trigger language plpgsql as $$
begin
  if (current_setting('test.fail', true) = 'raw' and new.type = 'consumption' and new.ref_id::text = current_setting('test.fail_line', true))
     or (current_setting('test.fail', true) = 'stockwaste' and new.type = 'waste' and new.ref_type = 'order_void') then
    raise exception 'test_fault' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create function public.test_fault_batch() returns trigger language plpgsql as $$
begin
  if current_setting('test.fail', true) = 'waste' and new.type = 'waste' and new.ref_type = 'order_void' then
    raise exception 'test_fault' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger test_fault_cost before insert on public.order_line_cost for each row execute function public.test_fault_cost();
create trigger test_fault_stock before insert on public.stock_movement for each row execute function public.test_fault_stock();
create trigger test_fault_batch before insert on public.batch_movement for each row execute function public.test_fault_batch();
create function pg_temp.fail(p_what text, p_line text default null) returns void language sql as $$
  select set_config('test.fail', p_what, true), set_config('test.fail_line', coalesce(pg_temp.id(p_line)::text, ''), true) $$;
-- A snapshot of everything a fire writes or settles, for two scenarios.
create function pg_temp.snap() returns text language sql as $$
  select (select count(*) from public.batch_movement)::text || '/' || (select count(*) from public.stock_movement)::text || '/'
      || (select count(*) from public.order_line_cost)::text || '/' || (select count(*) from public.alert)::text || '/'
      || (select string_agg(state::text, ',' order by id) from public.batch) || '/'
      || (select string_agg(state::text, ',' order by id) from public.order_line) $$;

select pg_temp.mkscn(1);                       -- lines a and b (normal)
select pg_temp.mkscn(2, 0, 0, 'finished');     -- a line that will be a shortage
select pg_temp.mkscn(3); select pg_temp.mkscn(4);
select pg_temp.mkline('a1', 'i1'); select pg_temp.mkline('a2', 'i2');
create temporary table snap0 as select pg_temp.snap() s;

-- Fault in the cost row of the second line (id order decides which line is second)
select pg_temp.fail('cost', 'a2');
select is(pg_temp.fire('x1', 'waiter', pg_temp.id('s1'), pg_temp.body('a1', 'a2')), 'P0001 test_fault', 'AT5: a fault in the second line''s cost row raises');
select is(pg_temp.snap(), (select s from snap0),
  'AT5: both lines are drafts, no batch or stock movement, no cost row, no alert, no batch state changed (the first line left nothing)');
select is((select count(*)::int from public.order_line where fired_at is not null), 0, 'and no line carries a fired_at');
-- Fault in the raw outflow of the second line
select pg_temp.fail('raw', 'a2');
select is(pg_temp.fire('x2', 'waiter', pg_temp.id('s1'), pg_temp.body('a1', 'a2')), 'P0001 test_fault', 'a fault in the second line''s raw outflow raises');
select is(pg_temp.snap(), (select s from snap0), 'nothing of the first line remains either');
-- The same fault on the other line: whichever of the two is processed first, nothing of it may remain.
select pg_temp.fail('cost', 'a1');
select is(pg_temp.fire('x3', 'waiter', pg_temp.id('s1'), pg_temp.body('a1', 'a2')), 'P0001 test_fault', 'the same fault on the other line raises');
select is(pg_temp.snap(), (select s from snap0), 'and nothing remains whichever line is processed first');
-- A shortage line: its movement, its alert and the settled batch states are written BEFORE its own cost row, so a fault on that
-- cost row proves they roll back too (a3 is a shortage: scenario 2 has no live portion).
select pg_temp.mkline('a3', 'i2'); select pg_temp.mkline('a4', 'i3');
create temporary table snap1 as select pg_temp.snap() s;
select pg_temp.fail('cost', 'a3');
select is(pg_temp.fire('x4', 'waiter', pg_temp.id('s1'), pg_temp.body('a3', 'a4')), 'P0001 test_fault', 'a fault on the cost row of a shortage line raises');
select is(pg_temp.snap(), (select s from snap1), 'the shortage movement, its alert and the settled states are rolled back, and so is the other line');
select is((select count(*)::int from public.alert where kind = 'negative_stock'), 0, 'no negative_stock alert survived');

-- Without the flag the same calls succeed (the fixture is valid)
select pg_temp.fail('none', null);
select is(pg_temp.fire('ok1', 'waiter', pg_temp.id('s1'), pg_temp.body('a1', 'a2')), 'ok', 'without the flag the same fire succeeds');
select is((select count(*)::int from public.order_line_cost), 2, 'with two cost rows');
select is((select count(*)::int from public.order_line where fired_at is not null), 2, 'and two fired lines');
select is(pg_temp.fire('ok2', 'waiter', pg_temp.id('s1'), pg_temp.body('a3', 'a4')), 'ok', 'and the shortage-plus-normal pair succeeds too');
select is((select count(*)::int from public.alert where kind = 'negative_stock' and entity_id = pg_temp.id('s2key')), 1, 'with its alert');

-- Void: a fault in the waste row of a fired line
select pg_temp.fail('none', null);
create temporary table snap2 as select pg_temp.snap() s;
select pg_temp.fail('waste', null);
select is(pg_temp.void('y1', 'waiter', pg_temp.id('a1'), pg_temp.vb('kitchen_error')), 'P0001 test_fault', 'a fault on the void''s waste row raises');
select is(pg_temp.snap(), (select s from snap2), 'the line stays fired; the reversal written before the fault is gone');
select is((select state::text from public.order_line where id = pg_temp.id('a1')), 'fired', 'a1 is still fired');
select is((select count(*)::int from public.batch_movement where reverses_id is not null), 0, 'no reversal row exists');
select pg_temp.fail('stockwaste', null);
select is(pg_temp.void('y2', 'waiter', pg_temp.id('a1'), pg_temp.vb('kitchen_error')), 'P0001 test_fault', 'a fault on the stock waste row raises');
select is(pg_temp.snap(), (select s from snap2), 'nothing remains of the batch pair or the stock reversal');
select pg_temp.fail('none', null);
select is(pg_temp.void('y3', 'waiter', pg_temp.id('a1'), pg_temp.vb('kitchen_error')), 'ok', 'without the flag the void succeeds');
select is((select count(*)::int from public.batch_movement where reverses_id is not null) + (select count(*)::int from public.stock_movement where reverses_id is not null), 4,
  'with its 1 batch reversal and 3 stock reversals');

select * from finish();
rollback;
