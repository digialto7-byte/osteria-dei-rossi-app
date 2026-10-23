-- M12 step 6: the read functions stock_on_hand, stock_lots, stock_movements and raw_waste_costs (M12 plan §3.2,
-- §3.4; AT1 rank, AT3 waste in EUR; V6). The first three return quantities only for owner, admin and chef; the
-- fourth returns EUR for owner and admin only. Fixtures are inserted as the migration owner; reads run with claims.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Freezer (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
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

-- Registry of fixture ids by key ------------------------------------------------------------------------
create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1'), ('freezer', '10000000-0000-4000-8000-0000000000a2'),
  ('cellab', '10000000-0000-4000-8000-0000000000b1');
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
create function pg_temp.mk_ing(p_k text, p_unit text default 'kg', p_stock boolean default true) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', p_k || ' (demo)', p_unit::public.base_unit, p_stock);
end
$$;
-- A lot with its receipt (unit_cost 10) at a location.
create function pg_temp.mk_lot(p_key text, p_code text, p_ing text, p_loc text, p_expiry date, p_recv date, p_qty numeric)
  returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
      expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    select v_lot, '11111111-1111-4111-8111-111111111111', i.id, pg_temp.id(p_loc),
           '5a000000-0000-4000-8000-00000000005a', v_line, p_code, p_expiry, p_recv, p_qty, i.base_unit, p_qty,
           i.base_unit::text, 1, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
      ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, pg_temp.id(p_loc), 'receipt', p_qty, 10,
      'invoice_line', v_line, p_recv, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- The AT1 fixture: three lots of 2 kg at Cella, received the same day; inserted out of FEFO order.
create function pg_temp.std(p_k text) returns void language plpgsql as $$
begin
  perform pg_temp.mk_ing(p_k);
  perform pg_temp.mk_lot(p_k || '_d5', 'L-D5', p_k, 'cella', '2026-10-28', '2026-10-20', 2);
  perform pg_temp.mk_lot(p_k || '_d2', 'L-D2', p_k, 'cella', '2026-10-25', '2026-10-20', 2);
  perform pg_temp.mk_lot(p_k || '_none', 'L-NONE', p_k, 'cella', null, '2026-10-20', 2);
end
$$;
create function pg_temp.buy(p_ing text, p_price numeric, p_on date) returns void language sql as $$
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
      effective_on, created_by)
    select '11111111-1111-4111-8111-111111111111', i.id, '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(),
           p_price, i.base_unit, p_on, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing)
$$;

create function pg_temp.alerts(p_ing text) returns int language sql as $$
  select count(*)::int from public.alert where kind = 'negative_stock' and entity_id = pg_temp.id(p_ing)
$$;
create function pg_temp.on_hand(p_ing text, p_loc text default 'cella') returns numeric language sql as $$
  select app.location_on_hand('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), pg_temp.id(p_loc))
$$;

-- Tenant B: one location, one ingredient, one lot (isolation) ---------------------------------------------
insert into public.ingredient (id, tenant_id, name, base_unit)
  values ('1b000000-0000-4000-8000-00000000001b', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');
insert into reg values ('lotb', '10700000-0000-4000-8000-0000000000b1');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on,
    qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  values ('10700000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
    '1b000000-0000-4000-8000-00000000001b', '10000000-0000-4000-8000-0000000000b1',
    '5b000000-0000-4000-8000-00000000005b', pg_temp.new_line('22222222-2222-4222-8222-222222222222'), 'L-B1',
    '2026-10-20', 2, 'kg', 2, 'kg', 1, 'b1000000-0000-4000-8000-00000000000b');

insert into auth.users (id, email) values ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Supporto Demo');
insert into public.location (id, tenant_id, name, is_active)
  values ('10000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)', false);
insert into reg values ('dispensa', '10000000-0000-4000-8000-0000000000a3');

create function pg_temp.as_chef() returns void language sql as $$
  select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef') $$;
create function pg_temp.as_owner() returns void language sql as $$
  select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin') $$;
create function pg_temp.as_ownerb() returns void language sql as $$
  select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner') $$;

-- The answer of each call, by key.
create temporary table res (k text primary key, r jsonb);
create function pg_temp.waste(p_k text, p_ing text, p_qty numeric, p_reason text default 'spoilage', p_loc text default null,
    p_lot text default null, p_unit text default 'kg') returns void language sql as $$
  insert into res select p_k, public.post_waste(pg_temp.id(p_ing), p_qty, p_unit, p_reason,
    case when p_loc is null then null else pg_temp.id(p_loc) end, case when p_lot is null then null else pg_temp.id(p_lot) end) $$;
create function pg_temp.consume(p_k text, p_ing text, p_qty numeric, p_loc text default null, p_lot text default null)
  returns void language sql as $$
  insert into res select p_k, public.consume_raw_fefo(pg_temp.id(p_ing), p_qty, 'kg',
    case when p_loc is null then null else pg_temp.id(p_loc) end, case when p_lot is null then null else pg_temp.id(p_lot) end) $$;
create function pg_temp.transfer(p_k text, p_ing text, p_qty numeric, p_from text, p_to text, p_lot text default null)
  returns void language sql as $$
  insert into res select p_k, public.post_transfer(pg_temp.id(p_ing), p_qty, 'kg', pg_temp.id(p_from), pg_temp.id(p_to),
    case when p_lot is null then null else pg_temp.id(p_lot) end) $$;
create function pg_temp.reverse(p_k text, p_movement uuid) returns void language sql as $$
  insert into res select p_k, public.reverse_movement(p_movement) $$;
create function pg_temp.op(p_k text) returns uuid language sql as $$ select (r ->> 'operationId')::uuid from res where k = p_k $$;
-- The rows of an operation as 'lotcode@location qty' sorted (a shortfall has the lot code 'null').
create function pg_temp.rows_of(p_op uuid) returns text language sql as $$
  select coalesce(string_agg(coalesce(l.lot_code, 'null') || '@' || left(x.name, 1) || ' ' || trim_scale(m.qty)::text, ', '
                             order by coalesce(l.lot_code, 'null') collate "C", x.name collate "C", m.qty), '-')
    from public.stock_movement m
    join public.location x on x.id = m.location_id
    left join public.raw_lot l on l.id = m.raw_lot_id
   where m.ref_id = p_op $$;
-- The buckets of an ingredient as 'location/lotcode=qty' sorted, from the canonical view.
create function pg_temp.buckets(p_ing text) returns text language sql as $$
  select coalesce(string_agg(left(x.name, 1) || '/' || coalesce(l.lot_code, 'null') || '=' || trim_scale(v.qty_on_hand)::text, ' '
                             order by x.name collate "C", coalesce(l.lot_code, 'null') collate "C"), '-')
    from public.v_stock_on_hand v
    join public.location x on x.id = v.location_id
    left join public.raw_lot l on l.id = v.raw_lot_id
   where v.ingredient_id = pg_temp.id(p_ing) and v.qty_on_hand <> 0 $$;
create function pg_temp.rowcount(p_ing text) returns int language sql as $$
  select count(*)::int from public.stock_movement where ingredient_id = pg_temp.id(p_ing) $$;


-- All keys of a jsonb value, at any depth, as text[] (the project's money-key detector is used on the result).
create function pg_temp.all_keys(p_json jsonb) returns text[] language sql as $$
  with recursive walk (node) as (
    select p_json
    union all
    select c.value from walk w cross join lateral (
      select o.value from jsonb_each(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) o
      union all
      select a.value from jsonb_array_elements(case when jsonb_typeof(w.node) = 'array' then w.node else '[]'::jsonb end) a) c)
  select coalesce(array_agg(distinct k.key), '{}') from walk w
    cross join lateral jsonb_object_keys(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) k (key) $$;
-- The rows of stock_on_hand / stock_lots as text, under the claims in force.
create function pg_temp.hand_text(p_loc text default null) returns text language sql as $$
  select coalesce(string_agg(h.ingredient_name || '@' || h.location_name || '=' || trim_scale(h.on_hand_qty)::text || '/' ||
                             trim_scale(h.unlotted_qty)::text, ' ' order by h.ingredient_name collate "C", h.location_name collate "C"), '-')
    from public.stock_on_hand(case when p_loc is null then null else pg_temp.id(p_loc) end) h $$;
create function pg_temp.lots_text(p_ing text, p_empty boolean default false) returns text language sql as $$
  select coalesce(string_agg(coalesce(l.lot_code, 'null') || ':' || coalesce(l.fefo_rank::text, '-') || ':' || trim_scale(l.on_hand_qty)::text,
                             ' ' order by l.location_name collate "C", l.fefo_rank nulls last, coalesce(l.lot_code, '') collate "C"), '-')
    from public.stock_lots(pg_temp.id(p_ing), p_empty) l $$;
create function pg_temp.today() returns date language sql as $$ select app.venue_date(now(), 'Europe/Rome') $$;

-- Fixtures: beef with three lots and a price; salt without a price; a negative unlotted bucket; tenant B stock.
select pg_temp.std('b1');
select pg_temp.buy('b1', 10, '2026-10-01');
select pg_temp.buy('b1', 10, '2026-10-02');
select pg_temp.buy('b1', 10, '2026-10-03');
select pg_temp.mk_ing('sale');
select pg_temp.mk_lot('sale_l', 'L-SALE', 'sale', 'cella', null, '2026-10-20', 4);
select pg_temp.mk_ing('neg');
select pg_temp.mk_lot('neg_l', 'L-NEG', 'neg', 'cella', null, '2026-10-20', 1);
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('neg'), null, pg_temp.id('cella'), 'count', -3, 'count_session',
    gen_random_uuid(), '2026-10-22', 'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('22222222-2222-4222-8222-222222222222', '1b000000-0000-4000-8000-00000000001b', pg_temp.id('lotb'),
    pg_temp.id('cellab'), 'receipt', 2, 7, 'invoice_line', (select invoice_line_id from public.raw_lot where id = pg_temp.id('lotb')),
    '2026-10-20', 'b1000000-0000-4000-8000-00000000000b');
select pg_temp.mk_lot('b1_f', 'L-F', 'b1', 'freezer', '2026-10-27', '2026-10-21', 1);

-- stock_on_hand ----------------------------------------------------------------------------------------------------------
select pg_temp.as_owner();
select is(pg_temp.hand_text(), 'b1 (demo)@Cella (demo)=6/0 b1 (demo)@Freezer (demo)=1/0 neg (demo)@Cella (demo)=-2/-3 sale (demo)@Cella (demo)=4/0',
  'owner: on hand per ingredient and location, with the unlotted bucket (a negative one shows)');
select is_empty($$ select 1 from (
    select h.ingredient_id, h.location_id, h.on_hand_qty from public.stock_on_hand() h
    full outer join (select v.ingredient_id, v.location_id, sum(v.qty_on_hand) q from public.v_stock_on_hand v
                      where v.tenant_id = '11111111-1111-4111-8111-111111111111' group by 1, 2) f
      on f.ingredient_id = h.ingredient_id and f.location_id = h.location_id
    where h.on_hand_qty is distinct from f.q) d $$, 'every row equals the sum of the canonical view (v_stock_on_hand)');
select is(pg_temp.hand_text('freezer'), 'b1 (demo)@Freezer (demo)=1/0', 'the location filter');
select is(pg_temp.err($$ select * from public.stock_on_hand('10000000-0000-4000-8000-0000000000b1') $$), 'P0002 location_not_found',
  'a location of another tenant: P0002');
select pg_temp.as_chef();
select is(pg_temp.hand_text(), 'b1 (demo)@Cella (demo)=6/0 b1 (demo)@Freezer (demo)=1/0 neg (demo)@Cella (demo)=-2/-3 sale (demo)@Cella (demo)=4/0',
  'chef: the same quantities (the chef reads no stock_movement row, only this function)');
select pg_temp.as_ownerb();
select is((select string_agg(h.ingredient_name, ',') from public.stock_on_hand() h), 'Burro B (demo)', 'owner B sees only tenant B stock');
select pg_temp.as_admin();
select is(pg_temp.hand_text('cella') like 'b1 (demo)@Cella%', true, 'admin reads it too');

-- stock_lots -------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_chef();
select is(pg_temp.lots_text('b1'), 'L-D2:1:2 L-D5:2:2 L-NONE:3:2 L-F:1:1', 'FEFO rank per location: L-D2, L-D5, L-NONE at Cella, L-F at Freezer');
select is(pg_temp.lots_text('neg'), 'L-NEG:1:1 null:-:-3', 'the unlotted bucket is a row with a null lot (and no rank when negative)');
select pg_temp.mk_ing('em');
select pg_temp.mk_lot('em_l', 'L-EM', 'em', 'cella', null, '2026-10-20', 1);
select pg_temp.mk_lot('em_2', 'L-EM2', 'em', 'cella', null, '2026-10-21', 1);
select pg_temp.as_owner();
select pg_temp.consume('emc', 'em', 1, 'cella', 'em_l');
select pg_temp.as_chef();
select is(pg_temp.lots_text('em'), 'L-EM2:1:1', 'an empty bucket is hidden');
select is(pg_temp.lots_text('em', true), 'L-EM2:1:1 L-EM:-:0', 'and shown with p_include_empty (no rank)');
select pg_temp.mk_ing('ex');
select pg_temp.mk_lot('ex_a', 'X-PAST', 'ex', 'cella', pg_temp.today() - 1, '2026-10-01', 1);
select pg_temp.mk_lot('ex_b', 'X-TODAY', 'ex', 'cella', pg_temp.today(), '2026-10-01', 1);
select pg_temp.mk_lot('ex_c', 'X-TOMORROW', 'ex', 'cella', pg_temp.today() + 1, '2026-10-01', 1);
select pg_temp.mk_lot('ex_d', 'X-LATER', 'ex', 'cella', pg_temp.today() + 2, '2026-10-01', 1);
select pg_temp.mk_lot('ex_e', 'X-NONE', 'ex', 'cella', null, '2026-10-01', 1);
select is((select string_agg(l.lot_code || '=' || l.expiry_state, ' ' order by l.fefo_rank) from public.stock_lots(pg_temp.id('ex')) l),
  'X-PAST=expired X-TODAY=due_soon X-TOMORROW=due_soon X-LATER=ok X-NONE=none', 'expiry_state from app.expiry_state (no expiry derived from the receipt date)');
select is((select l.supplier_name || ' ' || l.qty_received::text || ' ' || l.received_on::text || ' ' || l.location_name
             from public.stock_lots(pg_temp.id('b1')) l where l.lot_code = 'L-D2'), 'Fornitore Demo Srl 2.0000 2026-10-20 Cella (demo)',
  'supplier name, quantity received, received date and location');
select pg_temp.as_ownerb();
select is(pg_temp.err($$ select * from public.stock_lots(pg_temp.id('b1')) $$), 'P0002 ingredient_not_found', 'tenant A''s ingredient for owner B: P0002');

-- stock_movements -----------------------------------------------------------------------------------------------------------------------
select pg_temp.mk_ing('hist');
select pg_temp.mk_lot('hist_l', 'L-H', 'hist', 'cella', null, '2026-10-20', 20);
do $$
declare
  n int;
begin
  for n in 1..5 loop
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id,
        effective_on, created_at, created_by)
      values ('11111111-1111-4111-8111-111111111111', (select id from reg where k = 'hist'), (select id from reg where k = 'hist_l'),
        (select id from reg where k = 'cella'), 'waste', -n, 10, 'spoilage', 'manual',
        ('0f000000-0000-4000-8000-00000000000' || n)::uuid, ('2025-10-2' || n)::date, ('2025-10-2' || n || 'T10:00:00Z')::timestamptz,
        'a1000000-0000-4000-8000-00000000000a');
  end loop;
end $$;
select pg_temp.as_owner();
create temporary table hist_pages (page int, r jsonb);
insert into hist_pages select 0, public.stock_movements(pg_temp.id('hist'), null, null, 50);
select is((select string_agg(o ->> 'qty', ',' order by ord) from hist_pages, jsonb_array_elements(r -> 'operations') with ordinality x (o, ord)
            where o ->> 'type' = 'waste'), '-5.0000,-4.0000,-3.0000,-2.0000,-1.0000', 'operations come newest first');
select is((select r -> 'nextCursor' from hist_pages where page = 0), 'null'::jsonb, 'and no cursor when everything fits');
insert into hist_pages select 1, public.stock_movements(pg_temp.id('hist'), null, null, 2);
select is((select jsonb_array_length(r -> 'operations') from hist_pages where page = 1), 2, 'p_limit 2: two operations');
insert into hist_pages select 2, public.stock_movements(pg_temp.id('hist'), (r -> 'nextCursor' ->> 'createdAt')::timestamptz,
  (r -> 'nextCursor' ->> 'id')::uuid, 2) from hist_pages where page = 1;
insert into hist_pages select 3, public.stock_movements(pg_temp.id('hist'), (r -> 'nextCursor' ->> 'createdAt')::timestamptz,
  (r -> 'nextCursor' ->> 'id')::uuid, 2) from hist_pages where page = 2;
select is((select string_agg(o ->> 'operationId', ',' order by p.page, ord) from hist_pages p, jsonb_array_elements(p.r -> 'operations') with ordinality x (o, ord)
            where p.page in (1, 2, 3)),
  (select string_agg(o ->> 'operationId', ',' order by ord) from hist_pages p, jsonb_array_elements(p.r -> 'operations') with ordinality x (o, ord)
    where p.page = 0), 'the pages continue without a gap or a repeat (receipt included)');
select is((select r -> 'nextCursor' from hist_pages where page = 3), 'null'::jsonb, 'the last page has no cursor');
select is(pg_temp.err($$ select public.stock_movements(pg_temp.id('hist'), null, null, 0) $$), 'P0001 invalid_request', 'p_limit 0: invalid_request');
select is(pg_temp.err($$ select public.stock_movements(pg_temp.id('hist'), null, null, 101) $$), 'P0001 invalid_request', 'p_limit 101: invalid_request');
select is(pg_temp.err($$ select public.stock_movements(pg_temp.id('hist'), now(), null, 10) $$), 'P0001 invalid_request', 'half a cursor: invalid_request');

-- Shapes: one waste over two lots, reversible, reversed, reversal ---------------------------------------------------------------------
select pg_temp.mk_ing('op1');
select pg_temp.mk_lot('op1_a', 'L-OA', 'op1', 'cella', '2026-10-25', '2026-10-20', 1);
select pg_temp.mk_lot('op1_b', 'L-OB', 'op1', 'cella', '2026-10-28', '2026-10-20', 2);
select pg_temp.as_owner();
select pg_temp.waste('op1w', 'op1', 2, 'expired', 'cella');
select pg_temp.as_chef();
select pg_temp.waste('op1c', 'op1', 0.5, 'breakage', 'cella');
create temporary table ops as select o from jsonb_array_elements(public.stock_movements(pg_temp.id('op1'), null, null, 50) -> 'operations') o;
select is((select jsonb_array_length(o -> 'lines') from ops where o ->> 'operationId' = pg_temp.op('op1w')::text), 2,
  'a waste over two lots is one operation with two lines');
select is((select o ->> 'reversible' from ops where o ->> 'operationId' = pg_temp.op('op1w')::text), 'true', 'a manual waste is reversible');
select is((select o ->> 'reversible' from ops where o ->> 'type' = 'receipt' limit 1), 'false', 'a receipt is not');
select is((select o ->> 'type' || ' ' || (o ->> 'reasonCode') || ' ' || (o ->> 'unit') || ' ' || (o ->> 'qty') || ' ' || (o ->> 'refType')
             from ops where o ->> 'operationId' = pg_temp.op('op1w')::text), 'waste expired kg -2.0000 manual', 'type, reason, unit, qty and ref_type');
select is((select o ->> 'byName' || ' ' || (o ->> 'byMe') from ops where o ->> 'operationId' = pg_temp.op('op1c')::text), 'Chef Demo true',
  'chef: byName set and byMe true on their own operation');
select is((select (o -> 'byName')::text || ' ' || (o ->> 'byMe') from ops where o ->> 'operationId' = pg_temp.op('op1w')::text), 'null false',
  'chef: byName null on the owner''s operation');
select pg_temp.as_owner();
select pg_temp.reverse('op1r', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('op1w') limit 1));
select pg_temp.as_admin();
drop table ops;
create temporary table ops as select o from jsonb_array_elements(public.stock_movements(pg_temp.id('op1'), null, null, 50) -> 'operations') o;
select is((select o ->> 'reversible' || ' ' || (o ->> 'reversedByOperationId') from ops where o ->> 'operationId' = pg_temp.op('op1w')::text),
  'false ' || pg_temp.op('op1r')::text, 'a reversed operation is not reversible and names its reversal');
select is((select o ->> 'reversible' || ' ' || (o ->> 'isReversal') from ops where o ->> 'operationId' = pg_temp.op('op1r')::text), 'false true',
  'a reversal is not reversible and says so');
select is((select o ->> 'byName' from ops where o ->> 'operationId' = pg_temp.op('op1w')::text), 'Titolare Demo', 'admin: display names are shown');
select is(app.payload_money_keys((select jsonb_agg(o) from ops)), '{}'::text[], 'no key of the history looks like money');
select is((select pg_temp.all_keys(jsonb_agg(o)) from ops), array['byMe', 'byName', 'createdAt', 'effectiveOn', 'handleId', 'isReversal', 'lines',
  'locationId', 'locationName', 'lotCode', 'movementId', 'operationId', 'qty', 'rawLotId', 'reasonCode', 'refType', 'reversedByOperationId',
  'reversible', 'type', 'unit'], 'the history keys are exactly the planned ones');

-- raw_waste_costs (EUR; owner and admin only) -----------------------------------------------------------------------------------------------
select pg_temp.as_chef();
select pg_temp.mk_ing('wc');
select pg_temp.buy('wc', 10, '2026-10-01');
select pg_temp.mk_lot('wc_l', 'L-WC', 'wc', 'cella', null, '2026-10-20', 10);
select pg_temp.waste('wc1', 'wc', 1.5, 'spoilage', 'cella');
select pg_temp.waste('sa1', 'sale', 1, 'spoilage', 'cella');
select pg_temp.as_owner();
create temporary table wc as select public.raw_waste_costs(pg_temp.today(), pg_temp.today()) as r;
select is((select r ->> 'valueEur' from wc), '15.0000', 'AT3: 1,5 kg wasted at basis 10 is 15.0000 in total');
select is((select (e ->> 'reasonCode') || ' ' || (e ->> 'valueEur') from wc, jsonb_array_elements(r -> 'reasons') e limit 1), 'spoilage 15.0000',
  'under spoilage');
select is((select (r ->> 'unvaluedCount') from wc), '2',
  'the wastes of ingredients without a price (the salt, and the unpriced breakage of op1) are counted as unvalued, the reversed one is not');
select is((select (l ->> 'ingredientName') || ' ' || coalesce(l ->> 'valueEur', 'null') || ' ' || (l ->> 'qty')
             from wc, jsonb_array_elements(r -> 'reasons') e, jsonb_array_elements(e -> 'lines') l where l ->> 'ingredientName' like 'sale%'),
  'sale (demo) null 1.0000', 'and its line has valueEur null, never 0');
select pg_temp.reverse('wc1r', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('wc1') limit 1));
select is((public.raw_waste_costs(pg_temp.today(), pg_temp.today()) ->> 'valueEur'), '0.0000', 'after the reversal the waste is worth 0.0000 (the reversal is dated today)');
select is((select r ->> 'from' || ' ' || (r ->> 'to') from wc), pg_temp.today()::text || ' ' || pg_temp.today()::text, 'the range is echoed');
select is(pg_temp.err($$ select public.raw_waste_costs('2026-10-24', '2026-10-23') $$), 'P0001 range_invalid', 'from after to: range_invalid');
select is(pg_temp.err($$ select public.raw_waste_costs('2025-10-23', '2026-10-24') $$), 'P0001 range_too_long', '367 days: range_too_long');
select is(pg_temp.err($$ select public.raw_waste_costs('2025-10-24', '2026-10-24') $$), 'ok', '366 days: allowed');
select pg_temp.as_admin();
select is(pg_temp.err($$ select public.raw_waste_costs(pg_temp.today(), pg_temp.today()) $$), 'ok', 'admin may read the waste in EUR');
select pg_temp.as_chef();
select is(pg_temp.err($$ select public.raw_waste_costs(pg_temp.today(), pg_temp.today()) $$), '42501 permission denied: costs need owner or admin', 'chef: 42501');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$ select public.raw_waste_costs(pg_temp.today(), pg_temp.today()) $$), '42501 permission denied: costs need owner or admin', 'waiter: 42501');

-- unvaluedCount counts unpriced waste OPERATIONS that are not reversed, not rows, and never nets across ingredients or periods.
select pg_temp.as_owner();
create temporary table uv0 as select (public.raw_waste_costs(pg_temp.today(), pg_temp.today()) ->> 'unvaluedCount')::int as n;
select pg_temp.as_chef();
select pg_temp.std('uv');
select pg_temp.waste('uv1', 'uv', 5, 'spoilage', 'cella');
select is((select count(*)::int from public.stock_movement m where m.ref_id = pg_temp.op('uv1')), 3, 'setup: one unpriced waste split over 3 lots');
select pg_temp.as_owner();
select is((public.raw_waste_costs(pg_temp.today(), pg_temp.today()) ->> 'unvaluedCount')::int - (select n from uv0), 1,
  'a FEFO waste over 3 lots without a price counts as ONE unvalued operation');
-- An unpriced waste of ANOTHER ingredient from last month, reversed today: the reversal must not cancel this month's count.
select pg_temp.mk_ing('uw');
insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id,
    effective_on, created_by)
  values ('90000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', pg_temp.id('uw'), null, pg_temp.id('cella'),
    'waste', -1, null, 'spoilage', 'manual', '90000000-0000-4000-8000-0000000000f1', pg_temp.today() - 40,
    'c1000000-0000-4000-8000-00000000000c');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id,
    reverses_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('uw'), null, pg_temp.id('cella'),
    'waste', 1, null, 'spoilage', 'reversal', '90000000-0000-4000-8000-0000000000f2', '90000000-0000-4000-8000-000000000001',
    pg_temp.today(), 'c1000000-0000-4000-8000-00000000000c');
select is((public.raw_waste_costs(pg_temp.today(), pg_temp.today()) ->> 'unvaluedCount')::int - (select n from uv0), 1,
  'the reversal today of another ingredient''s unpriced waste from last month does not hide this month''s one');
select is((public.raw_waste_costs(pg_temp.today() - 40, pg_temp.today() - 40) ->> 'unvaluedCount')::int, 1,
  'for last month alone the operation still counts (its line is still shown there: the reversal is dated today)');
select is((public.raw_waste_costs(pg_temp.today() - 40, pg_temp.today()) ->> 'unvaluedCount')::int,
  (public.raw_waste_costs(pg_temp.today(), pg_temp.today()) ->> 'unvaluedCount')::int,
  'over a range that holds both the waste and its reversal the operation is not counted');
select is(pg_temp.err($$ select public.raw_waste_costs(pg_temp.today(), pg_temp.today()) ->> 'unvaluedCount' $$), 'ok', 'the field stays readable');
select is(jsonb_typeof(public.raw_waste_costs(pg_temp.today(), pg_temp.today()) -> 'unvaluedCount'), 'number', 'and a number');

-- Column scan and grants --------------------------------------------------------------------------------------------------------------------------
select is_empty($$ select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('stock_on_hand', 'stock_lots') and pg_get_function_result(p.oid) ~* '(cost|price|eur|value|amount|margin)' $$,
  'stock_on_hand and stock_lots have no cost-like result column');
select is_empty($$ select f.proname, r.rolname
    from pg_proc f cross join (values ('anon'), ('service_role')) r (rolname)
   where f.pronamespace = 'public'::regnamespace and f.proname in ('stock_on_hand', 'stock_lots', 'stock_movements', 'raw_waste_costs')
     and has_function_privilege(r.rolname, f.oid, 'execute') $$, 'anon and service_role cannot execute the four reads');
select ok((select bool_and(has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('public', f.oid, 'execute')
                           and f.prosecdef and f.proconfig @> array['search_path=""'])
             from pg_proc f where f.pronamespace = 'public'::regnamespace
              and f.proname in ('stock_on_hand', 'stock_lots', 'stock_movements', 'raw_waste_costs')),
  'authenticated only, security definer, empty search_path');

select * from finish();
rollback;
