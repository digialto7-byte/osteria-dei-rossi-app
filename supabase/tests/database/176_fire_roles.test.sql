-- M19 step 7: roles and tenancy of the M19 procedures (M19 plan §3.1.12, §5 step 7; AT9). fire_course and void_line: owner, admin and
-- waiter A are allowed; the chef gets 42501 and nothing is written; no claims is refused; tenant B's owner gets P0002 on A's ids and A's
-- rows stay unchanged. kitchen_tickets: owner, admin, chef allowed, the waiter 42501. AT9: the waiter reads no order_line_cost and no
-- batch_movement row (rows exist), the chef reads no order_line_cost. Execute grants are pinned with has_function_privilege. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

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
  select jsonb_build_object('lineIds', coalesce(jsonb_agg(pg_temp.id(k) order by k), '[]'::jsonb)) from unnest(p_keys) k
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
           order by pg_temp.name_of(m.batch_id)), '-')
    from (select batch_id, sum(portions) s from public.batch_movement
           where type = 'consume' and batch_id in (select id from reg where k ~ ('^s' || p_n || '[A-E]$')) group by batch_id) m
$$;
create function pg_temp.stock(p_ing text) returns text language sql as $$
  select coalesce(string_agg(coalesce(pg_temp.name_of(m.raw_lot_id), 'unlotted') || '@' || pg_temp.name_of(m.location_id) || ' ' || trim_scale(m.qty)::text,
           ', ' order by coalesce(pg_temp.name_of(m.raw_lot_id), 'zz'), m.qty), '-')
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
           || (m.reverses_id is not null)::text, ', ' order by m.ref_type, m.type::text, m.portions), 'none')
    from public.batch_movement m where m.ref_id = pg_temp.id(p_line) $$;
create function pg_temp.srows(p_line text) returns text language sql as $$
  select coalesce(string_agg(s.type::text || ' ' || trim_scale(s.qty)::text || ' ' || coalesce(pg_temp.name_of(s.raw_lot_id), 'unlotted') || '@'
           || pg_temp.name_of(s.location_id) || ' ' || coalesce(s.reason_code, '-') || ' ' || s.ref_type || ' ' || coalesce(trim_scale(s.unit_cost)::text, 'null') || ' '
           || (s.reverses_id is not null)::text, ', ' order by s.ref_type, s.type::text, pg_temp.name_of(s.raw_lot_id), s.qty), 'none')
    from public.stock_movement s where s.ref_id = pg_temp.id(p_line) $$;
-- Net quantity per lot bucket of an ingredient: 'lot qty, lot qty' (all rows, receipts included).
create function pg_temp.buckets(p_ing text) returns text language sql as $$
  select string_agg(coalesce(pg_temp.name_of(s.raw_lot_id), 'unlotted') || ' ' || trim_scale(s.q)::text, ', ' order by coalesce(pg_temp.name_of(s.raw_lot_id), 'unlotted'))
    from (select raw_lot_id, sum(qty) q from public.stock_movement where ingredient_id = pg_temp.id(p_ing) group by raw_lot_id) s $$;
create function pg_temp.counts2() returns text language sql as $$
  select (select count(*) from public.batch_movement)::text || '/' || (select count(*) from public.stock_movement)::text $$;


create function pg_temp.seen(rel text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute format('select count(*) from public.%I', rel) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end
$$;
create function pg_temp.kt(p_nm text, p_who text) returns text language plpgsql as $$
declare
  v_j jsonb;
  state text;
  msg text;
begin
  perform pg_temp.claims(p_who);
  begin
    set local role authenticated;
    v_j := public.kitchen_tickets();
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
create function pg_temp.seen_as(p_who text, p_rel text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  perform pg_temp.claims(p_who);
  set local role authenticated;
  n := pg_temp.seen(p_rel);
  reset role;
  return n;
end
$$;
grant execute on function pg_temp.seen(text) to authenticated;
grant select on public.order_line_cost, public.batch_movement to authenticated;   -- already granted; kept explicit for the helper

select pg_temp.mkscn(1); select pg_temp.mkscn(2); select pg_temp.mkscn(3); select pg_temp.mkscn(4);
insert into reg values ('lb', 'e1000000-0000-4000-8000-0000000000b1');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by)
  values ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  values ('e1000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '14000000-0000-4000-8000-0000000000b1',
          '11000000-0000-4000-8000-0000000000b1', 'dolci', 1, 3, 22, 'menu', '2026-10-24 12:00+00', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
-- Two lines each for the three roles allowed to fire, and drafts for the refused ones
select pg_temp.mkline('fo', 'i1'); select pg_temp.mkline('fa', 'i2'); select pg_temp.mkline('fw', 'i3');
select pg_temp.mkline('dc', 'i4'); select pg_temp.mkline('db', 'i4');
create temporary table pre as select pg_temp.counts2() c, (select string_agg(state::text, ',' order by id) from public.order_line) s;

-- fire_course ------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.fire('o', 'owner', pg_temp.id('s1'), pg_temp.body('fo')), 'ok', 'fire_course: the owner is allowed');
select is(pg_temp.fire('a', 'admin', pg_temp.id('s1'), pg_temp.body('fa')), 'ok', 'fire_course: the admin is allowed');
select is(pg_temp.fire('w', 'waiter', pg_temp.id('s1'), pg_temp.body('fw')), 'ok', 'fire_course: the waiter is allowed');
create temporary table pre2 as select pg_temp.counts2() c, (select string_agg(state::text, ',' order by id) from public.order_line) s;
select is(pg_temp.fire('c', 'chef', pg_temp.id('s1'), pg_temp.body('dc')), '42501 permission denied: opening tables needs owner, admin or waiter', 'fire_course: the chef gets 42501');
select is(pg_temp.counts2() || ' ' || (select string_agg(state::text, ',' order by id) from public.order_line), (select c || ' ' || s from pre2), 'and nothing is written');
select set_config('request.jwt.claims', '', true);
create function pg_temp.fire_noclaims(p_session uuid, p_body jsonb) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  begin
    set local role authenticated;
    perform public.fire_course(p_session, p_body);
    reset role;
    return 'ok';
  exception when others then
    reset role;
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    return state || ' ' || msg;
  end;
end
$$;
select is(left(pg_temp.fire_noclaims(pg_temp.id('s1'), pg_temp.body('dc')), 5), '42501', 'fire_course: no claims is refused');
select is(pg_temp.fire('b', 'ownerb', pg_temp.id('s1'), pg_temp.body('dc')), 'P0002 session_not_found', 'fire_course: tenant B''s owner on A''s session: session_not_found');
select is(pg_temp.fire('b2', 'ownerb', pg_temp.id('sb'), pg_temp.body('dc')), 'P0002 line_not_found', 'fire_course: tenant B''s owner on his own session with A''s line: line_not_found');
select is(pg_temp.counts2() || ' ' || (select string_agg(state::text, ',' order by id) from public.order_line), (select c || ' ' || s from pre2), 'A''s rows are unchanged');

-- void_line --------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.void('vo', 'owner', pg_temp.id('fo'), pg_temp.vb('comp')), 'ok', 'void_line: the owner is allowed');
select is(pg_temp.void('va', 'admin', pg_temp.id('fa'), pg_temp.vb('comp')), 'ok', 'void_line: the admin is allowed');
select is(pg_temp.void('vw', 'waiter', pg_temp.id('fw'), pg_temp.vb('comp')), 'ok', 'void_line: the waiter is allowed');
select pg_temp.mkline('vc', 'i1');
select is(pg_temp.fire('fc', 'waiter', pg_temp.id('s1'), pg_temp.body('vc')), 'ok', 'a line to void (setup)');
create temporary table pre3 as select pg_temp.counts2() c, (select string_agg(state::text, ',' order by id) from public.order_line) s;
select is(pg_temp.void('vch', 'chef', pg_temp.id('vc'), pg_temp.vb('comp')), '42501 permission denied: opening tables needs owner, admin or waiter', 'void_line: the chef gets 42501');
select is(pg_temp.counts2() || ' ' || (select string_agg(state::text, ',' order by id) from public.order_line), (select c || ' ' || s from pre3), 'and nothing is written');
create function pg_temp.void_noclaims(p_line uuid, p_body jsonb) returns text language plpgsql as $$
declare
  state text;
begin
  begin
    set local role authenticated;
    perform public.void_line(p_line, p_body);
    reset role;
    return 'ok';
  exception when others then
    reset role;
    get stacked diagnostics state = returned_sqlstate;
    return state;
  end;
end
$$;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.void_noclaims(pg_temp.id('vc'), pg_temp.vb('comp')), '42501', 'void_line: no claims is refused');
select is(pg_temp.void('vb', 'ownerb', pg_temp.id('vc'), pg_temp.vb('comp')), 'P0002 line_not_found', 'void_line: tenant B''s owner on A''s line: line_not_found');
select is(pg_temp.counts2() || ' ' || (select string_agg(state::text, ',' order by id) from public.order_line), (select c || ' ' || s from pre3), 'A''s rows are unchanged');

-- kitchen_tickets --------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.kt('kc', 'chef'), 'ok', 'kitchen_tickets: the chef is allowed');
select is(pg_temp.kt('ko', 'owner'), 'ok', 'kitchen_tickets: the owner is allowed');
select is(pg_temp.kt('ka', 'admin'), 'ok', 'kitchen_tickets: the admin is allowed');
select is(pg_temp.kt('kw', 'waiter'), '42501 permission denied: the kitchen list needs owner, admin or chef', 'kitchen_tickets: the waiter gets 42501');
select is(pg_temp.kt('kn', 'ownerb'), 'ok', 'tenant B''s owner is allowed too (his own, empty list)');
select is(jsonb_array_length(pg_temp.j('kn') -> 'tickets'), 0, 'and sees none of A''s tickets');
select is(jsonb_array_length(pg_temp.j('kc') -> 'tickets') > 0, true, 'while the chef of A sees A''s fired lines');

-- AT9: what each role reads -----------------------------------------------------------------------------------------------------------------
select is((select count(*)::int > 0 from public.order_line_cost) and (select count(*)::int > 0 from public.batch_movement), true, 'rows exist in both tables (the checks below are not vacuous)');
select is(pg_temp.seen_as('waiter', 'order_line_cost'), 0::bigint, 'AT9: the waiter reads 0 order_line_cost rows');
select is(pg_temp.seen_as('waiter', 'batch_movement'), 0::bigint, 'AT9: the waiter reads 0 batch_movement rows');
select is(pg_temp.seen_as('chef', 'order_line_cost'), 0::bigint, 'the chef reads 0 order_line_cost rows (Q16 = V6)');
select is(pg_temp.seen_as('chef', 'batch_movement') > 0, true, 'the chef reads batch quantities');
select is(pg_temp.seen_as('owner', 'order_line_cost') > 0, true, 'the owner reads the costs');
select is(pg_temp.seen_as('admin', 'order_line_cost') > 0, true, 'the admin reads the costs');
select is(pg_temp.seen_as('ownerb', 'order_line_cost'), 0::bigint, 'tenant B''s owner reads none of A''s costs');

-- Grants ---------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['public.fire_course(uuid, jsonb)', 'public.void_line(uuid, jsonb)', 'public.kitchen_tickets()']) f
            where has_function_privilege('anon', f, 'execute')), 0, 'anon can execute none of the three');
select is((select count(*)::int from unnest(array['public.fire_course(uuid, jsonb)', 'public.void_line(uuid, jsonb)', 'public.kitchen_tickets()']) f
            where has_function_privilege('authenticated', f, 'execute')), 3, 'authenticated can execute all three');
select is((select count(*)::int from unnest(array['public.fire_course(uuid, jsonb)', 'public.void_line(uuid, jsonb)', 'public.kitchen_tickets()']) f
            where has_function_privilege('service_role', f, 'execute')), 0, 'service_role executes none');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('order_void_reason_codes', 'void_waste_reason', 'plate_raw_needs', 'fire_batch_targets', 'lock_fire_batches',
                          'deplete_line_batches', 'post_plate_raw_outflow', 'freeze_line_cost', 'batch_movement_reversal_guard',
                          'require_kitchen_reader', 'kitchen_ticket_rows')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
             or has_function_privilege('service_role', p.oid, 'execute')) $$,
  'no API role executes any M19 app.* function');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('order_void_reason_codes', 'void_waste_reason', 'plate_raw_needs', 'fire_batch_targets', 'lock_fire_batches',
                          'deplete_line_batches', 'post_plate_raw_outflow', 'freeze_line_cost', 'batch_movement_reversal_guard',
                          'require_kitchen_reader', 'kitchen_ticket_rows')), 11, 'all eleven exist (the list above is not vacuous)');
select is((select array_agg(p.proname::text order by p.proname::text collate "C") from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname ~* '(cost|margin|price)' and p.proname <> 'plate_margins_pct'),
  array['batch_costs', 'cost_settings', 'count_variance_costs', 'enter_fixed_costs', 'fixed_cost_status', 'ingredient_costs', 'plate_costs',
        'raw_waste_costs', 'recipe_cost_at', 'recipe_costs', 'set_ingredient_cost_basis', 'update_cost_settings', 'waste_costs'],
  'the cost-named public functions are still the 13 of 059 (M19 adds none)');

select * from finish();
rollback;
