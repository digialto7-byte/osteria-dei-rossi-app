-- M23 step 9 (docs/plans/2026-10-31-m23-push-forecast.md §3.10, §5; ADR-026): a regression net, not a latency claim. Under a 5 s statement limit and a venue-sized history (400 batches of
-- 25 recipes, 60 of them due soon; 2,000 lots, 100 due soon; 60 plates on the menu; 28 days x 60 closed sessions x 8 lines; 500 menu_push rows), push_list_json, forecast_json,
-- discards_vs_push_json and dashboard_summary_at all answer, and the reads the push list and the discards report are built on can use their indexes (batch_use_by_idx,
-- raw_lot_expiry_idx, batch_movement_effective_idx) without a sequential scan of batch_movement or stock_movement. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore A (demo)', 'IT12345678903');
insert into public.ingredient (id, tenant_id, name, base_unit)
  select md5('ing' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Ingrediente ' || n || ' (demo)', 'kg' from generate_series(1, 40) n;

-- 25 batch recipes and 60 plates (each plate uses one batch recipe); 60 menu items.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  select md5('bk' || n)::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'batch'::public.recipe_type, 1, 'preparazione ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'::uuid from generate_series(1, 25) n
  union all
  select md5('pk' || n)::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'plate'::public.recipe_type, 1, 'piatto ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'::uuid from generate_series(1, 60) n;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by)
  select md5('rb' || n)::uuid, '11111111-1111-4111-8111-111111111111', md5('bk' || n)::uuid, 1, '2025-01-01', 'Preparazione ' || n || ' (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 25) n;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
  select md5('rp' || n)::uuid, '11111111-1111-4111-8111-111111111111', md5('pk' || n)::uuid, 1, '2025-01-01', 'Piatto ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 60) n;
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by)
  select '11111111-1111-4111-8111-111111111111'::uuid, md5('rb' || n)::uuid, 1, md5('ing' || (1 + n % 40))::uuid, null::uuid, 1::numeric, 'kg'::public.recipe_unit, 1::numeric, 'a1000000-0000-4000-8000-00000000000a'::uuid from generate_series(1, 25) n
  union all
  select '11111111-1111-4111-8111-111111111111'::uuid, md5('rp' || n)::uuid, 1, null::uuid, md5('bk' || (1 + n % 25))::uuid, 1::numeric, 'porz'::public.recipe_unit, 1::numeric, 'a1000000-0000-4000-8000-00000000000a'::uuid from generate_series(1, 60) n
  union all
  select '11111111-1111-4111-8111-111111111111'::uuid, md5('rp' || n)::uuid, 2, md5('ing' || (1 + n % 40))::uuid, null::uuid, 0.02::numeric, 'kg'::public.recipe_unit, 1::numeric, 'a1000000-0000-4000-8000-00000000000a'::uuid from generate_series(1, 60) n;
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by)
  select md5('mi' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Piatto ' || n || ' (demo)', 'Primi', 'primi', md5('pk' || n)::uuid,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 60) n;
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  select '11111111-1111-4111-8111-111111111111', md5('mi' || n)::uuid, 10, 10, '2025-01-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 60) n;

-- N = Thu 2026-11-05 10:00 CET (09:00Z). 400 batches: 60 due soon (use-by within 20 h), 70 expired, 270 later. Each has a produce movement (10 portions) and a frozen cost.
create temporary table b_ids as
  select g as n, md5('batch' || g)::uuid as id, md5('bk' || (1 + g % 25))::uuid as key,
         case when g <= 60 then timestamptz '2026-11-05T09:00Z' + make_interval(mins => g * 20)
              when g <= 130 then timestamptz '2026-11-05T09:00Z' - make_interval(hours => g - 60)
              else timestamptz '2026-11-05T09:00Z' + make_interval(hours => 30 + g) end as use_by
    from generate_series(1, 400) g;
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
                          portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
  select b.id, '11111111-1111-4111-8111-111111111111', b.key, md5('rb' || (1 + b.n % 25))::uuid, 1, '261101-LOT-' || b.n, '2026-11-01', 'LOT', b.n, b.use_by - interval '48 hours',
         'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 10, 10, 48, b.use_by, 'fresh', '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a'
    from b_ids b;
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', b.id, 'produce', 10, 'batch', b.id, '2026-11-01', b.use_by - interval '48 hours', 'a1000000-0000-4000-8000-00000000000a' from b_ids b;
-- Discards in the week 2026-11-02..08 for 60 of them (dated by effective_on), and consumption on the first 60.
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', b.id, 'waste', -2, 'expired', 'batch_discard', gen_random_uuid(), date '2026-11-02' + b.n % 4, timestamptz '2026-11-03T10:00Z' + make_interval(mins => b.n), 'a1000000-0000-4000-8000-00000000000a'
    from b_ids b where b.n between 61 and 120;
-- Earlier discards over the 26 weeks before (2 per batch for the 270 batches due later, 1 portion each), so the report week is a small slice of the
-- discard history, as at a venue in use. Without them every discard falls in the report week and a fresh planner rightly reads by ref_type instead.
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', b.id, 'waste', -1, 'expired', 'batch_discard', gen_random_uuid(), date '2026-05-04' + ((b.n * 2 + k) % 182), timestamptz '2026-05-04T10:00Z' + make_interval(days => (b.n * 2 + k) % 182), 'a1000000-0000-4000-8000-00000000000a'
    from b_ids b, generate_series(0, 1) k where b.n > 130;
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', b.id, 'consume', -3, 'order_line', gen_random_uuid(), '2026-11-04', '2026-11-04T18:00Z', 'a1000000-0000-4000-8000-00000000000a' from b_ids b where b.n <= 60;
insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
  select b.id, '11111111-1111-4111-8111-111111111111', 25.0000, 2.5000, false, '{}', b.use_by - interval '48 hours', 'a1000000-0000-4000-8000-00000000000a' from b_ids b;

-- 2,000 lots of 40 ingredients: 100 expire today or tomorrow, 300 are long expired, the rest are later or have no expiry. Each has an invoice line and a receipt.
create temporary table l_ids as
  select g as n, md5('lot' || g)::uuid as id, md5('inv' || g)::uuid as inv, md5('invl' || g)::uuid as line, md5('ing' || (1 + g % 40))::uuid as ing,
         case when g <= 50 then date '2026-11-05' when g <= 100 then date '2026-11-06' when g <= 400 then date '2026-09-01' + g % 60 when g % 5 = 0 then null else date '2026-12-01' + g % 90 end as expiry
    from generate_series(1, 2000) g;
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  select l.inv, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/2026/' || l.inv || '.pdf', 'application/pdf', 2048, 'received', '5a000000-0000-4000-8000-00000000005a' from l_ids l;
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
  select l.line, '11111111-1111-4111-8111-111111111111', l.inv, 1, 'Riga demo', 1, 1, 1, '{}', '{}' from l_ids l;
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  select l.id, '11111111-1111-4111-8111-111111111111', l.ing, '10000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-00000000005a', l.line, 'L-' || l.n, l.expiry, '2026-10-30',
         5, 'kg', 5, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a' from l_ids l;
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  select '11111111-1111-4111-8111-111111111111', l.ing, l.id, '10000000-0000-4000-8000-0000000000a1', 'receipt', 5, 4.00, 'invoice_line', l.line, '2026-10-30', 'a1000000-0000-4000-8000-00000000000a' from l_ids l;
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
  select '11111111-1111-4111-8111-111111111111', l.ing, l.id, '10000000-0000-4000-8000-0000000000a1', 'consumption', -2, 'test', gen_random_uuid(), '2026-11-03', 'a1000000-0000-4000-8000-00000000000a' from l_ids l where l.n % 3 = 0;

-- 28 business days (2026-10-08 .. 2026-11-04) x 60 closed sessions x 8 lines of 10,00, each line a plate with its frozen cost row (mapped).
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 60) n;
create temporary table closed_ids as
  select g as n, gen_random_uuid() as id, date '2026-10-08' + ((g - 1) / 60) as bdate from generate_series(1, 1680) g;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate, closed_at, closed_by,
                                  closed_business_date, receipt_type, receipt_number, payment_type, total, created_by, updated_by)
  select c.id, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-0000000000' || lpad((1 + c.n % 60)::text, 2, '0'))::uuid, 'Tavolo ' || (1 + c.n % 60) || ' (demo)', 2 + c.n % 3,
         ((c.bdate + time '19:00') at time zone 'Europe/Rome') + make_interval(mins => c.n % 60),
         'd1000000-0000-4000-8000-00000000000d', c.bdate, 2.00, 10, ((c.bdate + time '21:30') at time zone 'Europe/Rome') + make_interval(mins => c.n % 60), 'd1000000-0000-4000-8000-00000000000d',
         c.bdate, 'scontrino', 'N' || c.n, 'card', 80.00 + (2 + c.n % 3) * 2.00, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from closed_ids c;
create temporary table line_ids as select gen_random_uuid() as id, c.id as sid, l as k, 1 + ((c.n * 8 + l) % 60) as item from closed_ids c, generate_series(1, 8) l;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select l.id, '11111111-1111-4111-8111-111111111111', l.sid, md5('mi' || l.item)::uuid, 'primi', 1, 10.00, 10, 'menu', '2026-10-01T12:00Z',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', '2026-10-01T12:00Z', 'd1000000-0000-4000-8000-00000000000d'
    from line_ids l;
insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, cost_at, created_by)
  select l.id, '11111111-1111-4111-8111-111111111111', md5('rp' || l.item)::uuid, 3.00, 3.00, false, '2026-10-01T12:00Z', 'd1000000-0000-4000-8000-00000000000d' from line_ids l;

-- 500 menu_push rows: per item alternating start / stop every 60th row, ten hours per start.
insert into public.menu_push (tenant_id, menu_item_id, action, push_until, push_price, batch_keys, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', md5('mi' || (1 + g % 60))::uuid, case when (g / 60) % 2 = 0 then 'start' else 'stop' end,
         case when (g / 60) % 2 = 0 then timestamptz '2026-10-01T00:00Z' + make_interval(mins => g * 100) + interval '10 hours' end,
         case when (g / 60) % 2 = 0 and g % 3 = 0 then 8.00 end,
         case when (g / 60) % 2 = 0 then array[md5('bk' || (1 + (1 + g % 60) % 25))::uuid] else '{}'::uuid[] end,
         timestamptz '2026-10-01T00:00Z' + make_interval(mins => g * 100), 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(0, 499) g;
analyze public.batch;
analyze public.batch_movement;
analyze public.batch_cost;
analyze public.raw_lot;
analyze public.stock_movement;
analyze public.table_session;
analyze public.order_line;
analyze public.order_line_cost;
analyze public.menu_item;
analyze public.menu_push;
analyze public.recipe_line;

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
create function pg_temp.plan(q text) returns jsonb language plpgsql as $$
declare
  j json;
begin
  execute 'explain (format json) ' || q into j;
  return j::jsonb;
end
$$;
select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);

-- The answers under a 5 s limit ------------------------------------------------------------------------------------------------------------------------
create temporary table res (k text, j jsonb);
grant all on res to public;
set local statement_timeout = '5s';
select is(pg_temp.err($$insert into res select 'list', app.push_list_json('11111111-1111-4111-8111-111111111111', 'owner', '2026-11-05T09:00Z')$$), 'ok', 'push_list_json answers within 5 s');
select is(pg_temp.err($$insert into res select 'fc', app.forecast_json('11111111-1111-4111-8111-111111111111', 'owner', '2026-11-05', '2026-11-05T09:00Z')$$), 'ok', 'forecast_json answers within 5 s');
select is(pg_temp.err($$insert into res select 'dv', app.discards_vs_push_json('11111111-1111-4111-8111-111111111111', '2026-11-05', '2026-11-05T09:00Z')$$), 'ok', 'discards_vs_push_json answers within 5 s');
select is(pg_temp.err($$insert into res select 'dash', app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '2026-11-05T09:00Z')$$), 'ok', 'dashboard_summary_at answers within 5 s');
reset statement_timeout;
select is((select j -> 'totals' ->> 'count' from res where k = 'list'), '160', 'the list holds the 60 batches and 100 lots that are due soon (and nothing else)');

-- The indexes: the reads of push_list_window and the discards report can use them (sequential scans disabled, so a missing index shows as a Seq Scan) ------------
set local enable_seqscan = off;
create temporary table plans (k text, j jsonb);
insert into plans values
  ('batch', pg_temp.plan($q$ select b.id, c.portions from public.batch b
        cross join lateral (select sum(m.portions) as portions from public.batch_movement m where m.tenant_id = b.tenant_id and m.batch_id = b.id) c
       where b.tenant_id = '11111111-1111-4111-8111-111111111111' and b.use_by > timestamptz '2026-11-05T09:00Z' and b.use_by <= timestamptz '2026-11-05T09:00Z' + interval '24 hours' $q$)),
  ('lot', pg_temp.plan($q$ select l.id, c.qty from public.raw_lot l
        cross join lateral (select sum(m.qty) as qty from public.stock_movement m where m.tenant_id = l.tenant_id and m.raw_lot_id = l.id) c
       where l.tenant_id = '11111111-1111-4111-8111-111111111111' and l.expiry is not null and l.expiry >= date '2026-11-05' and l.expiry <= date '2026-11-06' $q$)),
  ('discards', pg_temp.plan($q$ select m.batch_id, sum(-m.portions) from public.batch_movement m
       where m.tenant_id = '11111111-1111-4111-8111-111111111111' and m.type::text = 'waste' and m.ref_type = 'batch_discard' and m.reverses_id is null
         and m.effective_on between date '2026-11-02' and date '2026-11-08' group by m.batch_id $q$));
select is((select position('batch_use_by_idx' in j::text) > 0 from plans where k = 'batch'), true, 'the batch candidates are read through batch_use_by_idx');
select is((select position('raw_lot_expiry_idx' in j::text) > 0 from plans where k = 'lot'), true, 'the lot candidates are read through raw_lot_expiry_idx');
select is((select position('batch_movement_effective_idx' in j::text) > 0 from plans where k = 'discards'), true, 'the discards read goes through batch_movement_effective_idx');
select is((select bool_or(jsonb_path_exists(j, '$.** ? (@."Node Type" == "Seq Scan" && (@."Relation Name" == "batch_movement" || @."Relation Name" == "stock_movement"))')) from plans), false,
          'none of the three reads scans batch_movement or stock_movement sequentially');

select * from finish();
rollback;
