-- M15 step 7: waste_costs, the combined raw + batch waste report in EUR (M15 plan §3.1.9, §3.8; AT2 value, AT6; ADR-014).
-- The hand-computed fixture of §3.8, built with the real procedures: raw waste of onion and carrot, a discard of 3
-- Ragù portions, two staff meals (Ragù and Pane) and a discard from an incomplete-cost Brodo. Fake data only.
--   spoilage        raw onion 0.5 kg x 1.00 = 0.50   + batch 3 x 2.0000 = 6.00   = 6.50
--   staff_meal      raw Pane 0.5 kg x 3.00  = 1.50   + batch 2 x 2.0000 = 4.00   = 5.50
--   expired         raw carrot 0.2 kg x 1.00 = 0.20                              = 0.20
--   over_production batch Brodo 1 portion, cost incomplete -> not valued, unvaluedCount 1
--   total 12.20 = raw 2.20 + batch 10.00
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'kg', true),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Cipolla (demo)', 'kg', true),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Carota (demo)', 'kg', true),
  ('1d000000-0000-4000-8000-00000000001d', '11111111-1111-4111-8111-111111111111', 'Sale grosso (demo)', 'kg', true);
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brodo (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e2', 1, '2026-10-01T00:00Z', 'Brodo (demo)', 5, 'l', 20, 48, 'a1000000-0000-4000-8000-00000000000a');

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
create function pg_temp.as_chef() returns void language sql as $$
  select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef') $$;
create function pg_temp.as_owner() returns void language sql as $$
  select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Europe/Rome')::date $$;
create sequence pg_temp.line_seq;
create function pg_temp.new_line() returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', 1,
      10, 10, '{}', '{}');
  return v_line;
end
$$;
-- A raw lot of 5 kg with its receipt and three purchases at the given price.
create function pg_temp.stock(p_ing uuid, p_code text, p_price numeric) returns void language plpgsql as $$
declare
  v_lot uuid := gen_random_uuid();
begin
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry,
      received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, '11111111-1111-4111-8111-111111111111', p_ing, '10000000-0000-4000-8000-0000000000a1',
      '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(), p_code, null, '2026-10-20', 5, 'kg', 5, 'kg', 1,
      'a1000000-0000-4000-8000-00000000000a');
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type,
      ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_ing, v_lot, '10000000-0000-4000-8000-0000000000a1', 'receipt', 5,
      p_price, 'invoice_line', pg_temp.new_line(), '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
      effective_on, created_by)
    select '11111111-1111-4111-8111-111111111111', p_ing, '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(),
           p_price, 'kg', d, 'a1000000-0000-4000-8000-00000000000a'
      from unnest(array['2026-09-01', '2026-09-02', '2026-09-03']::date[]) d;
end
$$;
-- A batch of 10 portions made now (cost 2.0000 per portion, or incomplete).
create function pg_temp.mkbatch(p_id uuid, p_key text, p_code text, p_seq int, p_missing boolean) returns void language plpgsql as $$
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, state, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', ('ec000000-0000-4000-8000-0000000000' || p_key)::uuid,
      ('ed000000-0000-4000-8000-0000000000d' || right(p_key, 1))::uuid, 1,
      to_char(pg_temp.today(), 'YYMMDD') || '-' || p_code || '-' || p_seq, pg_temp.today(), p_code, p_seq,
      now() - interval '1 hour', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 10, 10, 48,
      now() - interval '1 hour' + interval '48 hours', 'fresh', '10000000-0000-4000-8000-0000000000a1',
      'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, 'produce', 10, 'batch', p_id, pg_temp.today(),
      'a1000000-0000-4000-8000-00000000000a');
  if p_missing then
    insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids,
        cost_at, created_by)
      values (p_id, '11111111-1111-4111-8111-111111111111', null, null, true,
        array['1d000000-0000-4000-8000-00000000001d']::uuid[], now(), 'a1000000-0000-4000-8000-00000000000a');
  else
    insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids,
        cost_at, created_by)
      values (p_id, '11111111-1111-4111-8111-111111111111', 20, 2, false, '{}', now(), 'a1000000-0000-4000-8000-00000000000a');
  end if;
end
$$;
create function pg_temp.keys(j jsonb) returns setof text language sql as $$
  select k from (select jsonb_object_keys(j) k) a
  union all
  select pg_temp.keys(v) from jsonb_each(j) e (k, v) where jsonb_typeof(v) = 'object'
  union all
  select pg_temp.keys(v) from jsonb_each(j) e (k, a), lateral jsonb_array_elements(a) v
   where jsonb_typeof(a) = 'array' and jsonb_typeof(v) = 'object'
$$;
create temporary table res (k text primary key, j jsonb);
grant all on res to authenticated;
grant execute on function pg_temp.err(text), pg_temp.act_as(uuid, uuid, text), pg_temp.as_chef(), pg_temp.as_owner(),
  pg_temp.today(), pg_temp.keys(jsonb) to authenticated;

select pg_temp.stock('1a000000-0000-4000-8000-00000000001a', 'L-PANE', 3);
select pg_temp.stock('1b000000-0000-4000-8000-00000000001b', 'L-CIP', 1);
select pg_temp.stock('1c000000-0000-4000-8000-00000000001c', 'L-CAR', 1);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', 'e1', 'RAGUDE', 1, false);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b2', 'e2', 'BRODOD', 1, true);

-- The fixture, through the real procedures, by the chef.
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'f1', public.post_waste('1b000000-0000-4000-8000-00000000001b', 0.5, 'kg', 'spoilage');
insert into res select 'f2', public.post_waste('1c000000-0000-4000-8000-00000000001c', 0.2, 'kg', 'expired');
insert into res select 'f3', public.discard_batch('ba000000-0000-4000-8000-0000000000b1', 3, 'spoilage');
insert into res select 'f4', public.discard_batch('ba000000-0000-4000-8000-0000000000b2', 1, 'over_production');
insert into res select 'ra', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e1', null, 2);
insert into res select 'rp', public.set_staff_meal_rule(null, '1a000000-0000-4000-8000-00000000001a', 0.5, 'kg');
insert into res select 'f5', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'ra'));
insert into res select 'f6', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'rp'));

-- The report ------------------------------------------------------------------------------------------------------
select pg_temp.as_owner();
insert into res select 'wc', public.waste_costs(pg_temp.today(), pg_temp.today());
insert into res select 'raw', public.raw_waste_costs(pg_temp.today(), pg_temp.today());

select is((select j->>'valueEur' || '/' || (j->>'rawValueEur') || '/' || (j->>'batchValueEur') from res where k = 'wc'),
  '12.2000/2.2000/10.0000', 'AT6: total 12.20 = raw 2.20 + batch 10.00');
select is((select (j->>'unvaluedCount')::int from res where k = 'wc'), 1, 'AT6: one unvalued operation (the Brodo discard)');
select is((select array_agg(x order by x collate "C") from res r, jsonb_object_keys(r.j) x where r.k = 'wc'),
  array['batchValueEur', 'from', 'rawValueEur', 'reasons', 'to', 'unvaluedCount', 'valueEur'], 'the report has its seven top-level keys');
select is((select string_agg(e->>'reasonCode', ',' order by ord) from res r, jsonb_array_elements(r.j->'reasons') with ordinality t (e, ord)
            where r.k = 'wc'), 'spoilage,staff_meal,expired,over_production', 'reasons are ordered by value, then by code');
select is((select e->>'valueEur' || '/' || (e->>'rawValueEur') || '/' || (e->>'batchValueEur')
             from res r, jsonb_array_elements(r.j->'reasons') e where r.k = 'wc' and e->>'reasonCode' = 'spoilage'),
  '6.5000/0.5000/6.0000', 'spoilage: 6.50 = raw 0.50 + batch 6.00');
select is((select b->>'recipeName' || '/' || trim_scale((b->>'portions')::numeric) || '/' || (b->>'valueEur')
             from res r, jsonb_array_elements(r.j->'reasons') e, jsonb_array_elements(e->'batchLines') b
            where r.k = 'wc' and e->>'reasonCode' = 'spoilage'),
  'Ragù (demo)/3/6.0000', 'AT2: the spoilage batch line is Ragù, 3 portions, 3 x 2.0000 = 6.0000');
select is((select e->>'valueEur' || '/' || (e->>'rawValueEur') || '/' || (e->>'batchValueEur')
             from res r, jsonb_array_elements(r.j->'reasons') e where r.k = 'wc' and e->>'reasonCode' = 'staff_meal'),
  '5.5000/1.5000/4.0000', 'staff_meal: 5.50 = raw 1.50 + batch 4.00');
select is((select e->>'valueEur' || '/' || (e->>'rawValueEur') || '/' || (e->>'batchValueEur') || '/' || jsonb_array_length(e->'batchLines')
             from res r, jsonb_array_elements(r.j->'reasons') e where r.k = 'wc' and e->>'reasonCode' = 'expired'),
  '0.2000/0.2000/0.0000/0', 'expired: 0.20, raw only, no batch line');
select is((select b->>'recipeName' || '/' || trim_scale((b->>'portions')::numeric) || '/' || coalesce(b->>'valueEur', 'null')
                  || '/' || (b->'valueEur')::text
             from res r, jsonb_array_elements(r.j->'reasons') e, jsonb_array_elements(e->'batchLines') b
            where r.k = 'wc' and e->>'reasonCode' = 'over_production'),
  'Brodo (demo)/1/null/null', 'over_production: the Brodo line is not valued (null), never 0');
select is((select b->>'unvaluedCount' from res r, jsonb_array_elements(r.j->'reasons') e, jsonb_array_elements(e->'batchLines') b
            where r.k = 'wc' and e->>'reasonCode' = 'over_production'), '1', 'over_production: the Brodo line counts its one unvalued operation');
select is((select b->>'unvaluedCount' from res r, jsonb_array_elements(r.j->'reasons') e, jsonb_array_elements(e->'batchLines') b
            where r.k = 'wc' and e->>'reasonCode' = 'spoilage'), '0', 'spoilage: the fully valued Ragù line counts none');
select is((select e->>'valueEur' || '/' || (e->>'batchValueEur') || '/' || jsonb_array_length(e->'lines')
             from res r, jsonb_array_elements(r.j->'reasons') e where r.k = 'wc' and e->>'reasonCode' = 'over_production'),
  '0.0000/0.0000/0', 'over_production: its total is 0.0000 while the line says "not valued"');
select is((select array_agg(x order by x collate "C") from res r, jsonb_array_elements(r.j->'reasons') e, jsonb_object_keys(e) x
            where r.k = 'wc' and e->>'reasonCode' = 'spoilage'),
  array['batchLines', 'batchValueEur', 'lines', 'rawValueEur', 'reasonCode', 'valueEur'], 'a reason has its six keys');
select is((select array_agg(x order by x collate "C") from res r, jsonb_array_elements(r.j->'reasons') e,
                  jsonb_array_elements(e->'batchLines') b, jsonb_object_keys(b) x
            where r.k = 'wc' and e->>'reasonCode' = 'spoilage'),
  array['portions', 'recipeKey', 'recipeName', 'unvaluedCount', 'valueEur'], 'a batch line has its five keys');

-- The raw side is the M12 report, unchanged ------------------------------------------------------------------------
select is_empty(
  $$ select w.e->>'reasonCode' from res r, jsonb_array_elements(r.j->'reasons') w (e), res m
      where r.k = 'wc' and m.k = 'raw'
        and (w.e->'lines') is distinct from coalesce((select x->'lines' from jsonb_array_elements(m.j->'reasons') x
                                                       where x->>'reasonCode' = w.e->>'reasonCode'), '[]'::jsonb) $$,
  'the raw lines of every reason equal raw_waste_costs');
select is((select (a.j->>'unvaluedCount')::int - (b.j->>'unvaluedCount')::int from res a, res b where a.k = 'wc' and b.k = 'raw'), 1,
  'unvaluedCount = the raw count + 1 batch operation');

-- AT2: the value is frozen -----------------------------------------------------------------------------------------
reset role;
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1d000000-0000-4000-8000-00000000001d',
          '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(), 40, 'kg', pg_temp.today(), 'a1000000-0000-4000-8000-00000000000a');
select is(pg_temp.err($$ update public.batch_cost set unit_cost_frozen = 9 $$), 'P0001 append_only', 'the frozen cost cannot be updated');
set local role authenticated;
select pg_temp.as_owner();
select is(public.waste_costs(pg_temp.today(), pg_temp.today()) = (select j from res where k = 'wc'), true,
  'AT2: after a new price the report is unchanged (the batch value is frozen at production)');

-- Range --------------------------------------------------------------------------------------------------------------
reset role;
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'waste', -1, 'comp', 'batch_discard',
          gen_random_uuid(), pg_temp.today() - 40, 'c1000000-0000-4000-8000-00000000000c');
set local role authenticated;
select pg_temp.as_owner();
select is((public.waste_costs(pg_temp.today() - 10, pg_temp.today())->>'batchValueEur'), '10.0000',
  'a discard dated 40 days ago is outside a 10-day range');
select is((public.waste_costs(pg_temp.today() - 40, pg_temp.today())->>'batchValueEur'), '12.0000',
  'and inside a 40-day range (10.00 + 1 x 2.00)');
select is((select e->>'valueEur' from jsonb_array_elements(public.waste_costs(pg_temp.today() - 40, pg_temp.today())->'reasons') e
            where e->>'reasonCode' = 'comp'), '2.0000', 'the old discard has its own reason line (comp)');
select is(pg_temp.err($$ select public.waste_costs('2026-10-24', '2026-10-23') $$), 'P0001 range_invalid', 'from after to: range_invalid');
select is(pg_temp.err($$ select public.waste_costs(null, '2026-10-23') $$), 'P0001 range_invalid', 'a null date: range_invalid');
select is(pg_temp.err($$ select public.waste_costs('2025-10-23', '2026-10-24') $$), 'P0001 range_too_long', '367 days: range_too_long');
select is(pg_temp.err($$ select public.waste_costs('2025-10-24', '2026-10-24') $$), 'ok', '366 days: allowed');

-- A reason nobody wasted raw still appears from the batch side; an empty day is an empty report
select is((public.waste_costs(pg_temp.today() + 1, pg_temp.today() + 1)->>'valueEur') || '/' || jsonb_array_length(
  public.waste_costs(pg_temp.today() + 1, pg_temp.today() + 1)->'reasons'), '0.0000/0', 'an empty range gives 0.0000 and no reason');

-- Roles and tenancy -------------------------------------------------------------------------------------------------
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err($$ select public.waste_costs(pg_temp.today(), pg_temp.today()) $$), 'ok', 'admin may read the report');
select pg_temp.as_chef();
select is(pg_temp.err($$ select public.waste_costs(pg_temp.today(), pg_temp.today()) $$), '42501 permission denied: costs need owner or admin',
  'chef: 42501');
select is(pg_temp.err($$ select public.waste_costs(null, null) $$), '42501 permission denied: costs need owner or admin',
  'chef: 42501 before any argument check');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$ select public.waste_costs(pg_temp.today(), pg_temp.today()) $$), '42501 permission denied: costs need owner or admin',
  'waiter: 42501');
select pg_temp.act_as('00000000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'none');
select is(pg_temp.err($$ select public.waste_costs(pg_temp.today(), pg_temp.today()) $$) ~ '^42501', true, 'no role: 42501');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((public.waste_costs(pg_temp.today() - 40, pg_temp.today())->>'valueEur') || '/' || (public.waste_costs(pg_temp.today() - 40, pg_temp.today())->>'unvaluedCount'),
  '0.0000/0', 'owner B sees nothing of tenant A');
reset role;

-- One batch with an incomplete cost in a line with complete ones: the valued part still counts -------------------------
-- Ragù A (a new complete batch, 2.00 a portion) discards 5 portions as breakage; Ragù B (incomplete) discards 1.
-- The line is 6 portions worth 5 x 2.00 = 10.00 with one unvalued operation; before the fix the whole line was null.
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b4', 'e1', 'RAGUDE', 2, false);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b3', 'e1', 'RAGUDE', 3, true);
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'g1', public.discard_batch('ba000000-0000-4000-8000-0000000000b4', 5, 'breakage');
insert into res select 'g2', public.discard_batch('ba000000-0000-4000-8000-0000000000b3', 1, 'breakage');
select pg_temp.as_owner();
insert into res select 'mx', public.waste_costs(pg_temp.today(), pg_temp.today());
select is((select b->>'recipeName' || '/' || trim_scale((b->>'portions')::numeric) || '/' || (b->>'valueEur') || '/' || (b->>'unvaluedCount')
             from res r, jsonb_array_elements(r.j->'reasons') e, jsonb_array_elements(e->'batchLines') b
            where r.k = 'mx' and e->>'reasonCode' = 'breakage'),
  'Ragù (demo)/6/10.0000/1', 'a line mixing a complete and an incomplete batch: 6 portions, valued 10.0000, one unvalued operation');
select is((select e->>'valueEur' || '/' || (e->>'batchValueEur') from res r, jsonb_array_elements(r.j->'reasons') e
            where r.k = 'mx' and e->>'reasonCode' = 'breakage'), '10.0000/10.0000',
  'and the reason keeps that value (the complete batch is not dropped)');
select is((select j->>'valueEur' || '/' || (j->>'batchValueEur') || '/' || (j->>'unvaluedCount') from res where k = 'mx'),
  '22.2000/20.0000/2', 'the totals add the valued part (12.20 + 10.00) and count both unvalued operations (Brodo, Ragù B)');
select is((select (e->>'valueEur')::numeric from res r, jsonb_array_elements(r.j->'reasons') e where r.k = 'mx' and e->>'reasonCode' = 'spoilage'),
  6.5::numeric, 'the earlier reasons are unchanged');
select is((select b->>'valueEur' from res r, jsonb_array_elements(r.j->'reasons') e, jsonb_array_elements(e->'batchLines') b
            where r.k = 'mx' and e->>'reasonCode' = 'over_production'), null, 'a line with no valued operation is still null, never 0');
reset role;

-- Shape and grants ---------------------------------------------------------------------------------------------------
select is_empty(
  $$ select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'waste_costs'
        and not (p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""']
                 and has_function_privilege('authenticated', p.oid, 'execute')
                 and not has_function_privilege('anon', p.oid, 'execute')
                 and not has_function_privilege('service_role', p.oid, 'execute')) $$,
  'waste_costs is a stable definer with an empty search_path, executable by authenticated only');
select ok(position('app.require_cost_reader()' in p.prosrc) > 0
    and position('app.require_cost_reader()' in p.prosrc) < position('raw_waste_costs' in p.prosrc),
  'waste_costs checks the cost role before it calls the raw report')
  from pg_proc p where p.proname = 'waste_costs' and p.pronamespace = 'public'::regnamespace;
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'raw_waste_costs'), 1,
  'raw_waste_costs is untouched (still one definition)');

select * from finish();
rollback;
