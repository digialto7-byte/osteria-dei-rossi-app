-- M20 step 7 (docs/plans/2026-10-29-m20-offline.md §3.2, §5 step 7): what M20 must not change, the M20 pins, and a performance net.
--  * applied_op joins app.demo_purge_tables() before order_line_cost and app_user (194 keeps the list honest; 193 purges real rows of it);
--  * the procedures apply_op dispatches to, and the helpers they use, are byte-identical to main 5277c12 (md5 of pg_get_functiondef with an
--    empty search_path, computed there); a milestone that changes one deliberately re-pins here. The M20 migrations must not even re-create
--    them: tests/config/m20-preserves.test.ts greps for it;
--  * the alert registry and both audit_event checks are unchanged (M20 adds no kind, entity type or action);
--  * the only new public table is applied_op and the only new public function is apply_op;
--  * under statement_timeout = 5 s, on the M19 perf fixture, apply_op of an add and of a 10-line fire answer.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);


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
create function pg_temp.lines() returns int language sql as $$ select count(*)::int from public.order_line $$;
create function pg_temp.ops() returns int language sql as $$ select count(*)::int from public.applied_op $$;
create function pg_temp.moves() returns int language sql as $$ select count(*)::int from public.batch_movement where type = 'consume' $$;
create function pg_temp.line_state(p_line uuid) returns text language sql as $$
  select state || '/' || coalesce(void_reason, '-') || '/' || trim_scale(qty)::text from public.order_line where id = p_line $$;
create function pg_temp.add_payload(p_session text, p_line uuid, p_item text, p_qty numeric default 1) returns jsonb language sql as $$
  select jsonb_build_object('sessionId', pg_temp.id(p_session), 'lineId', p_line, 'menuItemId', pg_temp.id(p_item), 'qty', p_qty) $$;

select pg_temp.mkscn(1);   -- the plate, 5 batches (2 live), polenta and pane lots
-- 2 000 historical batches of the stew key: a third finished, a third discarded, a third expired but still 'fresh'
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
    output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
  select gen_random_uuid(), '11111111-1111-4111-8111-111111111111', pg_temp.id('s1key'), pg_temp.id('s1rec'), 1,
         to_char(date '2020-01-01' + n / 100, 'YYMMDD') || '-HIST-' || (n % 100 + 1), date '2020-01-01' + n / 100, 'HIST', n % 100 + 1,
         timestamptz '2020-01-01 08:00+00' + (n / 100) * interval '1 day', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 10, 10, 24,
         timestamptz '2020-01-01 08:00+00' + (n / 100) * interval '1 day' + interval '24 hours',
         (array['finished', 'discarded', 'fresh'])[n % 3 + 1]::public.batch_state, '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(0, 1999) n;
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  select tenant_id, id, 'produce', 10, 'batch', id, '2020-01-01', created_by from public.batch where lot_recipe_code = 'HIST';
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
  select tenant_id, id, 'waste', -10, 'spoilage', 'batch_discard', gen_random_uuid(), '2020-01-01', created_by from public.batch where lot_recipe_code = 'HIST' and state = 'discarded';
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  select tenant_id, id, 'count', -10, 'batch_adjust', gen_random_uuid(), '2020-01-01', created_by from public.batch where lot_recipe_code = 'HIST' and state = 'finished';
-- 60 polenta lots over two locations
select pg_temp.mk_lot('hp' || n, 'pol1', case when n % 2 = 0 then 'cella' else 'disp' end, 20 + n, 1) from generate_series(1, 60) n;
-- 30 tables, 30 sessions, 300 draft lines
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo P' || n || ' (demo)', 100 + n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 30) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('13000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'Tavolo P' || n || ' (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', current_date,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 30) n;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  select gen_random_uuid(), '11111111-1111-4111-8111-111111111111', ('14000000-0000-4000-8000-0000000001' || lpad((n % 30 + 1)::text, 2, '0'))::uuid, pg_temp.id('i1'),
         'secondi', 1, 14, 10, 'menu', '2026-10-24 12:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d' from generate_series(1, 300) n;
-- 300 lines fired today and 5 000 fired in the last 40 days (fixtures: no movement, only what the ticket read looks at)
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select gen_random_uuid(), '11111111-1111-4111-8111-111111111111', ('14000000-0000-4000-8000-0000000001' || lpad((n % 30 + 1)::text, 2, '0'))::uuid, pg_temp.id('i1'),
         'secondi', 1, 14, 10, 'menu', '2026-10-24 12:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
         clock_timestamp() - (n % 60) * interval '1 second' - interval '2 minutes', 'd1000000-0000-4000-8000-00000000000d' from generate_series(1, 300) n;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select gen_random_uuid(), '11111111-1111-4111-8111-111111111111', ('14000000-0000-4000-8000-0000000001' || lpad((n % 30 + 1)::text, 2, '0'))::uuid, pg_temp.id('i1'),
         'secondi', 1, 14, 10, 'menu', '2026-10-24 12:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
         now() - interval '36 hours' - n * interval '10 minutes', 'd1000000-0000-4000-8000-00000000000d' from generate_series(1, 5000) n;
analyze public.batch; analyze public.order_line; analyze public.batch_movement; analyze public.stock_movement;
select is((select count(*)::int from public.batch), 2005, 'the fixture: 2 000 historical batches and the 5 of the scenario');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('i1'), 14, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a');

-- Demo purge list ---------------------------------------------------------------------------------------------------------------------
select ok(array_position(app.demo_purge_tables(), 'applied_op') < array_position(app.demo_purge_tables(), 'order_line_cost'), 'applied_op comes before order_line_cost in the purge list');
select ok(array_position(app.demo_purge_tables(), 'applied_op') < array_position(app.demo_purge_tables(), 'app_user'), 'and before app_user (its foreign key)');
select is((select count(*)::int from unnest(app.demo_purge_tables()) n where n = 'applied_op'), 1, 'and is listed once');
select is(app.demo_tenant_counts('00000000-0000-0000-0000-000000000000') ? 'applied_op', true, 'demo_tenant_counts counts it');

-- Pinned definitions ------------------------------------------------------------------------------------------------------------------
set local search_path = '';
create temp table pin_md5 on commit drop as
select p.k, p.sig, p.want, md5(pg_get_functiondef(p.sig::regprocedure)) as got
  from (values
  ('add_order_line', 'public.add_order_line(uuid,jsonb)', '23fdd6661c0658186f3712129f5c58d2')
  , ('append_only', 'app.append_only()', 'f52936446bf9d47e9597b4dd4ae5bcb8')
  , ('append_only_truncate', 'app.append_only_truncate()', 'f7593af2e086f990cc614a938a3480c9')
  , ('fire_course', 'public.fire_course(uuid,jsonb)', '03a53c26d8e86ff418c020bc700d18d9')
  , ('menu_keys_ok', 'app.menu_keys_ok(jsonb,text[],text[])', '91654d6713e804bd3be34b5c7325a508')
  , ('open_table', 'public.open_table(uuid,uuid,integer)', '67ba4ca64814c325762596300e8a5c63')
  , ('order_line_guard', 'app.order_line_guard()', '4a3b7e7dd2488e7ad5dbf0d15178bf38')
  , ('order_line_json', 'app.order_line_json(public.order_line)', 'ca3817ad015b0176d52614e037dbb31d')
  , ('order_view', 'public.order_view(uuid)', '5678c095d50f989c42357f86c34793a6')
  , ('parse_client_time', 'app.parse_client_time(jsonb)', '19ed81946726591284cc57fcb446a098')
  , ('remove_order_line', 'public.remove_order_line(uuid,jsonb)', 'd6c44c8d39bb757783ee8d0fd6077a9f')
  , ('table_session_get', 'public.table_session_get(uuid)', '6f000ffc49a734317b5e4ae7d0fff19e')
  , ('update_order_line', 'public.update_order_line(uuid,jsonb)', '4f3ca23557c88533eb4478fceb343b41')
  , ('void_line', 'public.void_line(uuid,jsonb)', 'd1c3cfff8a2b7a38baad22ef5fa1260d')
  ) p (k, sig, want);
set local search_path = "$user", public, extensions;
select is((select count(*)::int from pin_md5), 14, 'fourteen functions are pinned');
select is_empty($$ select k from pin_md5 where got <> want $$,
  'every pinned function still has its main 5277c12 definition: open_table, add/update/remove_order_line, fire_course, void_line, order_view, table_session_get, parse_client_time, order_line_json, order_line_guard, menu_keys_ok and the two append-only guards');
select is((select got from pin_md5 where k = 'fire_course'), '03a53c26d8e86ff418c020bc700d18d9', 'public.fire_course is the 20261106100700 definition (md5)');
select is((select got from pin_md5 where k = 'parse_client_time'), '19ed81946726591284cc57fcb446a098', 'app.parse_client_time keeps no lower bound (md5)');

-- Registry and checks -----------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still has 15 kinds (M20 adds none)');
select is((select md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '09b9c6302f3c9c7c4265a70f73212d40', 'and every row is the one on 5277c12 (md5)');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.audit_event'::regclass and conname = 'audit_event_entity_type_check'),
          '32f535da0c689f7fa047ecd84e9ab13f', 'audit_event_entity_type_check is unchanged');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.audit_event'::regclass and conname = 'audit_event_action_check'),
          'e34afece68d41c1a99baf21f7d0a51b0', 'audit_event_action_check is unchanged');

-- New objects ---------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(tablename::text, ',' order by tablename::text collate "C") from pg_tables where schemaname = 'public'),
          'alert,app_user,applied_op,audit_event,auth_attempt,batch,batch_cost,batch_input,batch_movement,cost_centre,count_line,count_session,day_close,device_enrolment,dining_table,fixed_cost_period,ingredient,ingredient_cost_basis,invoice,invoice_duplicate_decision,invoice_line,location,menu_item,menu_item_price,order_line,order_line_cost,payable,price_history,raw_lot,recipe,recipe_key,recipe_line,recipe_price,sale_settings,staff_meal_confirmation,staff_meal_rule,staff_session,stock_movement,supplier,supplier_item,table_session,tenant,venue_device',
          'the public tables are those of main plus applied_op (M21 adds day_close: list updated in M21 step 1)');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc
            where pronamespace = 'public'::regnamespace and proname ~* '(cost|margin|price)'),
          'batch_costs,cost_settings,count_variance_costs,enter_fixed_costs,fixed_cost_status,ingredient_costs,plate_costs,plate_margins_pct,raw_waste_costs,recipe_cost_at,recipe_costs,set_ingredient_cost_basis,update_cost_settings,waste_costs',
          'the cost-named public functions are unchanged');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname like 'apply%'),
          'apply_op', 'M20 adds exactly one public function');

-- Performance net (a regression net, not a latency claim) --------------------------------------------------------------------------
insert into reg select 'p' || row_number() over (order by id), id from (select id from public.order_line
  where table_session_id = '14000000-0000-4000-8000-000000000102' and fired_at is null order by id limit 10) x;
set local statement_timeout = '5s';
select is(pg_temp.apply('perf_add', 'waiter', pg_temp.op('add_line', pg_temp.add_payload('s1', pg_temp.u(900), 'i1'), pg_temp.ts(5), 1)), 'ok', 'apply_op of an add answers under a 5 s statement limit on the big fixture');
select is(pg_temp.r('perf_add') ->> 'status', 'applied', 'and applies it');
select is(pg_temp.apply('perf_fire', 'waiter', pg_temp.op('fire', jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000102',
          'lineIds', (select jsonb_agg(pg_temp.id('p' || n) order by n) from generate_series(1, 10) n)), pg_temp.ts(), 2)), 'ok', 'apply_op of a 10-line fire answers under the limit');
select is(jsonb_array_length(pg_temp.r('perf_fire') -> 'result' -> 'fired'), 10, 'and fires all ten');
reset statement_timeout;

select * from finish();
rollback;
