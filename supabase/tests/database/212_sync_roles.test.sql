-- M20 step 5 (docs/plans/2026-10-29-m20-offline.md §3.1.9, §3.2, §5 step 5; ADR-005, ADR-022; AT8 server side): who may call apply_op, the user
-- binding in Postgres, tenancy, and the helpers closed to every API role. Waiter A is Cameriere Demo, waiter B (waiter2) is Cameriere Due Demo,
-- tenant B has an owner only. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);



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


-- A second waiter, tables without a session, prices ------------------------------------------------------------------------------
insert into auth.users (id, email) values ('d0000000-0000-4000-8000-0000000000d2', 'waiter-a2@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('d1000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-0000000000d2', 'waiter', 'Cameriere Due Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Tavolo 4 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Tavolo 5 (demo)', 5, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
create or replace function pg_temp.claims(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',
    case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f'
               when 'chef' then 'c0000000-0000-4000-8000-00000000000c' when 'ownerb' then 'b0000000-0000-4000-8000-00000000000b'
               when 'waiter2' then 'd0000000-0000-4000-8000-0000000000d2'
               when 'nobody' then '99999999-9999-4999-8999-999999999999'
               else 'd0000000-0000-4000-8000-00000000000d' end,
    'role', 'authenticated',
    'tenant_id', case when p_who = 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end,
    'app_role', case when p_who = 'ownerb' then 'owner' when p_who = 'waiter2' then 'waiter' else p_who end)::text, true)
$$;

-- Scenarios: 1 (stew, fires in section 1), 2 (stew, duplicates), 3 (stew, conflicts), 4 (no live batch: sold out)
select pg_temp.mkscn(1); select pg_temp.mkscn(2); select pg_temp.mkscn(3); select pg_temp.mkscn(4, 0, 0, 'finished');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  select '11111111-1111-4111-8111-111111111111', id, 14, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a'
    from public.menu_item where tenant_id = '11111111-1111-4111-8111-111111111111';
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  values ('22222222-2222-4222-8222-222222222222', '11000000-0000-4000-8000-0000000000b1', 5, 22, now() - interval '1 day', 'b1000000-0000-4000-8000-00000000000b');
insert into reg values ('acqua', '11000000-0000-4000-8000-0000000000a1'), ('itemb', '11000000-0000-4000-8000-0000000000b1'),
  ('t4', '13000000-0000-4000-8000-000000000004'), ('t5', '13000000-0000-4000-8000-000000000005');

-- Helpers for ops ------------------------------------------------------------------------------------------------------------------
create temporary table res2 (nm text primary key, j jsonb);
create temporary table marks (k text primary key, t timestamptz not null);
-- An instant p_ago seconds before now, as the phone would write it.
create function pg_temp.ts(p_ago numeric default 0) returns text language sql as $$
  select to_char((clock_timestamp() - make_interval(secs => p_ago)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
create function pg_temp.u(p_n int) returns uuid language sql as $$ select ('e2000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.op(p_kind text, p_payload jsonb, p_ts text default null, p_seq int default 1, p_id uuid default null,
    p_user text default 'd1000000-0000-4000-8000-00000000000d') returns jsonb language sql as $$
  select jsonb_build_object('opId', coalesce(p_id, gen_random_uuid()), 'seq', p_seq, 'kind', p_kind, 'clientTs', coalesce(p_ts, pg_temp.ts()),
                            'userId', p_user, 'payload', p_payload) $$;
-- apply_op as a role; 'ok' (the reply stored under nm) or "SQLSTATE message". A failed call rolls back all of its writes.
create function pg_temp.apply(p_nm text, p_who text, p_op jsonb) returns text language plpgsql as $$
declare
  v_j jsonb;
  state text;
  msg text;
begin
  perform pg_temp.claims(p_who);
  begin
    set local role authenticated;
    v_j := public.apply_op(p_op);
    reset role;
    insert into res2 values (p_nm, v_j) on conflict (nm) do update set j = excluded.j;
    return 'ok';
  exception when others then
    reset role;
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    return state || ' ' || msg;
  end;
end
$$;
create function pg_temp.quiet(p_nm text, p_who text, p_op jsonb) returns void language plpgsql as $$ begin perform pg_temp.apply(p_nm, p_who, p_op); end $$;
create function pg_temp.r(p_nm text) returns jsonb language sql as $$ select j from res2 where nm = p_nm $$;
create function pg_temp.rows_of(p_op jsonb) returns int language sql as $$
  select count(*)::int from public.applied_op where op_id = (p_op ->> 'opId')::uuid $$;
create function pg_temp.hash_of(p_op jsonb) returns text language sql as $$
  select encode(sha256(convert_to((p_op -> 'payload')::text || '|' || (p_op ->> 'kind') || '|' || (p_op ->> 'clientTs'), 'UTF8')), 'hex') $$;
create function pg_temp.moves() returns int language sql as $$ select count(*)::int from public.batch_movement where type = 'consume' $$;
create function pg_temp.line_state(p_line uuid) returns text language sql as $$
  select state || '/' || coalesce(void_reason, '-') || '/' || trim_scale(qty)::text from public.order_line where id = p_line $$;
create function pg_temp.add_payload(p_session text, p_line uuid, p_item text, p_qty numeric default 1) returns jsonb language sql as $$
  select jsonb_build_object('sessionId', pg_temp.id(p_session), 'lineId', p_line, 'menuItemId', pg_temp.id(p_item), 'qty', p_qty) $$;

create temporary table o (k text primary key, op jsonb not null);
create function pg_temp.owner_op(p_kind text, p_payload jsonb, p_user text, p_ts text default null, p_seq int default 1, p_id uuid default null) returns jsonb language sql as $$
  select pg_temp.op(p_kind, p_payload, p_ts, p_seq, p_id, p_user) $$;
create function pg_temp.lines() returns int language sql as $$ select count(*)::int from public.order_line $$;
create function pg_temp.ops() returns int language sql as $$ select count(*)::int from public.applied_op $$;
create temporary table cnt (k text primary key, lines int, ops int);

-- Roles ---------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.apply('r_owner', 'owner', pg_temp.owner_op('add_line', pg_temp.add_payload('s1', pg_temp.u(1), 'i1'), 'a1000000-0000-4000-8000-00000000000a')), 'ok', 'the owner may call apply_op');
select is(pg_temp.r('r_owner') ->> 'status', 'applied', 'and the add is applied');
select is(pg_temp.apply('r_admin', 'admin', pg_temp.owner_op('add_line', pg_temp.add_payload('s1', pg_temp.u(2), 'i1'), 'f1000000-0000-4000-8000-00000000000f')), 'ok', 'the admin may call apply_op');
select is(pg_temp.apply('r_waiter', 'waiter', pg_temp.owner_op('add_line', pg_temp.add_payload('s1', pg_temp.u(3), 'i1'), 'd1000000-0000-4000-8000-00000000000d')), 'ok', 'waiter A may call apply_op');
select is((select count(*)::int from public.order_line where id in (pg_temp.u(1), pg_temp.u(2), pg_temp.u(3))), 3, 'all three lines exist');
select is((select string_agg(a.user_id::text, ',' order by a.user_id::text collate "C") from public.applied_op a),
          'a1000000-0000-4000-8000-00000000000a,d1000000-0000-4000-8000-00000000000d,f1000000-0000-4000-8000-00000000000f', 'each applied_op row carries its own caller');

insert into cnt values ('before', pg_temp.lines(), pg_temp.ops());
select is(pg_temp.apply('r_chef', 'chef', pg_temp.owner_op('add_line', pg_temp.add_payload('s1', pg_temp.u(4), 'i1'), 'c1000000-0000-4000-8000-00000000000c')), '42501 permission denied: opening tables needs owner, admin or waiter', 'the chef is refused with 42501');
select is(pg_temp.apply('r_chef_fire', 'chef', pg_temp.owner_op('fire', jsonb_build_object('sessionId', pg_temp.id('s1'), 'lineIds', jsonb_build_array(pg_temp.u(1))), 'c1000000-0000-4000-8000-00000000000c')), '42501 permission denied: opening tables needs owner, admin or waiter', 'also for a fire');
select is((select (lines = pg_temp.lines() and ops = pg_temp.ops())::text from cnt where k = 'before'), 'true', 'nothing was written or stored');
select is(pg_temp.apply('r_nobody', 'nobody', pg_temp.owner_op('add_line', pg_temp.add_payload('s1', pg_temp.u(5), 'i1'), 'd1000000-0000-4000-8000-00000000000d')), '42501 permission denied: opening tables needs owner, admin or waiter', 'a caller with no app role is refused with 42501');
create function pg_temp.no_claims() returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  perform public.apply_op(pg_temp.owner_op('add_line', pg_temp.add_payload('s1', pg_temp.u(6), 'i1'), 'd1000000-0000-4000-8000-00000000000d'));
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state;
end
$$;
select is(pg_temp.no_claims(), '42501', 'no claims at all: 42501');
select is(has_function_privilege('anon', 'public.apply_op(jsonb)', 'execute'), false, 'anon cannot execute apply_op');
select is(has_function_privilege('authenticated', 'public.apply_op(jsonb)', 'execute'), true, 'authenticated can');
select is(has_function_privilege('service_role', 'public.apply_op(jsonb)', 'execute'), false, 'service_role cannot');

-- User binding (AT8, server side) ----------------------------------------------------------------------------------------------------
update cnt set lines = pg_temp.lines(), ops = pg_temp.ops() where k = 'before';
insert into o values ('bind', pg_temp.owner_op('add_line', pg_temp.add_payload('s1', pg_temp.u(10), 'i1'), 'd1000000-0000-4000-8000-0000000000d2'));
select is(pg_temp.apply('bind_a', 'waiter', (select op from o where k = 'bind')), '42501 user_mismatch', 'waiter A sending an op that names Cameriere Due: 42501 user_mismatch');
select is((select (lines = pg_temp.lines() and ops = pg_temp.ops())::text from cnt where k = 'before'), 'true', 'no order_line and no applied_op row');
select is(pg_temp.apply('bind_owner', 'owner', (select op from o where k = 'bind')), '42501 user_mismatch', 'the owner sending it is refused the same way');
select is(pg_temp.apply('bind_b', 'waiter2', (select op from o where k = 'bind')), 'ok', 'Cameriere Due sending the same op: it goes through');
select is(pg_temp.r('bind_b') ->> 'status', 'applied', 'and is applied');
select is((select a.user_id::text || '/' || l.created_by::text from public.applied_op a join public.order_line l on l.id = pg_temp.u(10) where a.op_id = (select (op ->> 'opId')::uuid from o where k = 'bind')),
          'd1000000-0000-4000-8000-0000000000d2/d1000000-0000-4000-8000-0000000000d2', 'the row and the line belong to Cameriere Due');
-- The binding is checked before the lookup: Cameriere Demo cannot even learn that the op is a duplicate.
select is(pg_temp.apply('bind_dup', 'waiter', (select op from o where k = 'bind')), '42501 user_mismatch', 'a duplicate sent by the wrong person is still user_mismatch (checked before the lookup)');
select is(pg_temp.apply('bind_dup2', 'waiter2', (select op from o where k = 'bind')), 'ok', 'sent by its owner it is a duplicate');
select is(pg_temp.r('bind_dup2') ->> 'status', 'duplicate', 'duplicate');

-- Tenancy ----------------------------------------------------------------------------------------------------------------------------------
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  select '22222222-2222-4222-8222-222222222222', id, 5, 22, now() - interval '1 day', 'b1000000-0000-4000-8000-00000000000b'
    from public.menu_item where id = pg_temp.id('itemb') and not exists (select 1 from public.menu_item_price p where p.menu_item_id = pg_temp.id('itemb'));
update cnt set lines = pg_temp.lines(), ops = pg_temp.ops() where k = 'before';
select is(pg_temp.apply('t_cross', 'ownerb', pg_temp.owner_op('add_line', jsonb_build_object('sessionId', pg_temp.id('s1'), 'lineId', pg_temp.u(20), 'menuItemId', pg_temp.id('itemb')), 'b1000000-0000-4000-8000-00000000000b')), 'ok',
          'tenant B''s owner sending an add that names tenant A''s session is answered');
select is(pg_temp.r('t_cross') ->> 'status' || '/' || (pg_temp.r('t_cross') -> 'result' ->> 'message'), 'rejected/session_not_found', 'rejected session_not_found');
select is((select count(*)::int from public.order_line where id = pg_temp.u(20)), 0, 'no line was created in tenant A');
-- B reuses A's op id with B's own valid payload
select is(pg_temp.apply('t_reuse', 'ownerb', pg_temp.owner_op('add_line', jsonb_build_object('sessionId', pg_temp.id('sb'), 'lineId', pg_temp.u(21), 'menuItemId', pg_temp.id('itemb')),
          'b1000000-0000-4000-8000-00000000000b', null, 1, (select (op ->> 'opId')::uuid from o where k = 'bind'))), 'ok', 'tenant B reusing tenant A''s op id with its own payload is answered');
select is(pg_temp.r('t_reuse') ->> 'status', 'applied', 'it is applied (keys are tenant-scoped)');
select is((select count(*)::int from public.applied_op where op_id = (select (op ->> 'opId')::uuid from o where k = 'bind')), 2, 'two rows, one per tenant');
select is((select a.payload_hash = encode(sha256(convert_to((o.op -> 'payload')::text || '|' || (o.op ->> 'kind') || '|' || (o.op ->> 'clientTs'), 'UTF8')), 'hex')
             from public.applied_op a, o where o.k = 'bind' and a.op_id = (o.op ->> 'opId')::uuid and a.tenant_id = '11111111-1111-4111-8111-111111111111'),
          true, 'tenant A''s row is untouched');

-- Helpers closed to every API role ------------------------------------------------------------------------------------------------------
select is((select bool_or(has_function_privilege(r, f, 'execute'))
             from unnest(array['anon', 'authenticated', 'service_role']) r,
                  unnest(array['app.sync_op_kinds()', 'app.sync_conflict_codes()', 'app.apply_op_dispatch(text,jsonb,text)', 'app.apply_op_check_payload(text,jsonb)']) f),
          false, 'app.sync_op_kinds, sync_conflict_codes, apply_op_dispatch and apply_op_check_payload are not executable by any API role');
select is(app.sync_conflict_codes(), array['session_closed', 'table_already_open'], 'the conflict codes are session_closed and table_already_open');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc
            where pronamespace = 'public'::regnamespace and proname ~* '(cost|margin|price)'),
          'batch_costs,cost_settings,count_variance_costs,enter_fixed_costs,fixed_cost_status,ingredient_costs,plate_costs,plate_margins_pct,raw_waste_costs,recipe_cost_at,recipe_costs,set_ingredient_cost_basis,update_cost_settings,waste_costs',
          'the cost-named public functions are unchanged (apply_op is not among them)');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.apply_op(jsonb)'::regprocedure), true, 'apply_op is security definer with an empty search_path');

select * from finish();
rollback;
