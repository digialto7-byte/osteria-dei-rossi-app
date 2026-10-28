-- M19 step 2: the fire helpers in schema app (M19 plan §3.1.3-3.1.7, §3.2; ADR-019): void reasons, raw needs of a plate,
-- batch targets and locks, FEFO depletion with a recorded shortage, cross-location raw outflow and the frozen cost.
-- Helpers run as the migration owner with an explicit tenant, user and instant. Defaults are tested with at least two
-- candidates (lesson 1): two live batches plus an expired, a finished and a discarded one; two locations plus an inactive
-- one; two plate versions; two tenants. Dates are relative to now(), so the test does not rot. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(76);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name, is_active) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)', true),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)', true),
  ('10000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Magazzino chiuso (demo)', false),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)', false);
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222', 'Fornitore B Demo', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e2000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/e2000000-0000-4000-8000-0000000000e2.pdf',
   'application/pdf', 2048, 'review', '5b000000-0000-4000-8000-00000000005b');

-- Registry of fixture ids by key ------------------------------------------------------------------------------------
create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1'), ('disp', '10000000-0000-4000-8000-0000000000a2'),
  ('chiuso', '10000000-0000-4000-8000-0000000000a3'), ('cellab', '10000000-0000-4000-8000-0000000000b1');
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

-- Ingredients, lots and prices (the M12 fixture pattern) -------------------------------------------------------------
create sequence pg_temp.line_seq;
create function pg_temp.new_line(p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, p_tenant,
      case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'e1000000-0000-4000-8000-0000000000e1'
           else 'e2000000-0000-4000-8000-0000000000e2' end::uuid,
      v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  return v_line;
end
$$;
create function pg_temp.mk_ing(p_k text, p_unit text default 'kg', p_stock boolean default true,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock)
    values (pg_temp.id(p_k), p_tenant, p_k || ' (demo)', p_unit::public.base_unit, p_stock);
end
$$;
-- A lot with its receipt at a location; the expiry is relative to today (days).
create function pg_temp.mk_lot(p_key text, p_ing text, p_loc text, p_expiry_days int, p_qty numeric)
  returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
      expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    select v_lot, '11111111-1111-4111-8111-111111111111', i.id, pg_temp.id(p_loc),
           '5a000000-0000-4000-8000-00000000005a', v_line, upper(p_key), current_date + p_expiry_days,
           current_date - 5, p_qty, i.base_unit, p_qty, i.base_unit::text, 1, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
      ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, pg_temp.id(p_loc), 'receipt', p_qty, 10,
      'invoice_line', v_line, current_date - 5, now() - interval '5 days', 'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.buy(p_ing text, p_price numeric) returns void language sql as $$
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
      effective_on, created_by)
    select '11111111-1111-4111-8111-111111111111', i.id, '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(),
           p_price, i.base_unit, current_date - 10, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing)
$$;
-- A movement of an ingredient at a location with an explicit age (hours ago), to steer "the latest movement".
create function pg_temp.mv(p_ing text, p_loc text, p_lot text, p_type text, p_qty numeric, p_hours_ago int)
  returns void language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
      reason_code, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), case when p_lot is null then null else pg_temp.id(p_lot) end,
      pg_temp.id(p_loc), p_type::public.stock_movement_type, p_qty, null,
      case when p_type = 'waste' then 'spoilage' end,
      case p_type when 'count' then 'count_session' else 'test_setup' end, gen_random_uuid(), current_date,
      now() - make_interval(hours => p_hours_ago), 'a1000000-0000-4000-8000-00000000000a')
$$;

insert into reg values ('polenta', gen_random_uuid()), ('pane', gen_random_uuid()), ('sale', gen_random_uuid()),
  ('pomodoro', gen_random_uuid());
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  (pg_temp.id('polenta'), '11111111-1111-4111-8111-111111111111', 'Polenta (demo)', 'kg', true),
  (pg_temp.id('pane'), '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'kg', true),
  (pg_temp.id('sale'), '11111111-1111-4111-8111-111111111111', 'Sale (demo)', 'kg', false),
  (pg_temp.id('pomodoro'), '11111111-1111-4111-8111-111111111111', 'Pomodoro (demo)', 'kg', true);

-- Batch sets: one recipe key per scenario with up to five batches ------------------------------------------------------
-- A live (use_by tomorrow), B live (use_by in two days), C expired (fresh state, past use_by), D finished (0 left,
-- newest non-discarded), E discarded (newer than D). produced_at is truncated to the hour so use_by - produced_at is a
-- whole number of hours (batch_use_by_ck).
create sequence pg_temp.batch_seq;
create function pg_temp.mkb(p_set int, p_letter text, p_state text, p_prod_h int, p_shelf int, p_left numeric,
    p_initial int default 10) returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_seq int := nextval('pg_temp.batch_seq');
  v_prod timestamptz := date_trunc('hour', now()) + make_interval(hours => p_prod_h);
begin
  insert into reg values ('s' || p_set || p_letter, v_id);
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, state, location_id, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', pg_temp.id('s' || p_set || 'key'),
      pg_temp.id('s' || p_set || 'rec'), 1, '261023-LOT-' || v_seq, '2026-10-23', 'LOT', v_seq, v_prod,
      'a1000000-0000-4000-8000-00000000000a', 2, 'kg', p_initial, p_initial, p_shelf,
      v_prod + make_interval(hours => p_shelf), p_state::public.batch_state,
      case when p_letter in ('B', 'E') then pg_temp.id('disp') else pg_temp.id('cella') end,
      'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', p_initial, 'batch', v_id, '2026-10-23',
      'a1000000-0000-4000-8000-00000000000a');
  if p_left < p_initial then
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
      values ('11111111-1111-4111-8111-111111111111', v_id, 'count', p_left - p_initial, 'batch_adjust',
        gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
  end if;
end
$$;
-- The recipe key (type batch) of a set, without batches.
create function pg_temp.mkkey(p_set int) returns void language plpgsql as $$
begin
  insert into reg values ('s' || p_set || 'key', gen_random_uuid()), ('s' || p_set || 'rec', gen_random_uuid());
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
    values (pg_temp.id('s' || p_set || 'key'), '11111111-1111-4111-8111-111111111111', 'batch', 1,
      'spezzatino set ' || p_set || ' (demo)', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
      portions_per_batch, shelf_life_hours, created_by)
    values (pg_temp.id('s' || p_set || 'rec'), '11111111-1111-4111-8111-111111111111', pg_temp.id('s' || p_set || 'key'),
      1, '2026-10-01T00:00Z', 'Spezzatino set ' || p_set || ' (demo)', 6, 'kg', 30, 72,
      'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- The standard set: A (live, a_left left), B (live, b_left left), C expired 5, D finished 0, E discarded.
create function pg_temp.mkset(p_set int, p_a numeric default 2, p_b numeric default 5) returns void language plpgsql as $$
begin
  perform pg_temp.mkkey(p_set);
  perform pg_temp.mkb(p_set, 'C', 'fresh', -120, 100, 5);   -- expired 20 h ago
  perform pg_temp.mkb(p_set, 'A', 'fresh', -48, 72, p_a);   -- use_by +24 h
  perform pg_temp.mkb(p_set, 'B', 'fresh', -24, 72, p_b);   -- use_by +48 h
  perform pg_temp.mkb(p_set, 'D', 'finished', -12, 96, 0, 2); -- newest non-discarded
  perform pg_temp.mkb(p_set, 'E', 'discarded', -6, 96, 4, 4);  -- newer than D
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on,
      created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id('s' || p_set || 'E'), 'waste', -4, 'spoilage',
      'batch_discard', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.bal(p_k text) returns numeric language sql as $$
  select trim_scale(app.batch_remaining('11111111-1111-4111-8111-111111111111', pg_temp.id(p_k)))
$$;
create function pg_temp.st(p_k text) returns text language sql as $$
  select state::text from public.batch where id = pg_temp.id(p_k)
$$;

-- One call of the depletion; rows are collected first and read back by a LATER statement.
create temporary table lastdep (ord bigserial, batch_id uuid, movement_id uuid, portions numeric, shortage boolean);
create function pg_temp.dep(p_set int, p_portions numeric, p_line uuid default gen_random_uuid()) returns void
  language plpgsql as $$
begin
  truncate lastdep;
  insert into lastdep (batch_id, movement_id, portions, shortage)
    select d.batch_id, d.movement_id, d.portions, d.shortage
      from app.deplete_line_batches('11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d',
        p_line, pg_temp.id('s' || p_set || 'key'), p_portions, now()) d;
end
$$;
create function pg_temp.dep_s() returns text language sql as $$
  select coalesce(string_agg(coalesce(pg_temp.name_of(d.batch_id), 'none') || ' ' || trim_scale(d.portions)::text
           || case when d.shortage then ' short' else '' end, ', ' order by d.ord), 'no rows')
    from lastdep d
$$;
-- Per-batch net consumption of a set as 'A=-2 B=-8'.
create function pg_temp.consumed(p_set int) returns text language sql as $$
  select coalesce(string_agg(substr(pg_temp.name_of(m.batch_id), length('s' || p_set) + 1) || '=' || trim_scale(m.s)::text,
           ' ' order by pg_temp.name_of(m.batch_id) collate "C"), '-')
    from (select batch_id, sum(portions) s from public.batch_movement
           where type = 'consume' and batch_id in (select id from reg where k ~ ('^s' || p_set || '[A-F]$'))
           group by batch_id) m
$$;
create function pg_temp.alerts(p_set int) returns bigint language sql as $$
  select count(*) from public.alert where kind = 'negative_stock' and entity_type = 'recipe_key'
     and entity_id = pg_temp.id('s' || p_set || 'key')
$$;

-- Raw outflow of the plate helper, same collect-then-read pattern.
create temporary table lastraw (ord bigserial, movement_id uuid, location_id uuid, raw_lot_id uuid, qty numeric);
create function pg_temp.raw(p_ing text, p_qty numeric, p_line uuid default gen_random_uuid(),
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
begin
  truncate lastraw;
  insert into lastraw (movement_id, location_id, raw_lot_id, qty)
    select r.movement_id, r.location_id, r.raw_lot_id, r.qty
      from app.post_plate_raw_outflow(p_tenant, 'a1000000-0000-4000-8000-00000000000a', pg_temp.id(p_ing), p_qty,
        p_line, now()) r;
end
$$;
create function pg_temp.raw_s() returns text language sql as $$
  select coalesce(string_agg(coalesce(pg_temp.name_of(r.raw_lot_id), 'unlotted') || '@' || coalesce(pg_temp.name_of(r.location_id), '?')
           || ' ' || trim_scale(r.qty)::text, ', ' order by r.ord), 'no rows')
    from lastraw r
$$;

-- Plates and sub-recipes -------------------------------------------------------------------------------------------
select pg_temp.mkset(0);   -- the targets / needs set; its key is the stew batch key of plate P
insert into reg values ('plate_p', gen_random_uuid()), ('p_v1', gen_random_uuid()), ('p_v2', gen_random_uuid()),
  ('salsa', gen_random_uuid()), ('salsa_v1', gen_random_uuid()), ('plate_x', gen_random_uuid()), ('x_v1', gen_random_uuid()),
  ('sub2', gen_random_uuid()), ('sub2_v1', gen_random_uuid());
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  (pg_temp.id('plate_p'), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.id('salsa'), '11111111-1111-4111-8111-111111111111', 'sub', 1, 'salsa (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.id('plate_x'), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto doppio (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.id('sub2'), '11111111-1111-4111-8111-111111111111', 'sub', 1, 'impasto (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  (pg_temp.id('p_v1'), '11111111-1111-4111-8111-111111111111', pg_temp.id('plate_p'), 1, '2026-10-01T00:00Z', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.id('x_v1'), '11111111-1111-4111-8111-111111111111', pg_temp.id('plate_x'), 1, '2026-10-01T00:00Z', 'Piatto doppio (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by) values
  (pg_temp.id('salsa_v1'), '11111111-1111-4111-8111-111111111111', pg_temp.id('salsa'), 1, '2026-10-01T00:00Z', 'Salsa (demo)', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.id('sub2_v1'), '11111111-1111-4111-8111-111111111111', pg_temp.id('sub2'), 1, '2026-10-01T00:00Z', 'Impasto (demo)', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a');
-- Plate P v1: 100 g polenta. v2 (current): 1 porz stew + 150 g polenta + 50 g pane (yield 0,5) + 100 g Salsa (1 kg = 0,5 kg pomodoro).
update public.recipe_key set current_version = 2 where id = pg_temp.id('plate_p');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  (pg_temp.id('p_v2'), '11111111-1111-4111-8111-111111111111', pg_temp.id('plate_p'), 2, '2026-10-02T00:00Z', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('p_v1'), 1, pg_temp.id('polenta'), null, 100, 'g', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('p_v2'), 1, null, pg_temp.id('s0key'), 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('p_v2'), 2, pg_temp.id('polenta'), null, 150, 'g', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('p_v2'), 3, pg_temp.id('pane'), null, 50, 'g', 0.5, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('p_v2'), 4, null, pg_temp.id('salsa'), 100, 'g', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('salsa_v1'), 1, pg_temp.id('pomodoro'), null, 0.5, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  -- Plate X: polenta on two paths, 100 g direct + 500 g of a sub (1 kg holds 200 g polenta) = 0,2 kg.
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('x_v1'), 1, pg_temp.id('polenta'), null, 100, 'g', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('x_v1'), 2, null, pg_temp.id('sub2'), 500, 'g', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('sub2_v1'), 1, pg_temp.id('polenta'), null, 200, 'g', 1, 'a1000000-0000-4000-8000-00000000000a');

-- Void reasons ----------------------------------------------------------------------------------------------------------
select is(app.order_void_reason_codes(),
  array['order_error', 'customer_changed', 'kitchen_error', 'returned', 'comp', 'breakage'],
  'the six void reasons, in order');
select is((select provolatile from pg_proc where oid = 'app.order_void_reason_codes()'::regprocedure), 'i'::"char",
  'order_void_reason_codes is immutable');
select is(
  (select string_agg(r || '=' || coalesce(app.void_waste_reason(r), 'null'), ' ' order by o)
     from unnest(app.order_void_reason_codes()) with ordinality u (r, o)),
  'order_error=plating_error customer_changed=over_production kitchen_error=plating_error returned=plating_error comp=comp breakage=breakage',
  'void_waste_reason maps each reason as the plan table says');
select is_empty(
  $$ select app.void_waste_reason(r) from unnest(app.order_void_reason_codes()) r
      where app.void_waste_reason(r) <> all (app.batch_waste_reason_codes())
         or app.void_waste_reason(r) <> all (app.stock_reason_codes()) $$,
  'every mapped waste code is in both batch_waste_reason_codes() and stock_reason_codes()');
select is(app.void_waste_reason('entry_removed'), null, 'entry_removed maps to nothing');
select is(app.void_waste_reason('x'), null, 'an unknown reason maps to nothing');
select is(app.void_waste_reason(null), null, 'null maps to nothing');

-- plate_raw_needs ---------------------------------------------------------------------------------------------------------
create function pg_temp.needs(p_recipe text) returns text language sql as $$
  select coalesce(string_agg(pg_temp.name_of(n.ingredient_id) || '=' || trim_scale(n.need)::text, ' ' order by pg_temp.name_of(n.ingredient_id) collate "C"), 'none')
    from app.plate_raw_needs('11111111-1111-4111-8111-111111111111', pg_temp.id(p_recipe)) n
$$;
select is(pg_temp.needs('p_v1'), 'polenta=0.1', 'plate v1 asked for its own id: 100 g polenta');
select is(pg_temp.needs('p_v2'), 'pane=0.1 polenta=0.15 pomodoro=0.05',
  'plate v2: polenta 0,15, pane 0,1 (yield 0,5), pomodoro 0,05 through the sub; the stew batch is absent');
select is(pg_temp.needs('x_v1'), 'polenta=0.2', 'polenta on two paths (direct and through a sub) is summed');
select is(pg_temp.err($$ select * from app.plate_raw_needs('11111111-1111-4111-8111-111111111111', gen_random_uuid()) $$),
  'P0002 recipe_not_found', 'an unknown recipe is P0002');
select is(pg_temp.err($$ select * from app.plate_raw_needs('22222222-2222-4222-8222-222222222222', pg_temp.id('p_v2')) $$),
  'P0002 recipe_not_found', 'a recipe of another tenant is P0002');

-- A chain of subs: a plate and n nested subs (each 1 kg holding 1 kg of the next, the last holds polenta).
create function pg_temp.mkchain(p_n int, p_tag text) returns uuid language plpgsql as $$
declare
  v_prev uuid;
  v_key uuid;
  v_rec uuid;
  v_plate uuid := gen_random_uuid();
  i int;
begin
  for i in reverse p_n..1 loop
    v_key := gen_random_uuid(); v_rec := gen_random_uuid();
    insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
      values (v_key, '11111111-1111-4111-8111-111111111111', 'sub', 1, 'catena ' || p_tag || ' ' || i, 'a1000000-0000-4000-8000-00000000000a');
    insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by)
      values (v_rec, '11111111-1111-4111-8111-111111111111', v_key, 1, '2026-10-01T00:00Z', 'Catena ' || i, 1, 'kg', 'a1000000-0000-4000-8000-00000000000a');
    if v_prev is null then
      insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, yield_factor, created_by)
        values ('11111111-1111-4111-8111-111111111111', v_rec, 1, pg_temp.id('polenta'), 1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
    else
      insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by)
        values ('11111111-1111-4111-8111-111111111111', v_rec, 1, v_prev, 1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
    end if;
    v_prev := v_key;
  end loop;
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
    values (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto catena ' || p_tag, 'a1000000-0000-4000-8000-00000000000a')
    returning id into v_key;
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
    values (v_plate, '11111111-1111-4111-8111-111111111111', v_key, 1, '2026-10-01T00:00Z', 'Piatto catena ' || p_tag, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_plate, 1, v_prev, 1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
  return v_plate;
end
$$;
insert into reg values ('chain11', pg_temp.mkchain(11, 'a')), ('chain12', pg_temp.mkchain(12, 'b'));
select is((select trim_scale(need)::text from app.plate_raw_needs('11111111-1111-4111-8111-111111111111', pg_temp.id('chain11'))),
  '1', 'a plate with 11 nested subs (depth 12) is still expanded');
select is(pg_temp.err($$ select * from app.plate_raw_needs('11111111-1111-4111-8111-111111111111', pg_temp.id('chain12')) $$),
  'P0001 recipe_not_producible', 'a plate with 12 nested subs (depth 13) fails closed');

-- Targets and locks: A, B live; C expired; D finished (the fallback); E discarded (newer than D) --------------------------
select is(
  (select string_agg(substr(pg_temp.name_of(t.batch_id), 3), ' ' order by pg_temp.name_of(t.batch_id) collate "C")
     from app.fire_batch_targets('11111111-1111-4111-8111-111111111111', array[pg_temp.id('s0key')]) t),
  'A B D', 'targets are the live batches A and B plus the fallback D (a non-discarded batch wins over the newer discarded E; C expired is not live)');
select is((select count(*)::int from app.fire_batch_targets('11111111-1111-4111-8111-111111111111', array[pg_temp.id('s0key')])),
  3, 'three targets');
select is(app.lock_fire_batches('11111111-1111-4111-8111-111111111111', array[pg_temp.id('s0key')]), 3,
  'lock_fire_batches locks and returns 3 rows');
select is(app.lock_fire_batches('22222222-2222-4222-8222-222222222222', array[pg_temp.id('s0key')]), 0,
  'another tenant locks nothing');
select is(app.lock_fire_batches('11111111-1111-4111-8111-111111111111', array[gen_random_uuid()]), 0,
  'a key with no batch locks nothing');

-- Depletion (AT1, AT2, AT4) -------------------------------------------------------------------------------------------------
select pg_temp.mkset(1);
select pg_temp.dep(1, 1);
select is(pg_temp.dep_s(), 's1A 1', 'AT1: one portion comes from A, the batch that expires first');
select pg_temp.mkset(2);
select pg_temp.dep(2, 0.5);
select is(pg_temp.consumed(2), 'A=-0.5', 'AT2a: half a portion takes 0,5 from A');
select is(pg_temp.consumed(1), 'A=-1', 'AT1: A -1, B untouched');
select is(pg_temp.bal('s1B'), 5::numeric, 'AT1: B keeps its 5');
select is(pg_temp.st('s1A'), 'open', 'A is settled open after the consume (remaining 1)');
select is((select ref_type || ' ' || coalesce(reason_code, '-') || ' ' || effective_on::text from public.batch_movement
            where batch_id = pg_temp.id('s1A') and type = 'consume'),
  'order_line - ' || app.venue_date(now(), 'Europe/Rome')::text, 'the consume row: ref order_line, no reason, effective on the venue date');
select pg_temp.mkset(3, 1, 5);
select pg_temp.dep(3, 2);
select is(pg_temp.consumed(3), 'A=-1 B=-1', 'AT2b: two portions with A at 1 take A -1 and B -1');
select is(pg_temp.st('s3A') || ' ' || pg_temp.st('s3B'), 'finished open', 'A is finished, B is open');

-- AT4: ten portions, 7 live: a shortage of 3 on the last live batch drained
select pg_temp.mkset(4);
select pg_temp.dep(4, 10, 'e4000000-0000-4000-8000-000000000001');
select is(pg_temp.consumed(4), 'A=-2 B=-8', 'AT4: A -2, B -8 (5 live plus the shortage of 3)');
select is(pg_temp.bal('s4B') || ' ' || pg_temp.st('s4B'), '-3 finished', 'AT4: B goes to -3 and is finished');
select is((select count(*)::int from lastdep where shortage), 1, 'AT4: one shortage row');
select is((select pg_temp.name_of(batch_id) from lastdep where shortage), 's4B', 'the shortage row names the target batch B');
select is(pg_temp.alerts(4), 1::bigint, 'AT4: one negative_stock alert for the recipe key');
select is((select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(payload) k) from public.alert
            where kind = 'negative_stock' and entity_type = 'recipe_key' and entity_id = pg_temp.id('s4key')),
  'batch_id,movement_id,order_line_id,recipe_key,remaining_portions_qty,short_portions_qty',
  'the alert payload has exactly the six keys');
select is((select payload ->> 'short_portions_qty' || ' ' || (payload ->> 'remaining_portions_qty') || ' ' || (payload ->> 'batch_id')
            from public.alert where kind = 'negative_stock' and entity_id = pg_temp.id('s4key')),
  '3 -3 ' || pg_temp.id('s4B')::text, 'short 3, balance of the target -3, the target batch id');
select is((select payload ->> 'order_line_id' from public.alert where kind = 'negative_stock' and entity_id = pg_temp.id('s4key')),
  'e4000000-0000-4000-8000-000000000001', 'the alert names the order line');
select ok((select app.chef_payload_allowed(payload) from public.alert where kind = 'negative_stock' and entity_id = pg_temp.id('s4key')),
  'the payload passes chef_payload_allowed');
select is((select audience_roles::text from public.alert where kind = 'negative_stock' and entity_id = pg_temp.id('s4key')),
  '{owner,chef}', 'the audience is owner and chef');
select pg_temp.dep(4, 1);
select is(pg_temp.alerts(4), 1::bigint, 'a second shortage the same Rome day still leaves one alert');
select is(pg_temp.consumed(4), 'A=-2 B=-8 D=-1',
  'and it is booked: B is finished now, so no batch is live and the fallback D (newest non-discarded) takes it');

-- No live batch: the fallback is D (non-discarded, newest), not the newer discarded E
select pg_temp.mkkey(5);
select pg_temp.mkb(5, 'C', 'fresh', -120, 100, 5);
select pg_temp.mkb(5, 'D', 'finished', -12, 96, 0, 2);
select pg_temp.mkb(5, 'E', 'discarded', -6, 96, 0, 4);
select pg_temp.dep(5, 1);
select is(pg_temp.consumed(5), 'D=-1', 'no live batch: the shortage goes on D, the newest non-discarded');
select is(pg_temp.bal('s5D') || ' ' || pg_temp.st('s5D'), '-1 finished', 'D is at -1 and stays finished');
select is(pg_temp.alerts(5), 1::bigint, 'the shortage is alerted');
-- Only discarded batches: the newest discarded
select pg_temp.mkkey(6);
select pg_temp.mkb(6, 'E', 'discarded', -30, 96, 0, 4);
select pg_temp.mkb(6, 'F', 'discarded', -6, 96, 0, 4);
select pg_temp.dep(6, 2);
select is(pg_temp.consumed(6), 'F=-2', 'only discarded batches: the newest discarded takes the shortage');
select is(pg_temp.st('s6F'), 'discarded', 'and it stays discarded');
-- No batch of the key at all
select pg_temp.mkkey(7);
select pg_temp.dep(7, 1);
select is(pg_temp.dep_s(), 'none 1 short', 'no batch of the key: nothing is booked, one shortage row without a batch');
select is((select count(*)::int from public.batch_movement where type = 'consume'
            and batch_id in (select id from public.batch where recipe_key = pg_temp.id('s7key'))), 0, 'and no movement exists');
select is((select payload ->> 'batch_id' is null and payload -> 'batch_id' = 'null'::jsonb from public.alert
            where kind = 'negative_stock' and entity_id = pg_temp.id('s7key')),
  true, 'the alert carries batch_id null');
select is((select payload ->> 'movement_id' from public.alert where kind = 'negative_stock' and entity_id = pg_temp.id('s7key')),
  null, 'and movement_id null');

-- Raw outflow across locations (AT3) ----------------------------------------------------------------------------------------
-- pol1: P2 in Cella (expires in 8 days, 0,1 kg), P1 in Dispensa (10 days, 1 kg), PX in the inactive location (expires first, 5 kg).
select pg_temp.mk_ing('pol1');
select pg_temp.mk_lot('p2', 'pol1', 'cella', 8, 0.1);
select pg_temp.mk_lot('p1', 'pol1', 'disp', 10, 1);
select pg_temp.mk_lot('px', 'pol1', 'chiuso', 2, 5);
select pg_temp.buy('pol1', 1.2);
select pg_temp.raw('pol1', 0.15, 'e5000000-0000-4000-8000-000000000001');
select is(pg_temp.raw_s(), 'p2@cella -0.1, p1@disp -0.05',
  'AT3: P2 (Cella, first to expire) -0,1, then P1 (Dispensa) -0,05; the inactive location is ignored');
select is((select string_agg(m.ref_type || ' ' || m.type::text || ' ' || trim_scale(m.unit_cost)::text, ',' order by m.qty)
             from public.stock_movement m where m.ref_id = 'e5000000-0000-4000-8000-000000000001'),
  'order_line consumption 1.2,order_line consumption 1.2', 'both rows are consumption, ref order_line, unit_cost the basis at p_at');
select is((select string_agg(distinct m.effective_on::text, ',') from public.stock_movement m
            where m.ref_id = 'e5000000-0000-4000-8000-000000000001'),
  app.venue_date(now(), 'Europe/Rome')::text, 'effective on the venue date');
-- need 2: P2 0,1, P1 1, then 0,9 unlotted at Dispensa (the last bucket used) and the engine's own alert
select pg_temp.mk_ing('pol2');
select pg_temp.mk_lot('q2', 'pol2', 'cella', 8, 0.1);
select pg_temp.mk_lot('q1', 'pol2', 'disp', 10, 1);
select pg_temp.raw('pol2', 2);
select is(pg_temp.raw_s(), 'q2@cella -0.1, q1@disp -1, unlotted@disp -0.9',
  'a need above the stock: both lots drained, 0,9 unlotted at the location of the last bucket used (Dispensa)');
select is((select count(*)::int from public.alert where kind = 'negative_stock' and entity_type = 'ingredient'
             and entity_id = pg_temp.id('pol2')), 1, 'the engine raises its own negative_stock alert (entity ingredient)');
-- no positive bucket: the location of the ingredient's latest movement
select pg_temp.mk_ing('pol3');
select pg_temp.mk_lot('r2', 'pol3', 'cella', 8, 1);
select pg_temp.mk_lot('r1', 'pol3', 'disp', 10, 1);
select pg_temp.mv('pol3', 'cella', 'r2', 'consumption', -1, 3);
select pg_temp.mv('pol3', 'disp', 'r1', 'consumption', -1, 1);
select pg_temp.raw('pol3', 0.5);
select is(pg_temp.raw_s(), 'unlotted@disp -0.5', 'no positive bucket: unlotted at the location of the latest movement (Dispensa, 1 h ago)');
select pg_temp.mk_ing('pol3b');
select pg_temp.mk_lot('s2', 'pol3b', 'cella', 8, 1);
select pg_temp.mk_lot('s1', 'pol3b', 'disp', 10, 1);
select pg_temp.mv('pol3b', 'disp', 's1', 'consumption', -1, 3);
select pg_temp.mv('pol3b', 'cella', 's2', 'consumption', -1, 1);
select pg_temp.raw('pol3b', 0.5);
select is(pg_temp.raw_s(), 'unlotted@cella -0.5', 'the same with the other order of movements: Cella (the latest this time)');
-- never any movement: the lowest-id active location
select pg_temp.mk_ing('pol4');
select pg_temp.raw('pol4', 0.5);
select is(pg_temp.raw_s(), 'unlotted@cella -0.5', 'no movement ever: the lowest-id active location (Cella)');
-- an unlotted positive bucket after the lots
select pg_temp.mk_ing('pol6');
select pg_temp.mk_lot('t1', 'pol6', 'cella', 8, 0.1);
select pg_temp.mv('pol6', 'disp', null, 'count', 0.4, 2);
select pg_temp.raw('pol6', 0.3);
select is(pg_temp.raw_s(), 't1@cella -0.1, unlotted@disp -0.2', 'lots first, then the positive unlotted bucket of Dispensa');
-- no active location (tenant B)
insert into reg values ('polb', gen_random_uuid());
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock)
  values (pg_temp.id('polb'), '22222222-2222-4222-8222-222222222222', 'Polenta B (demo)', 'kg', true);
select pg_temp.raw('polb', 0.5, gen_random_uuid(), '22222222-2222-4222-8222-222222222222');
select is(pg_temp.raw_s(), 'no rows', 'no active location: no row at all');
select is((select count(*)::int from public.stock_movement where tenant_id = '22222222-2222-4222-8222-222222222222'), 0,
  'and nothing is written for tenant B');

-- Frozen cost -------------------------------------------------------------------------------------------------------------------
select pg_temp.mk_ing('polc'); select pg_temp.mk_lot('c1', 'polc', 'cella', 8, 5); select pg_temp.buy('polc', 1.2);
select pg_temp.mk_ing('panec'); select pg_temp.mk_lot('c2', 'panec', 'disp', 8, 5); select pg_temp.buy('panec', 3);
select pg_temp.mk_ing('panenp'); select pg_temp.mk_lot('c3', 'panenp', 'disp', 8, 5);   -- no purchase: unpriced
select pg_temp.mkset(8); select pg_temp.mkset(9); select pg_temp.mkset(10);
insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
  values (pg_temp.id('s8A'), '11111111-1111-4111-8111-111111111111', 25, 2.5, false, '{}', now(), 'a1000000-0000-4000-8000-00000000000a'),
         (pg_temp.id('s9A'), '11111111-1111-4111-8111-111111111111', null, null, true, array[pg_temp.id('pane')], now(), 'a1000000-0000-4000-8000-00000000000a'),
         (pg_temp.id('s10A'), '11111111-1111-4111-8111-111111111111', 30, 3, false, '{}', now(), 'a1000000-0000-4000-8000-00000000000a');
-- plates: Q = 1 porz stew8 + 150 g polc + 50 g panec (yield 0,5); R = like Q on stew9; S = Q with panenp; T = 1 porz stew10 + 2 g sale
insert into reg values ('plate_q', gen_random_uuid()), ('q_v1', gen_random_uuid()), ('plate_r', gen_random_uuid()), ('r_v1', gen_random_uuid()),
  ('plate_s', gen_random_uuid()), ('s_v1', gen_random_uuid()), ('plate_t', gen_random_uuid()), ('t_v1', gen_random_uuid());
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  select pg_temp.id(k), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto ' || k || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'
    from unnest(array['plate_q', 'plate_r', 'plate_s', 'plate_t']) k;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
  select pg_temp.id(v), '11111111-1111-4111-8111-111111111111', pg_temp.id(k), 1, '2026-10-01T00:00Z', 'Piatto ' || k, 'a1000000-0000-4000-8000-00000000000a'
    from (values ('q_v1', 'plate_q'), ('r_v1', 'plate_r'), ('s_v1', 'plate_s'), ('t_v1', 'plate_t')) x (v, k);
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('q_v1'), 1, null, pg_temp.id('s8key'), 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('q_v1'), 2, pg_temp.id('polc'), null, 150, 'g', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('q_v1'), 3, pg_temp.id('panec'), null, 50, 'g', 0.5, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('r_v1'), 1, null, pg_temp.id('s9key'), 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('r_v1'), 2, pg_temp.id('polc'), null, 150, 'g', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('r_v1'), 3, pg_temp.id('panec'), null, 50, 'g', 0.5, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('s_v1'), 1, null, pg_temp.id('s8key'), 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('s_v1'), 2, pg_temp.id('polc'), null, 150, 'g', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('s_v1'), 3, pg_temp.id('panenp'), null, 50, 'g', 0.5, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('t_v1'), 1, null, pg_temp.id('s10key'), 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.id('t_v1'), 2, pg_temp.id('sale'), null, 2, 'g', 1, 'a1000000-0000-4000-8000-00000000000a');
select pg_temp.buy('sale', 0.5);
-- Menu item and lines (qty 1, 0,5 ...) of one session
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Piatto Q (demo)', 'Secondi', 'secondi',
   pg_temp.id('plate_q'), 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1,
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001',
   'Tavolo 1 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24',
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source,
    client_updated_at, created_by, updated_by)
  select ('15000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111',
         '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'secondi', q, 14, 10, 'menu',
         '2026-10-24 12:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from (values (1, 1), (2, 0.5), (3, 1), (4, 1), (5, 1), (6, 1), (7, 1), (8, 1)) x (n, q);
create function pg_temp.fr(p_n int, p_recipe text, p_unbooked uuid[] default '{}') returns void language plpgsql as $$
begin
  perform app.freeze_line_cost('11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d',
    ('15000000-0000-4000-8000-00000000000' || p_n)::uuid, case when p_recipe is null then null else pg_temp.id(p_recipe) end,
    p_unbooked, now());
end
$$;
create function pg_temp.cost_s(p_n int) returns text language sql as $$
  select coalesce(trim_scale(total_cost)::text, 'null') || ' ' || coalesce(trim_scale(unit_cost_at_sale)::text, 'null') || ' '
         || incomplete::text || ' ' || coalesce(recipe_id::text, 'norecipe')
    from public.order_line_cost where order_line_id = ('15000000-0000-4000-8000-00000000000' || p_n)::uuid
$$;

-- 1: complete, qty 1: stew 2,50 + polenta 0,15 x 1,20 + pane 0,1 x 3,00 = 2,98
select pg_temp.dep(8, 1, '15000000-0000-4000-8000-000000000001'); select pg_temp.raw('polc', 0.15, '15000000-0000-4000-8000-000000000001');
select pg_temp.raw('panec', 0.1, '15000000-0000-4000-8000-000000000001');
select pg_temp.fr(1, 'q_v1');
select is(pg_temp.cost_s(1), '2.98 2.98 false ' || pg_temp.id('q_v1')::text, 'qty 1: total 2,98, unit 2,98, complete, the plate version recorded');
select is((select cost_at = now() and cardinality(missing_ingredient_ids) + cardinality(missing_batch_ids) + cardinality(unbooked_batch_keys) = 0
             from public.order_line_cost where order_line_id = '15000000-0000-4000-8000-000000000001'), true,
  'cost_at is the instant given and every missing list is empty');
-- 2: qty 0,5: total 1,49, unit per full plate 2,98
select pg_temp.dep(8, 0.5, '15000000-0000-4000-8000-000000000002'); select pg_temp.raw('polc', 0.075, '15000000-0000-4000-8000-000000000002');
select pg_temp.raw('panec', 0.05, '15000000-0000-4000-8000-000000000002');
select pg_temp.fr(2, 'q_v1');
select is(pg_temp.cost_s(2), '1.49 2.98 false ' || pg_temp.id('q_v1')::text, 'qty 0,5: total 1,49 and unit_cost_at_sale 2,98 per full plate');
-- 3: a slice from a batch of incomplete cost
select pg_temp.dep(9, 1, '15000000-0000-4000-8000-000000000003'); select pg_temp.raw('polc', 0.15, '15000000-0000-4000-8000-000000000003');
select pg_temp.raw('panec', 0.1, '15000000-0000-4000-8000-000000000003');
select pg_temp.fr(3, 'r_v1');
select is(pg_temp.cost_s(3), 'null null true ' || pg_temp.id('r_v1')::text, 'a batch of unknown cost: incomplete, totals null (never 0)');
select is((select missing_batch_ids::text from public.order_line_cost where order_line_id = '15000000-0000-4000-8000-000000000003'),
  '{' || pg_temp.id('s9A')::text || '}', 'missing_batch_ids names that batch');
-- 4: unpriced pane
select pg_temp.dep(8, 1, '15000000-0000-4000-8000-000000000004'); select pg_temp.raw('polc', 0.15, '15000000-0000-4000-8000-000000000004');
select pg_temp.raw('panenp', 0.1, '15000000-0000-4000-8000-000000000004');
select pg_temp.fr(4, 's_v1');
select is(pg_temp.cost_s(4), 'null null true ' || pg_temp.id('s_v1')::text, 'an unpriced ingredient: incomplete');
select is((select missing_ingredient_ids::text from public.order_line_cost where order_line_id = '15000000-0000-4000-8000-000000000004'),
  '{' || pg_temp.id('panenp')::text || '}', 'missing_ingredient_ids names panenp only');
-- 5: non-stock Sale: costed, no stock row
select pg_temp.dep(10, 1, '15000000-0000-4000-8000-000000000005');
select pg_temp.fr(5, 't_v1');
select is(pg_temp.cost_s(5), '3.001 3.001 false ' || pg_temp.id('t_v1')::text, 'Sale (2 g at 0,50 EUR/kg) is costed 0,001 on top of the batch 3,00');
select is((select count(*)::int from public.stock_movement where ref_id = '15000000-0000-4000-8000-000000000005'), 0,
  'and no stock row exists for the non-stock ingredient');
-- 6: unbooked key
select pg_temp.fr(6, 't_v1', array[pg_temp.id('s10key')]);
select is(pg_temp.cost_s(6), 'null null true ' || pg_temp.id('t_v1')::text, 'an unbooked batch key: incomplete');
select is((select unbooked_batch_keys::text from public.order_line_cost where order_line_id = '15000000-0000-4000-8000-000000000006'),
  '{' || pg_temp.id('s10key')::text || '}', 'unbooked_batch_keys names the key');
-- 7: unmapped
select pg_temp.fr(7, null);
select is(pg_temp.cost_s(7), 'null null true norecipe', 'an unmapped item: recipe_id null, incomplete, totals null');
select is((select cardinality(missing_ingredient_ids) + cardinality(missing_batch_ids) + cardinality(unbooked_batch_keys)
             from public.order_line_cost where order_line_id = '15000000-0000-4000-8000-000000000007'), 0, 'with empty lists');
-- 8: a stock ingredient the plate needs but no row exists for it
select pg_temp.dep(8, 1, '15000000-0000-4000-8000-000000000008');
select pg_temp.fr(8, 'q_v1');
select is((select (select string_agg(x::text, ',' order by x::text collate "C") from unnest(missing_ingredient_ids) x)
             from public.order_line_cost where order_line_id = '15000000-0000-4000-8000-000000000008'),
  (select string_agg(id::text, ',' order by id::text collate "C") from reg where k in ('polc', 'panec')),
  'needed stock ingredients without any movement row are listed as missing (cost unknown, never 0)');
select is(pg_temp.err($$ select pg_temp.fr(1, 'q_v1') $$), '23505 duplicate key value violates unique constraint "order_line_cost_pkey"',
  'the cost of a line is frozen once');

-- ACL ---------------------------------------------------------------------------------------------------------------------------
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('order_void_reason_codes', 'void_waste_reason', 'plate_raw_needs', 'fire_batch_targets',
                          'lock_fire_batches', 'deplete_line_batches', 'post_plate_raw_outflow', 'freeze_line_cost')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
             or has_function_privilege('service_role', p.oid, 'execute')) $$,
  'no API role can execute any M19 helper');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app'
              and p.proname in ('order_void_reason_codes', 'void_waste_reason', 'plate_raw_needs', 'fire_batch_targets',
                                'lock_fire_batches', 'deplete_line_batches', 'post_plate_raw_outflow', 'freeze_line_cost')), 8,
  'all eight helpers exist');

select * from finish();
rollback;
