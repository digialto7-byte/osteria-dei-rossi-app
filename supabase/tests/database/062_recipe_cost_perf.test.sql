-- M8 step 9 (T4): the cost reads and the variance check stay fast on a diamond ladder, as 054 does for
-- the M7 walks. L = 10 layers of W = 4 subs, each sub using all 4 subs of the next layer and 1 kg of
-- ingredient 901, a plate on top (4^10 paths, 41 recipes), plus 200 plates that each use 0.1 kg of a
-- top-layer sub and 0.05 kg of ingredient 901. A walk that enumerates paths does not finish; every step
-- below runs under a 5 s statement limit (the `authenticated` role stops at 8 s on the real stack).
-- Cost of one kg of a layer-i sub: c(i) = P + 0.4 c(i+1), c(10) = P, so c(1) = P (1 - 0.4^10) / 0.6 and the
-- top plate costs 0.4 c(1); P is the cost of ingredient 901.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-000000000901', '11111111-1111-4111-8111-111111111111', 'Sale (demo)', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number, payment_terms_days) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903', 30);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty,
    pack_unit, invoice_unit) values
  ('51000000-0000-4000-8000-000000000901', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
   '1a000000-0000-4000-8000-000000000901', 'SAL-1', 1, 1, 'kg', 'kg');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- 'ok', or 'SQLSTATE message' (57014 is the statement timeout).
create function pg_temp.run(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when query_canceled or others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.val(stmt text) returns text language plpgsql as $$
declare
  out text;
begin
  execute stmt into out;
  return out;
exception when query_canceled or others then
  return sqlstate || ' ' || sqlerrm;
end
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.run(text), pg_temp.val(text) to authenticated;

-- Three earlier purchases of ingredient 901 at 10.00 (their price rows hang on a fake invoice).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf',
          'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount,
    field_confidence, extracted)
  select ('b2000000-0000-4000-8000-' || lpad(d::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         '00000000-0000-4000-8000-0000000000f1', d, 'Acquisto demo', 1, 10, 10, '{}', '{}'
    from generate_series(1, 3) d;
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
    effective_on, created_by)
  select '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000901',
         '5a000000-0000-4000-8000-00000000005a', ('b2000000-0000-4000-8000-' || lpad(d::text, 12, '0'))::uuid, 10, 'kg',
         ('2026-09-0' || d)::date, 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 3) d;

-- The invoice that moves ingredient 901 by +20 % (12.00 against 10.00).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_vat, supplier_name,
    number_raw, invoice_date, due_date, net_total, vat_total, gross_total, supplier_id)
  values ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000001.pdf', 'application/pdf', 100,
    'review', 'IT12345678903', 'Fornitore Demo Srl', 'FT 1', '2026-10-10', '2026-12-31', 24, 2.4, 26.4,
    '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, line_amount, vat_rate, unit,
    ingredient_id, supplier_item_id, mapping_source, is_stock, credit_qty, field_confidence, extracted)
  values ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-000000000001', 1, 'Sale', 2, 24, 10, 'kg', '1a000000-0000-4000-8000-000000000901',
    '51000000-0000-4000-8000-000000000901', 'manual', true, 0, '{}', '{}');

-- The ladder. Key and version ids: layer i, sub j -> 100 + 10 i + j; top plate 100; extra plates 1000 + n.
create function pg_temp.kid(n int) returns uuid language sql immutable as $$
  select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.rid(n int) returns uuid language sql immutable as $$
  select ('ed000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
set local statement_timeout = '120s';
create temporary table ladder as
  select 100 + 10 * i + j as n, i, j from generate_series(1, 10) i, generate_series(1, 4) j;
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  select pg_temp.kid(n), '11111111-1111-4111-8111-111111111111'::uuid, 'sub'::public.recipe_type, 1,
         'strato ' || i || '/' || j || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'::uuid from ladder
  union all select pg_temp.kid(100), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto diamante (demo)',
         'a1000000-0000-4000-8000-00000000000a'
  union all select pg_temp.kid(1000 + n), '11111111-1111-4111-8111-111111111111', 'plate', 1,
         'piatto extra ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 200) n;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by)
  select pg_temp.rid(n), '11111111-1111-4111-8111-111111111111', pg_temp.kid(n), 1, '2026-01-01T00:00Z',
         'Strato ' || i || '/' || j || ' (demo)', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a' from ladder;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
  select pg_temp.rid(100), '11111111-1111-4111-8111-111111111111'::uuid, pg_temp.kid(100), 1, '2026-01-01T00:00Z'::timestamptz,
         'Piatto diamante (demo)', 'a1000000-0000-4000-8000-00000000000a'::uuid
  union all select pg_temp.rid(1000 + n), '11111111-1111-4111-8111-111111111111', pg_temp.kid(1000 + n), 1,
         '2026-01-01T00:00Z', 'Piatto extra ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 200) n;
-- Every sub: 1 kg of ingredient 901 (position 1) and 0.1 kg of each sub of the next layer (positions 2 to 5).
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', pg_temp.rid(n), 1, '1a000000-0000-4000-8000-000000000901', 1, 'kg',
         'a1000000-0000-4000-8000-00000000000a' from ladder;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', pg_temp.rid(a.n), 1 + b.j, pg_temp.kid(100 + 10 * (a.i + 1) + b.j), 0.1,
         'kg', 'a1000000-0000-4000-8000-00000000000a'
    from ladder a join ladder b on b.i = a.i + 1;
-- The top plate: 0.1 kg of each top-layer sub. Extra plates: 0.1 kg of sub 111 and 0.05 kg of ingredient 901.
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', pg_temp.rid(100), j, pg_temp.kid(110 + j), 0.1, 'kg',
         'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 4) j;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, ingredient_id, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111'::uuid, pg_temp.rid(1000 + n), 1, pg_temp.kid(111), null::uuid, 0.1,
         'kg'::public.recipe_unit, 'a1000000-0000-4000-8000-00000000000a'::uuid from generate_series(1, 200) n
  union all select '11111111-1111-4111-8111-111111111111', pg_temp.rid(1000 + n), 2, null,
         '1a000000-0000-4000-8000-000000000901', 0.05, 'kg', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 200) n;
-- Prices: the top plate 30.00 (target 70); even extra plates 3.00 (below target), odd ones 30.00.
insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
  select pg_temp.rid(100), '11111111-1111-4111-8111-111111111111'::uuid, 30, 70, 'a1000000-0000-4000-8000-00000000000a'::uuid
  union all select pg_temp.rid(1000 + n), '11111111-1111-4111-8111-111111111111', case when n % 2 = 0 then 3 else 30 end,
         70, 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 200) n;

select is((select count(*)::int from public.recipe_key), 241, 'the ladder is built: 40 subs, the top plate and 200 plates');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local statement_timeout = '5s';

select is(pg_temp.val(format('select public.recipe_cost_at(%L) ->> %L', pg_temp.kid(100), 'totalCostEur')),
  round(0.4 * 10 * (1 - power(0.4::numeric, 10)) / 0.6, 4)::text,
  'recipe_cost_at of the top plate answers within 5 s with the hand-computed cost (P = 10)');
select is(pg_temp.val(format('select public.recipe_cost_at(%L) ->> %L', pg_temp.kid(111), 'unitCostEur')),
  round(10 * (1 - power(0.4::numeric, 10)) / 0.6, 4)::text, 'so does a top-layer sub: P (1 - 0.4^10) / 0.6');
select is(pg_temp.val(format('select public.recipe_cost_at(%L) ->> %L', pg_temp.kid(204), 'unitCostEur')),
  '10.0000', 'and a bottom-layer sub: P');
select is(pg_temp.val(format('select public.recipe_cost_at(%L) #>> %L', pg_temp.kid(100), '{plate,status}')),
  'fixed_cost_unallocated', 'the plate outputs of the top plate are there too');
select is(pg_temp.val('select count(*) from public.v_recipe_cost'), '241', 'v_recipe_cost lists all 241 recipes within 5 s');
select is(pg_temp.val('select count(*) from public.v_recipe_cost where incomplete'), '0', 'none incomplete');
select is(pg_temp.val('select count(*) from public.plate_costs()'), '201', 'plate_costs lists 201 plates within 5 s');
select is(pg_temp.val('select count(*) from public.plate_costs() where status = ''below_target'''), '100',
  'the 100 cheap ones are below target');
select is(pg_temp.val('select count(*) from public.plate_margins_pct()'), '201', 'plate_margins_pct lists 201 plates within 5 s');
select is(pg_temp.val('select count(*) from public.ingredient_costs()'), '1', 'ingredient_costs answers');

-- The approval that moves ingredient 901 by +20 %, reaching all 241 recipes, under the same limit.
select is(pg_temp.run(format('select public.approve_invoice(%L)', '00000000-0000-4000-8000-000000000001')), 'ok',
  'T4: the approval (+20 %, 241 affected recipes) commits within 5 s');
reset role;
select is((select count(*)::int from public.alert where kind = 'price_variance'), 1, 'with one alert');
select cmp_ok((select octet_length(payload::text) from public.alert where kind = 'price_variance'), '<=', 7680,
  'whose payload fits the 7 680-byte budget');
select is((select payload ->> 'recipes_count' from public.alert where kind = 'price_variance'), '241',
  'it counts all 241 affected recipes');
select cmp_ok((select (payload ->> 'recipes_listed')::int from public.alert where kind = 'price_variance'), '<=', 20,
  'and lists at most 20');
select is((select payload #>> '{recipes,0,status}' from public.alert where kind = 'price_variance'), 'below_target',
  'starting with a below-target plate');
select is((select count(*)::int from public.alert where kind = 'price_variance'
             and payload ->> 'change_pct' = '20.0000' and payload ->> 'baseline_eur' = '10.0000'), 1, 'change +20 % against 10');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local statement_timeout = '5s';
select is(pg_temp.val(format('select public.recipe_cost_at(%L) ->> %L', pg_temp.kid(100), 'totalCostEur')),
  round(0.4 * (32.0 / 3) * (1 - power(0.4::numeric, 10)) / 0.6, 4)::text,
  'after the approval the top plate uses the new average (10, 10, 12 gives 10.6667)');
reset role;

select * from finish();
rollback;
