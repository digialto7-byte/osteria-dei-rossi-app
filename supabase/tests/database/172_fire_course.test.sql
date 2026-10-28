-- M19 step 3: fire_course and the real app.session_fired_lines (M19 plan §3.1.1-3.1.6, §3.2; ADR-019; AT1-AT4, AT7).
-- Called as the waiter unless named. Every scenario has its own stew batch key, ingredients, lots, plate and menu item
-- (so a fire never depends on what another scenario consumed); each has two live batches plus an expired, a finished and
-- a discarded one, and polenta in two locations. Lines and batches are found by id, never by position. Dates are
-- relative to now(). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

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
               else 'd0000000-0000-4000-8000-00000000000d' end,
    'role', 'authenticated',
    'tenant_id', case when p_who = 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end,
    'app_role', case when p_who = 'ownerb' then 'owner' else p_who end)::text, true)
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

-- Scenarios ---------------------------------------------------------------------------------------------------------------------
select pg_temp.mkscn(1);                       -- AT1, AT3, AT7, key set, idempotency, line facts
select pg_temp.mkscn(2);                       -- AT2a half portion
select pg_temp.mkscn(3, 1, 5);                 -- AT2b A at 1
select pg_temp.mkscn(4, 0, 0, 'finished');     -- AT4: no live batch
select pg_temp.mkscn(5);                       -- shared plate
select pg_temp.mkscn(6);                       -- two courses in one call
select pg_temp.mkscn(7); select pg_temp.mkscn(8);   -- plate version 2 created after the add (v2 uses stew 8)
select pg_temp.mkscn(9);                       -- error cases / status
select pg_temp.mkscn(10);                      -- idempotency and mixed bodies (scenario 1's plate gets a new version in the AT7 step)
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into reg values ('acqua', '11000000-0000-4000-8000-0000000000a1'), ('lb', 'e1000000-0000-4000-8000-0000000000b1');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  values ('e1000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '14000000-0000-4000-8000-0000000000b1',
          '11000000-0000-4000-8000-0000000000b1', 'dolci', 1, 3, 22, 'menu', '2026-10-24 12:00+00', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

-- AT1 / AT3 / line facts ---------------------------------------------------------------------------------------------------------
select pg_temp.mkline('l1', 'i1');
select pg_temp.mkline('l1b', 'i10', 1, 'secondi', 's1');
select is(pg_temp.fire('f1', 'waiter', pg_temp.id('s1'), pg_temp.body('l1')), 'ok', 'a waiter fires one line');
select is(pg_temp.cons(1), 'A=-1', 'AT1: one Spezzatino takes A -1 and leaves B alone');
select is(pg_temp.bal('s1B'), 5::numeric, 'AT1: B keeps its 5');
select is(pg_temp.stock('pol1'), 'p11@disp -0.05, p12@cella -0.1', 'AT3: polenta by recipe quantity, FEFO across locations: P2 (Cella) -0,1 then P1 (Dispensa) -0,05');
select is(pg_temp.stock('pane1'), 'n1@disp -0.1', 'AT3: pane -0,1 (50 g at yield 0,5)');
select is(pg_temp.j('f1') -> 'fired', to_jsonb(array[pg_temp.id('l1')]), 'the reply lists the fired id');
select is(pg_temp.j('f1') -> 'skipped', '[]'::jsonb, 'and nothing is skipped');
select is((select l.fired_by = 'd1000000-0000-4000-8000-00000000000d' and l.fired_at is not null and l.state = 'fired'
                  and l.updated_by = 'd1000000-0000-4000-8000-00000000000d' and l.client_updated_at = '2026-10-24 12:00+00'
                  and l.unit_price = 14 and l.updated_at = l.created_at
             from public.order_line l where l.id = pg_temp.id('l1')), true,
  'fired_at/fired_by set by the caller; updated_*, client_updated_at, the price are untouched');
select is((select state::text from public.order_line where id = pg_temp.id('l1b')), 'draft', 'the other draft line is still a draft');
select is(pg_temp.cost_of('l1'), '2.98 2.98 false', 'the cost row is written in the same transaction: 2,98');
select is((select r.recipe_id from public.order_line_cost r where r.order_line_id = pg_temp.id('l1')), pg_temp.id('r1'), 'and records the plate version');
select is(pg_temp.j('f1') -> 'lines' -> 0 ->> 'state', 'fired', 'the reply line is fired');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.j('f1') -> 'lines' -> 0) k),
  array['clientUpdatedAt', 'course', 'id', 'isShared', 'menuItemId', 'name', 'note', 'qty', 'segue', 'state', 'unitPrice', 'updatedAt', 'updatedBy'],
  'a reply line has exactly the thirteen M18 keys');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.j('f1')) k), array['fired', 'lines', 'skipped'], 'the reply is {lines, fired, skipped}');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.j('f1')) k where k ~* 'cost|margin|gp|food|eur$|recipe|vat'), 0,
  'a recursive key scan of the reply finds no cost, margin, GP, food, eur, recipe or VAT key');

-- AT7: a later price, cost basis and plate version leave the frozen row untouched
create temporary table frozen as select to_jsonb(c) j from public.order_line_cost c where c.order_line_id = pg_temp.id('l1');
select pg_temp.buy('pol1', 9.9, 0);
insert into public.ingredient_cost_basis (tenant_id, ingredient_id, basis, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('pol1'), 'last_price', now(), 'a1000000-0000-4000-8000-00000000000a');
insert into reg values ('r1v3', gen_random_uuid());
update public.recipe_key set current_version = 2 where id = pg_temp.id('pl1');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
  values (pg_temp.id('r1v3'), '11111111-1111-4111-8111-111111111111', pg_temp.id('pl1'), 2, now(), 'Piatto 1 v2', 'a1000000-0000-4000-8000-00000000000a');
select is((select to_jsonb(c) from public.order_line_cost c where c.order_line_id = pg_temp.id('l1')), (select j from frozen),
  'AT7: after a new polenta price, a new cost basis and a new plate version the frozen cost row is identical');
select is(pg_temp.err($$ update public.order_line_cost set total_cost = 1 where order_line_id = (select id from reg where k = 'l1') $$), 'P0001 append_only',
  'AT7: the row cannot be rewritten');

-- Idempotency: the same body again ------------------------------------------------------------------------------------------------
create temporary table before_counts as select pg_temp.counts() c;
select is(pg_temp.fire('f1b', 'waiter', pg_temp.id('s1'), pg_temp.body('l1')), 'ok', 'the same fire again answers normally');
select is(pg_temp.j('f1b') -> 'fired', '[]'::jsonb, 'replay: nothing fired');
select is(pg_temp.j('f1b') -> 'skipped', jsonb_build_array(jsonb_build_object('lineId', pg_temp.id('l1'), 'reason', 'already_fired')),
  'replay: skipped already_fired');
select is(pg_temp.counts(), (select c from before_counts), 'replay: movement, cost and alert counts are unchanged');
select is(pg_temp.j('f1b') -> 'lines' -> 0 ->> 'state', 'fired', 'and the reply still carries the line as it is');

-- Mixed bodies: draft + fired + voided -------------------------------------------------------------------------------------------------
select pg_temp.mkline('lv', 'i10');
update public.order_line set voided_at = now(), voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'entry_removed' where id = pg_temp.id('lv');
select is(pg_temp.fire('f1c', 'waiter', pg_temp.id('s1'), pg_temp.body('l1', 'l1b', 'lv')), 'ok', 'a body with a draft, a fired and a voided line');
select is(pg_temp.j('f1c') -> 'fired', to_jsonb(array[pg_temp.id('l1b')]), 'only the draft is fired');
select is((select jsonb_agg(e order by (e ->> 'reason') collate "C") from jsonb_array_elements(pg_temp.j('f1c') -> 'skipped') e),
  (select jsonb_agg(e order by (e ->> 'reason') collate "C") from (values
     (jsonb_build_object('lineId', pg_temp.id('l1'), 'reason', 'already_fired')),
     (jsonb_build_object('lineId', pg_temp.id('lv'), 'reason', 'voided'))) x (e)),
  'skipped names the fired line as already_fired and the voided one as voided');
select is(pg_temp.cons(10), 'A=-1', 'the fired draft took A -1 of its own plate (the voided line took nothing)');

-- AT2 ---------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mkline('l2', 'i2', 0.5);
select is(pg_temp.fire('f2', 'waiter', pg_temp.id('s1'), pg_temp.body('l2')), 'ok', 'a half portion is fired');
select is(pg_temp.cons(2), 'A=-0.5', 'AT2a: 0,5 takes A -0,5');
select is(pg_temp.stock('pol2'), 'p22@cella -0.075', 'and 0,5 x the raw quantities (polenta 0,075, all from P2 which expires first)');
select is(pg_temp.cost_of('l2'), '1.49 2.98 false', 'cost 1,49 total and 2,98 per full plate');
select pg_temp.mkline('l3', 'i3', 2);
select is(pg_temp.fire('f3', 'waiter', pg_temp.id('s1'), pg_temp.body('l3')), 'ok', 'a qty 2 line is fired with A at 1');
select is(pg_temp.cons(3), 'A=-1 B=-1', 'AT2b: A -1 then B -1');
select is((select state::text from public.batch where id = pg_temp.id('s3A')), 'finished', 'A is finished');

-- AT4: no live portion -------------------------------------------------------------------------------------------------------------------
select pg_temp.mkline('l4', 'i4');
select is(pg_temp.fire('f4', 'waiter', pg_temp.id('s1'), pg_temp.body('l4')), 'ok', 'AT4: with no live portion the fire still succeeds (200, no error)');
select is(pg_temp.cons(4), 'D=-1', 'AT4: the movement is on the fallback batch D (newest non-discarded)');
select is(pg_temp.bal('s4D'), -1::numeric, 'AT4: its balance is negative');
select is((select count(*)::int from public.alert where kind = 'negative_stock' and entity_type = 'recipe_key' and entity_id = pg_temp.id('s4key')), 1,
  'AT4: one negative_stock alert for the recipe key');
select is(pg_temp.stock('pol4'), 'p41@disp -0.05, p42@cella -0.1', 'raw stock is still depleted');

-- Shared plate and two courses --------------------------------------------------------------------------------------------------------
select pg_temp.mkline('l5', 'i5', 1, 'secondi', 's1', true);
select is(pg_temp.fire('f5', 'waiter', pg_temp.id('s1'), pg_temp.body('l5')), 'ok', 'a shared plate is fired');
select is(pg_temp.cons(5), 'A=-1', 'a shared plate of qty 1 depletes 1');
select pg_temp.mkline('l6a', 'i6', 1, 'antipasti'); select pg_temp.mkline('l6b', 'i6', 1, 'secondi');
select is(pg_temp.fire('f6', 'waiter', pg_temp.id('s1'), pg_temp.body('l6a', 'l6b')), 'ok', 'two courses in one call');
select is((select count(distinct fired_at)::int from public.order_line where id in (pg_temp.id('l6a'), pg_temp.id('l6b'))), 1, 'one fired_at for both lines');
select is(pg_temp.j('f6') -> 'lines' -> 0 ->> 'course' || ',' || (pg_temp.j('f6') -> 'lines' -> 1 ->> 'course'), 'antipasti,secondi', 'the reply is ordered by course');

-- Unmapped item ----------------------------------------------------------------------------------------------------------------------------
select pg_temp.mkline('lw', 'acqua', 1, 'bevande');
select is(pg_temp.fire('fw', 'waiter', pg_temp.id('s1'), pg_temp.body('lw')), 'ok', 'an unmapped item is fired');
select is((select count(*)::int from public.batch_movement where ref_id = pg_temp.id('lw')) + (select count(*)::int from public.stock_movement where ref_id = pg_temp.id('lw')), 0, 'with no movement');
select is((select recipe_id is null and incomplete and total_cost is null from public.order_line_cost where order_line_id = pg_temp.id('lw')), true,
  'and a cost row with recipe_id null, incomplete');

-- The plate version in force when the line is fired --------------------------------------------------------------------------------------------
select pg_temp.mkline('l7', 'i7');
insert into reg values ('r7v2', gen_random_uuid());
update public.recipe_key set current_version = 2 where id = pg_temp.id('pl7');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
  values (pg_temp.id('r7v2'), '11111111-1111-4111-8111-111111111111', pg_temp.id('pl7'), 2, now(), 'Piatto 7 v2', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('r7v2'), 1, pg_temp.id('s8key'), 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');
select is(pg_temp.fire('f7', 'waiter', pg_temp.id('s1'), pg_temp.body('l7')), 'ok', 'a line added under v1 is fired after v2 exists');
select is(pg_temp.cons(7) || ' / ' || pg_temp.cons(8), '- / A=-1', 'it depletes the stew of v2 (set 8), not v1 (set 7)');
select is((select recipe_id from public.order_line_cost where order_line_id = pg_temp.id('l7')), pg_temp.id('r7v2'), 'and the cost row records v2');
select is(pg_temp.stock('pol7'), '-', 'v2 has no polenta: none is taken');

-- Errors ------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mkline('l9', 'i9'); select pg_temp.mkline('l9s2', 'i9', 1, 'secondi', 's2');
create temporary table before_err as select pg_temp.counts() c;
select is(pg_temp.fire('e1', 'waiter', pg_temp.id('s1'), '{"lineIds": []}'), '22023 invalid_request', 'an empty list is invalid_request');
select is(pg_temp.fire('e2', 'waiter', pg_temp.id('s1'), jsonb_build_object('lineIds', jsonb_build_array(pg_temp.id('l9'), pg_temp.id('l9')))), '22023 invalid_request', 'duplicate ids are invalid_request');
select is(pg_temp.fire('e3', 'waiter', pg_temp.id('s1'), jsonb_build_object('lineIds', (select jsonb_agg(gen_random_uuid()) from generate_series(1, 51)))), '22023 invalid_request', '51 ids are invalid_request');
select is(pg_temp.fire('e4', 'waiter', pg_temp.id('s1'), jsonb_build_object('lineIds', jsonb_build_array(pg_temp.id('l9')), 'x', 1)), '22023 invalid_request', 'an extra key is invalid_request');
select is(pg_temp.fire('e5', 'waiter', pg_temp.id('s1'), '{"lineIds": ["nope"]}'), '22023 invalid_request', 'a non-uuid is invalid_request');
select is(pg_temp.fire('e6', 'waiter', pg_temp.id('s1'), '{"lineIds": "x"}'), '22023 invalid_request', 'lineIds that is not an array is invalid_request');
select is(pg_temp.fire('e7', 'waiter', pg_temp.id('s1'), null), '22023 invalid_request', 'a null body is invalid_request');
select is(pg_temp.fire('e8', 'waiter', null, pg_temp.body('l9')), '22023 invalid_request', 'a null session is invalid_request');
select is(pg_temp.fire('e9', 'waiter', pg_temp.id('s1'), pg_temp.body('l9', 'l9s2')), 'P0002 line_not_found', 'a line of another session: line_not_found');
select is((select state::text from public.order_line where id = pg_temp.id('l9')), 'draft', 'and nothing was written: the line of S1 is still a draft');
select is(pg_temp.counts(), (select c from before_err), 'no movement, cost or alert appeared for any rejected call');
select is(pg_temp.fire('e10', 'waiter', pg_temp.id('s1'), pg_temp.body('lb')), 'P0002 line_not_found', 'tenant B''s line: line_not_found');
select is(pg_temp.fire('e11', 'waiter', pg_temp.id('sb'), pg_temp.body('l9')), 'P0002 session_not_found', 'tenant B''s session: session_not_found');
select pg_temp.mkline('l9c', 'i9', 1, 'secondi', 's3');
select is(pg_temp.fire('e12', 'waiter', pg_temp.id('s3'), pg_temp.body('l9c')), 'P0001 session_closed', 'a closed session: session_closed');
select is(pg_temp.fire('e13', 'chef', pg_temp.id('s1'), pg_temp.body('l9')), '42501 permission denied: opening tables needs owner, admin or waiter', 'the chef is refused');
select is(pg_temp.fire('e14', 'owner', pg_temp.id('s1'), pg_temp.body('l9')), 'ok', 'the owner may fire');
select pg_temp.mkline('l9x', 'i9');
select is(pg_temp.fire('e15', 'admin', pg_temp.id('s1'), pg_temp.body('l9x')), 'ok', 'the admin may fire');
select is((select count(distinct fired_by)::int from public.order_line where id in (pg_temp.id('l9'), pg_temp.id('l9x'))), 2, 'fired_by is the caller each time');

-- A fired line can no longer be edited --------------------------------------------------------------------------------------------------------
select pg_temp.mkline('l10', 'i9');
select is(pg_temp.fire('f10', 'waiter', pg_temp.id('s1'), pg_temp.body('l10')), 'ok', 'one more fire for the edit check');
select is(pg_temp.upd('waiter', pg_temp.id('l10'),
    jsonb_build_object('qty', 2, 'clientUpdatedAt', to_char((clock_timestamp() - interval '1 second') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    -> 'conflict' ->> 'reason', 'fired', 'update_order_line afterwards answers conflict fired');

-- Status: session_fired_lines counts fired lines, voided ones too ---------------------------------------------------------------------------------------
select is((select count(*)::int from app.session_fired_lines('11111111-1111-4111-8111-111111111111', array[pg_temp.id('s2')])), 0, 'S2 (draft line only): no row');
select is((select f.fired_lines from app.session_fired_lines('11111111-1111-4111-8111-111111111111', array[pg_temp.id('s1')]) f) >= 10, true, 'S1 counts its fired lines');
select is((select status from app.session_statuses('11111111-1111-4111-8111-111111111111', array[pg_temp.id('s1')])), 'courses_sent', 'S1 is courses_sent');
select is((select status from app.session_statuses('11111111-1111-4111-8111-111111111111', array[pg_temp.id('s2')])), 'open', 'S2 is still open');
select pg_temp.mkline('lq', 'i9', 1, 'secondi', 's2');
update public.order_line set fired_at = now(), fired_by = 'd1000000-0000-4000-8000-00000000000d' where id = pg_temp.id('lq');
update public.order_line set voided_at = now(), voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'kitchen_error' where id = pg_temp.id('lq');
select is((select status from app.session_statuses('11111111-1111-4111-8111-111111111111', array[pg_temp.id('s2')])), 'courses_sent', 'a fired-then-voided line still counts');
create temporary table views (nm text primary key, j jsonb);
grant insert, select on views to authenticated;
set local role authenticated;
select pg_temp.claims('waiter');
insert into views select 'ov', public.order_view(pg_temp.id('s1'));
insert into views select 'tl', public.tables_list();
reset role;
select is((select j -> 'session' ->> 'status' from views where nm = 'ov'), 'courses_sent', 'order_view shows courses_sent');
select is((select e ->> 'status' from views, jsonb_array_elements(j -> 'tables') e where nm = 'tl' and e ->> 'id' = '13000000-0000-4000-8000-000000000001' limit 1), 'courses_sent', 'tables_list shows courses_sent for table 1');

select * from finish();
rollback;
