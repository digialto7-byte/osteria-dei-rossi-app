-- M20 step 3 (docs/plans/2026-10-29-m20-offline.md §3.1.5, §5 step 3; ADR-017, ADR-019, ADR-022; AT4, AT5): the conflict rule through apply_op.
-- apply_op adds no rule of its own: irreversible states win whatever the stamp (a fired line, a voided line, a closed table, a table
-- already open), otherwise the later stamp wins per line, and the receipt time is stored beside the stamp. Waiter A is Cameriere Demo,
-- waiter B is Cameriere Due Demo. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);



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
create function pg_temp.lines() returns int language sql as $$ select count(*)::int from public.order_line $$;
create function pg_temp.ops() returns int language sql as $$ select count(*)::int from public.applied_op $$;
create function pg_temp.moves() returns int language sql as $$ select count(*)::int from public.batch_movement where type = 'consume' $$;
create function pg_temp.line_state(p_line uuid) returns text language sql as $$
  select state || '/' || coalesce(void_reason, '-') || '/' || trim_scale(qty)::text from public.order_line where id = p_line $$;
create function pg_temp.add_payload(p_session text, p_line uuid, p_item text, p_qty numeric default 1) returns jsonb language sql as $$
  select jsonb_build_object('sessionId', pg_temp.id(p_session), 'lineId', p_line, 'menuItemId', pg_temp.id(p_item), 'qty', p_qty) $$;

create temporary table o (k text primary key, op jsonb not null);
create function pg_temp.a_op(p_kind text, p_payload jsonb, p_ts text, p_seq int default 1, p_user text default 'waiter') returns jsonb language sql as $$
  select pg_temp.op(p_kind, p_payload, p_ts, p_seq, null,
    case p_user when 'waiter2' then 'd1000000-0000-4000-8000-0000000000d2' else 'd1000000-0000-4000-8000-00000000000d' end) $$;
-- A line added by apply_op (waiter A, stamp p_ago seconds back) on s1, qty 1.
create function pg_temp.addl(p_n int, p_item text, p_ago numeric, p_session text default 's1') returns void language sql as $$
  select pg_temp.quiet('addl' || p_n, 'waiter', pg_temp.a_op('add_line', pg_temp.add_payload(p_session, pg_temp.u(p_n), p_item), pg_temp.ts(p_ago))) $$;
create function pg_temp.edit(p_nm text, p_who text, p_line int, p_qty numeric, p_ts text) returns text language sql as $$
  select pg_temp.apply(p_nm, p_who, pg_temp.a_op('edit_line', jsonb_build_object('lineId', pg_temp.u(p_line), 'qty', p_qty), p_ts, 1, p_who)) $$;
create function pg_temp.stat(p_nm text) returns text language sql as $$
  select (pg_temp.r(p_nm) ->> 'status') || '/' || coalesce(pg_temp.r(p_nm) -> 'result' -> 'conflict' ->> 'reason', pg_temp.r(p_nm) -> 'result' ->> 'message', 'none') $$;

-- AT4: a fired line can only be voided ---------------------------------------------------------------------------------------------------
select pg_temp.addl(1, 'i1', 300);
select is(pg_temp.apply('fire1', 'waiter', pg_temp.a_op('fire', jsonb_build_object('sessionId', pg_temp.id('s1'), 'lineIds', jsonb_build_array(pg_temp.u(1))), pg_temp.ts(60))), 'ok', 'line 1 is fired by an applied fire op');
create temporary table snap (k text primary key, v text);
insert into snap select 'l1', (select qty::text || '/' || coalesce(note, '-') || '/' || client_updated_at::text || '/' || updated_by::text || '/' || state from public.order_line where id = pg_temp.u(1));
select is(pg_temp.edit('e_later', 'waiter', 1, 3, pg_temp.ts(-20)), 'ok', 'AT4: an edit with a clientTs LATER than the fire is answered');
select is(pg_temp.stat('e_later'), 'conflict/fired', 'AT4: conflict fired');
select is(pg_temp.edit('e_earlier', 'waiter', 1, 4, pg_temp.ts(200)), 'ok', 'an edit with a clientTs EARLIER than the fire is answered');
select is(pg_temp.stat('e_earlier'), 'conflict/fired', 'the same: conflict fired (the stamp does not matter)');
select is((select qty::text || '/' || coalesce(note, '-') || '/' || client_updated_at::text || '/' || updated_by::text || '/' || state from public.order_line where id = pg_temp.u(1)),
          (select v from snap where k = 'l1'), 'AT4: qty, note, stamp, updater and state are unchanged');
select is((select string_agg(a.outcome, ',' order by a.seq) from public.applied_op a where a.op_id in ((pg_temp.r('e_later') ->> 'opId')::uuid, (pg_temp.r('e_earlier') ->> 'opId')::uuid)),
          'conflict,conflict', 'both conflicts are stored');
select is(pg_temp.r('e_later') -> 'result' -> 'conflict' -> 'line' ->> 'state', 'fired', 'the conflict carries the server''s line (state fired)');

-- Other irreversible states ------------------------------------------------------------------------------------------------------------
select pg_temp.addl(2, 'i1', 200);
select pg_temp.quiet('void2', 'waiter', pg_temp.a_op('void_line', jsonb_build_object('lineId', pg_temp.u(2), 'reason', 'order_error'), pg_temp.ts(100)));
select is(pg_temp.apply('void2b', 'waiter', pg_temp.a_op('void_line', jsonb_build_object('lineId', pg_temp.u(2), 'reason', 'comp'), pg_temp.ts(-5))), 'ok', 'a void of a voided line with another reason is answered');
select is(pg_temp.stat('void2b'), 'conflict/voided', 'conflict voided');
select is((select void_reason from public.order_line where id = pg_temp.u(2)), 'order_error', 'the first reason stands');
select is(pg_temp.apply('edit2', 'waiter', pg_temp.a_op('edit_line', jsonb_build_object('lineId', pg_temp.u(2), 'qty', 2), pg_temp.ts(-5))), 'ok', 'an edit of a voided line is answered');
select is(pg_temp.stat('edit2'), 'conflict/voided', 'conflict voided too');

-- A closed table accepts nothing (the owner closes it: no procedure does yet)
select pg_temp.mkline('lc', 'i1', 1, 'secondi', 's3');
select is(pg_temp.apply('add_closed', 'waiter', pg_temp.a_op('add_line', pg_temp.add_payload('s3', pg_temp.u(40), 'i1'), pg_temp.ts(10))), 'ok', 'an add on a closed session is answered');
select is(pg_temp.stat('add_closed') || '/' || (pg_temp.r('add_closed') -> 'result' ->> 'sqlstate') || '/' || (pg_temp.r('add_closed') ->> 'stop'), 'conflict/session_closed/P0001/true', 'conflict {P0001, session_closed}, stop true on the add');
select is(pg_temp.apply('fire_closed', 'waiter', pg_temp.a_op('fire', jsonb_build_object('sessionId', pg_temp.id('s3'), 'lineIds', jsonb_build_array(pg_temp.id('lc'))), pg_temp.ts(10))), 'ok', 'a fire on a closed session is answered');
select is(pg_temp.stat('fire_closed') || '/' || (pg_temp.r('fire_closed') -> 'result' ->> 'sqlstate') || '/' || (pg_temp.r('fire_closed') ->> 'stop'), 'conflict/session_closed/P0001/false', 'conflict {P0001, session_closed}; a fire does not stop the batch');
select is((select state from public.order_line where id = pg_temp.id('lc')) || '/' || (select count(*)::int from public.order_line where id = pg_temp.u(40)), 'draft/0', 'nothing was written on the closed table');
select is(pg_temp.apply('edit_closed', 'waiter', pg_temp.a_op('edit_line', jsonb_build_object('lineId', pg_temp.id('lc'), 'qty', 2), pg_temp.ts(-5))), 'ok', 'an edit on a closed session is answered');
select is(pg_temp.stat('edit_closed'), 'conflict/session_closed', 'conflict session_closed (a result, not a raised error)');

-- An open table cannot be opened again
select is(pg_temp.apply('open_again', 'waiter', pg_temp.a_op('open_table', jsonb_build_object('tableId', '13000000-0000-4000-8000-000000000001', 'sessionId', pg_temp.u(41), 'covers', 2), pg_temp.ts(10))), 'ok', 'open_table on a table with an open session is answered');
select is(pg_temp.stat('open_again') || '/' || (pg_temp.r('open_again') ->> 'stop'), 'conflict/table_already_open/true', 'conflict table_already_open, stop true');
select is(pg_temp.r('open_again') -> 'result' -> 'detail' ->> 'sessionId', '14000000-0000-4000-8000-000000000001', 'its detail names the open session S1');
select is((select count(*)::int from public.table_session where id = pg_temp.u(41)), 0, 'no second session exists');

-- AT5 order 1: B (later stamp) arrives first, A (earlier stamp) second ---------------------------------------------------------------------
select pg_temp.addl(5, 'i1', 600);
select is(pg_temp.edit('b_first', 'waiter2', 5, 3, pg_temp.ts(30)), 'ok', 'AT5 order 1: waiter B''s edit (qty 3, t2 = 30 s ago) arrives first');
select is(pg_temp.stat('b_first'), 'applied/none', 'B is applied');
select is(pg_temp.edit('a_second', 'waiter', 5, 2, pg_temp.ts(60)), 'ok', 'then waiter A''s edit (qty 2, t1 = 60 s ago < t2) arrives');
select is(pg_temp.stat('a_second'), 'conflict/stale', 'A gets conflict stale');
select is(pg_temp.r('a_second') -> 'result' -> 'conflict' -> 'line' -> 'updatedBy' ->> 'id', 'd1000000-0000-4000-8000-0000000000d2', 'the conflict''s line shows waiter B as its updater');
select is(pg_temp.line_state(pg_temp.u(5)), 'draft/-/3', 'the line has qty 3 (the later stamp)');
select is((select (a.received_at > b.received_at and a.client_ts < b.client_ts)::text
             from public.applied_op a, public.applied_op b
            where a.op_id = (pg_temp.r('a_second') ->> 'opId')::uuid and b.op_id = (pg_temp.r('b_first') ->> 'opId')::uuid),
          'true', 'receipt time: A''s received_at is later than B''s while A''s client_ts is earlier (both stored)');
select is((select outcome from public.applied_op where op_id = (pg_temp.r('a_second') ->> 'opId')::uuid), 'conflict', 'A''s stale conflict is stored');

-- AT5 order 2: A (earlier stamp) arrives first, B second ------------------------------------------------------------------------------------
select pg_temp.addl(6, 'i1', 600);
select is(pg_temp.edit('a_first', 'waiter', 6, 2, pg_temp.ts(60)), 'ok', 'AT5 order 2: A''s edit (t1) arrives first');
select is(pg_temp.edit('b_second', 'waiter2', 6, 3, pg_temp.ts(30)), 'ok', 'then B''s edit (t2 > t1) arrives');
select is(pg_temp.stat('a_first') || ' ' || pg_temp.stat('b_second'), 'applied/none applied/none', 'both are applied');
select is(pg_temp.line_state(pg_temp.u(6)) || '/' || (select updated_by = 'd1000000-0000-4000-8000-0000000000d2' from public.order_line where id = pg_temp.u(6)), 'draft/-/3/true', 'the line has qty 3 and waiter B as updater');

-- Equal stamps -----------------------------------------------------------------------------------------------------------------------------
select pg_temp.addl(7, 'i1', 600);
create temporary table stamp7 (t text);
insert into stamp7 values (pg_temp.ts(40));
select is(pg_temp.edit('eq_a', 'waiter', 7, 2, (select t from stamp7)), 'ok', 'an edit at stamp T is applied');
select is(pg_temp.edit('eq_b', 'waiter2', 7, 5, (select t from stamp7)), 'ok', 'an edit by ANOTHER user at the same stamp T is answered');
select is(pg_temp.stat('eq_b'), 'conflict/stale', 'it is stale (an equal stamp from another user loses)');
select is(pg_temp.edit('eq_c', 'waiter', 7, 2, (select t from stamp7)), 'ok', 'the same content at the same stamp by the SAME user is answered');
select is(pg_temp.stat('eq_c') || '/' || (pg_temp.r('eq_c') -> 'result' ->> 'changed'), 'applied/none/false', 'it is applied with changed false (a no-op)');
select is(pg_temp.line_state(pg_temp.u(7)), 'draft/-/2', 'the line keeps qty 2');

-- No lower bound: a 30-minute-old queued edit is judged on its stamp -----------------------------------------------------------------------
select pg_temp.addl(8, 'i1', 2400);
select is(pg_temp.edit('old', 'waiter', 8, 2, pg_temp.ts(2100)), 'ok', 'an edit stamped 35 minutes ago on a line last stamped 40 minutes ago is answered');
select is(pg_temp.stat('old') || '/' || pg_temp.line_state(pg_temp.u(8)), 'applied/none/draft/-/2', 'it is applied (old stamps are accepted)');
select is(pg_temp.edit('older', 'waiter', 8, 3, pg_temp.ts(2300)), 'ok', 'an edit stamped 38 minutes ago (before the 35-minute one) is answered');
select is(pg_temp.stat('older'), 'conflict/stale', 'it is stale: old stamps are judged on their stamp, not refused');

select * from finish();
rollback;
