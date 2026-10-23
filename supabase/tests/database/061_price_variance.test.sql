-- M8 step 8: the price variance check inside approve_invoice (M8 plan §3.1.9, AT4, AT5 at database
-- level). One alert per ingredient per invoice when the new price moves more than the threshold
-- from the moving average of the last N purchases before this invoice; an alert can never undo an
-- approval. Fake data only. Prices are EUR per kg.
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo');
insert into public.supplier (id, tenant_id, name, vat_number, payment_terms_days) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903', 30);
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella');

-- Ingredients 1 Manzo, 2 Farina, 3 Pane (pz), 4 Pollo, 5 Vitello, 6 Agnello, 7 Maiale, 8 Coniglio, 9 Anatra,
-- 10 Oca, 11 Cervo, 12 Quaglia, 13 Fagiano, 14 Vecchio; each with a supplier item.
create function pg_temp.ing(n int) returns uuid language sql immutable as $$
  select ('1a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.item(n int) returns uuid language sql immutable as $$
  select ('51000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
insert into public.ingredient (id, tenant_id, name, base_unit)
  select pg_temp.ing(n), '11111111-1111-4111-8111-111111111111',
         (array['Manzo (demo)', 'Farina (demo)', 'Pane (demo)', 'Pollo (demo)', 'Vitello (demo)', 'Agnello (demo)',
                'Maiale (demo)', 'Coniglio (demo)', 'Anatra (demo)', 'Oca (demo)', 'Cervo (demo)', 'Quaglia (demo)',
                'Fagiano (demo)', 'Vecchio (demo)'])[n],
         case when n = 3 then 'pz'::public.base_unit else 'kg'::public.base_unit end
    from generate_series(1, 14) n;
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty,
    pack_unit, invoice_unit)
  select pg_temp.item(n), '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
         pg_temp.ing(n), 'ART-' || n, 1, 1, case when n = 3 then 'pz'::public.measure_unit else 'kg'::public.measure_unit end,
         case when n = 3 then 'pz' else 'kg' end
    from generate_series(1, 14) n;

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
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
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text) to authenticated;

-- Earlier purchases (price rows hang on a fake invoice, as in 056).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf',
          'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
create function pg_temp.buy(n int, p_ing int, p_price numeric, p_on date, p_unit text default 'kg') returns void language plpgsql as $$
declare
  v_line uuid := ('b2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000f1', n,
      'Acquisto demo', 1, p_price, p_price, '{}', '{}');
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price,
      base_unit, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.ing(p_ing), '5a000000-0000-4000-8000-00000000005a',
      v_line, p_price, p_unit::public.base_unit, p_on, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- 10, 10, 10 on three September days for ingredients 1 and 4 to 13 (not 8: first purchase; 10 gets a later one;
-- flour and bread have their own single purchase below).
select pg_temp.buy(i * 10 + d, i, 10, ('2026-09-0' || d)::date)
  from generate_series(1, 13) i, generate_series(1, 3) d where i not in (2, 3, 8);
select pg_temp.buy(900, 10, 20, '2026-09-20'); -- Oca: a later, dearer purchase already approved

-- Invoices in review: iid(n) with one line of 2 kg of ingredient p_ing at p_price (line lid(n)).
create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$
  select ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.mk_inv(n int, p_date date) returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_vat,
      supplier_name, number_raw, invoice_date, due_date, net_total, vat_total, gross_total, supplier_id)
  values (pg_temp.iid(n), '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.iid(n) || '.pdf', 'application/pdf', 100,
      'review', 'IT12345678903', 'Fornitore Demo Srl', 'FT ' || n, p_date, '2026-12-31', 0, 0, 0,
      '5a000000-0000-4000-8000-00000000005a') $$;
create function pg_temp.mk_line(n int, inv int, pos int, p_ing int, p_price numeric) returns void language sql as $$
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, line_amount, vat_rate,
      unit, ingredient_id, supplier_item_id, mapping_source, is_stock, credit_qty, field_confidence, extracted)
  values (pg_temp.lid(n), '11111111-1111-4111-8111-111111111111', pg_temp.iid(inv), pos, 'Prodotto', 2,
      2 * p_price, 10, 'kg', pg_temp.ing(p_ing), pg_temp.item(p_ing), 'manual', true, 0, '{}', '{}') $$;
create function pg_temp.fix_totals(n int) returns void language sql as $$
  update public.invoice i
     set net_total = s.total, vat_total = round(s.total * 0.1, 2), gross_total = s.total + round(s.total * 0.1, 2)
    from (select sum(line_amount) as total from public.invoice_line where invoice_id = pg_temp.iid(n)) s
   where i.id = pg_temp.iid(n) $$;
-- An approvable invoice of one line.
create function pg_temp.mk(n int, p_ing int, p_price numeric, p_date date default '2026-10-10') returns void language plpgsql as $$
begin
  perform pg_temp.mk_inv(n, p_date);
  perform pg_temp.mk_line(n, n, 1, p_ing, p_price);
  perform pg_temp.fix_totals(n);
end
$$;
create function pg_temp.approve(n int) returns text language sql as $$
  select pg_temp.err(format('select public.approve_invoice(%L)', pg_temp.iid(n))) $$;
-- How many price_variance alerts an invoice raised, and the first one's payload.
create function pg_temp.alerts_of(n int) returns int language sql as $$
  select count(*)::int from public.alert a where a.kind = 'price_variance' and a.payload ->> 'invoice_id' = pg_temp.iid(n)::text $$;
create function pg_temp.payload_of(n int) returns jsonb language sql as $$
  select a.payload from public.alert a where a.kind = 'price_variance' and a.payload ->> 'invoice_id' = pg_temp.iid(n)::text
   order by a.created_at limit 1 $$;
grant execute on function pg_temp.ing(int), pg_temp.alerts_of(int), pg_temp.payload_of(int), pg_temp.approve(int),
  pg_temp.iid(int), pg_temp.lid(int) to authenticated;

select pg_temp.mk(1, 1, 11.10);   -- beef +11 %
select pg_temp.mk(2, 4, 10.90);   -- chicken +9 %
select pg_temp.mk(3, 5, 10.90);   -- veal +9 %, alerts when the threshold is 5
select pg_temp.mk(4, 6, 11.00);   -- lamb exactly +10 %
select pg_temp.mk(5, 7, 8.90);    -- pork -11 %
select pg_temp.mk(6, 8, 14.00);   -- rabbit: first purchase
select pg_temp.mk_inv(7, '2026-10-10');  -- duck: two lines, +12 % and +15 %
select pg_temp.mk_line(71, 7, 1, 9, 11.20);
select pg_temp.mk_line(72, 7, 2, 9, 11.50);
select pg_temp.fix_totals(7);
select pg_temp.mk(8, 10, 11.10, '2026-09-10'); -- goose, dated before an approved dearer purchase
select pg_temp.mk(9, 11, 12.00);  -- venison +20 %, many recipes
select pg_temp.mk(10, 12, 12.00); -- quail: the payload builder is replaced
select pg_temp.mk(11, 13, 12.00); -- pheasant: the check is replaced
select pg_temp.mk(12, 4, 13.00);  -- chicken again: the average now includes invoice 2
select pg_temp.mk(13, 2, 1.50);   -- flour at its usual price: the return value is read

-- Recipes (helpers as in 057/058).
create function pg_temp.k(n int) returns uuid language sql immutable as $$
  select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.v(n int, ver int) returns uuid language sql immutable as $$
  select ('ed000000-0000-4000-8000-' || lpad((n * 100 + ver)::text, 12, '0'))::uuid $$;
create function pg_temp.mkkey(n int, t public.recipe_type, p_name text) returns void language sql as $$
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  values (pg_temp.k(n), '11111111-1111-4111-8111-111111111111', t, 1, lower(p_name), 'a1000000-0000-4000-8000-00000000000a') $$;
create function pg_temp.mkver(n int, ver int, p_from timestamptz, p_name text, oq numeric default null,
    ou public.base_unit default null, ppb int default null) returns void language plpgsql as $$
begin
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
      portions_per_batch, shelf_life_hours, created_by)
    values (pg_temp.v(n, ver), '11111111-1111-4111-8111-111111111111', pg_temp.k(n), ver, p_from, p_name,
      oq, ou, ppb, case when ppb is not null then 72 end, 'a1000000-0000-4000-8000-00000000000a');
  update public.recipe_key set current_version = ver where id = pg_temp.k(n) and current_version < ver;
end
$$;
create function pg_temp.li(n int, ver int, pos int, p_ing int, p_sub int, p_qty numeric,
    p_unit public.recipe_unit) returns void language sql as $$
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.v(n, ver), pos,
          case when p_ing is not null then pg_temp.ing(p_ing) end,
          case when p_sub is not null then pg_temp.k(p_sub) end, p_qty, p_unit, 'a1000000-0000-4000-8000-00000000000a') $$;
create function pg_temp.price(n int, ver int, p_sale numeric, p_target numeric) returns void language sql as $$
  insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
  values (pg_temp.v(n, ver), '11111111-1111-4111-8111-111111111111', p_sale, p_target, 'a1000000-0000-4000-8000-00000000000a') $$;

-- Stew batch (beef 5 kg, 30 portions); plate 4 uses 1 portion + bread (its version 1 used ingredient 14 only);
-- sub Fondo (beef 0.5 kg per kg); plate 17 uses Fondo + flour; plate 18 is unrelated; plate 19 uses beef but is inactive.
select pg_temp.buy(901, 2, 1.50, '2026-09-01');
select pg_temp.buy(902, 3, 0.30, '2026-09-01', 'pz');
select pg_temp.mkkey(2, 'batch', 'Spezzatino (demo)');
select pg_temp.mkver(2, 1, '2026-01-01T00:00Z', 'Spezzatino (demo)', 6, 'kg', 30);
select pg_temp.li(2, 1, 1, 1, null, 5, 'kg');
select pg_temp.mkkey(4, 'plate', 'Spezzatino con polenta (demo)');
select pg_temp.mkver(4, 1, '2026-01-01T00:00Z', 'Spezzatino con polenta (demo)');
select pg_temp.li(4, 1, 1, 14, null, 1, 'kg');
select pg_temp.mkver(4, 2, '2026-02-01T00:00Z', 'Spezzatino con polenta (demo)');
select pg_temp.li(4, 2, 1, null, 2, 1, 'porz');
select pg_temp.li(4, 2, 2, 3, null, 1, 'pz');
select pg_temp.price(4, 2, 12.00, 70);
select pg_temp.mkkey(16, 'sub', 'Fondo (demo)');
select pg_temp.mkver(16, 1, '2026-01-01T00:00Z', 'Fondo (demo)', 1, 'kg');
select pg_temp.li(16, 1, 1, 1, null, 0.5, 'kg');
select pg_temp.mkkey(17, 'plate', 'Piatto con fondo (demo)');
select pg_temp.mkver(17, 1, '2026-01-01T00:00Z', 'Piatto con fondo (demo)');
select pg_temp.li(17, 1, 1, null, 16, 1, 'kg');
select pg_temp.li(17, 1, 2, 2, null, 1, 'kg');
select pg_temp.price(17, 1, 10.00, 75);
select pg_temp.mkkey(18, 'plate', 'Piatto senza manzo (demo)');
select pg_temp.mkver(18, 1, '2026-01-01T00:00Z', 'Piatto senza manzo (demo)');
select pg_temp.li(18, 1, 1, 3, null, 1, 'pz');
select pg_temp.price(18, 1, 5.00, 70);
select pg_temp.mkkey(19, 'plate', 'Piatto spento (demo)');
select pg_temp.mkver(19, 1, '2026-01-01T00:00Z', 'Piatto spento (demo)');
select pg_temp.li(19, 1, 1, 1, null, 1, 'kg');
select pg_temp.price(19, 1, 20.00, 70);
update public.recipe_key set is_active = false where id = pg_temp.k(19);
-- Venison: a sub and 200 plates with 120-character names; the even ones are priced below their target.
select pg_temp.mkkey(50, 'sub', 'Base cervo (demo)');
select pg_temp.mkver(50, 1, '2026-01-01T00:00Z', 'Base cervo (demo)', 1, 'kg');
select pg_temp.li(50, 1, 1, 11, null, 1, 'kg');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  select ('ec000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         'plate', 1, lower(repeat('P', 115) || lpad(i::text, 5, '0')), 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 200) i;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
  select ('ed000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('ec000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid, 1, '2026-01-01T00:00Z',
         repeat('P', 115) || lpad(i::text, 5, '0'), 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 200) i;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', ('ed000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid,
         1, pg_temp.k(50), 0.1, 'kg', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 200) i;
insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
  select ('ed000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         case when i % 2 = 0 then 1.50 else 30.00 end, 70, 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 200) i;

-- Shape and ACL: M5's signature, return value and privileges are unchanged.
select ok(has_function_privilege('authenticated', 'public.approve_invoice(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.approve_invoice(uuid, uuid)', 'execute')
      and not has_function_privilege('service_role', 'public.approve_invoice(uuid, uuid)', 'execute')
      and not has_function_privilege('public', 'public.approve_invoice(uuid, uuid)', 'execute'),
  'approve_invoice keeps its ACL: only authenticated can execute it');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
            where p.oid = 'public.approve_invoice(uuid, uuid)'::regprocedure),
  'and stays SECURITY DEFINER with an empty search_path');
select is_empty(
  $$ select f.fn || ' ' || r.rolname from (values
       ('app.price_variance_check(uuid, uuid)'), ('app.price_variance_candidates(uuid, uuid)'),
       ('app.affected_recipe_keys(uuid, uuid)'),
       ('app.price_variance_payload(uuid, uuid, uuid, numeric, numeric, integer, numeric, numeric)'),
       ('app.lock_recipe_graph_shared(uuid)')) f (fn)
      cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, f.fn, 'execute') $$,
  'no API role can execute the variance helpers');
select ok(position('app.lock_ingredient_costs' in p.prosrc) > position('for update;' in p.prosrc)
      and position('for update;' in p.prosrc) > position('supplier_item si' in p.prosrc)
      and position('app.lock_recipe_graph_shared' in p.prosrc) > position('app.lock_ingredient_costs' in p.prosrc)
      and position('app.lock_recipe_graph_shared' in p.prosrc) < position('app.price_variance_check' in p.prosrc)
      and position('app.price_variance_check' in p.prosrc) < position('exception when others' in p.prosrc),
  'lock order in the source: supplier items, then ingredient costs, then the shared graph lock, then the contained check')
  from pg_proc p where p.oid = 'public.approve_invoice(uuid, uuid)'::regprocedure;
select throws_ok($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'price_variance', 'price_history',
    'e0000000-0000-4000-8000-000000000001', '{}', null, '{chef}') $$, 'P0001', 'alert_audience_cost',
  'price_variance is cost-bearing: a chef audience is refused');
select is((select cost_bearing::text || ' ' || default_audience::text || ' ' || default_severity::text
             from app.alert_kind where kind = 'price_variance'), 'true {owner} warning', 'registered as cost-bearing, owner, warning');
select is((select array_agg(a order by a) from unnest(app.affected_recipe_keys('11111111-1111-4111-8111-111111111111', pg_temp.ing(1))) a),
  array[pg_temp.k(2), pg_temp.k(4), pg_temp.k(16), pg_temp.k(17)],
  'beef reaches the stew, plate 4 through the stew, Fondo and plate 17 through Fondo (not the unrelated plate, not the inactive one)');
select is(app.affected_recipe_keys('11111111-1111-4111-8111-111111111111', pg_temp.ing(14)), '{}'::uuid[],
  'an ingredient used only by a superseded version affects nothing');
select is(app.affected_recipe_keys('11111111-1111-4111-8111-111111111111', pg_temp.ing(12)), '{}'::uuid[],
  'an ingredient used by no recipe affects nothing');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

create temporary table approve_ret (j jsonb);
grant all on approve_ret to authenticated;
insert into approve_ret select public.approve_invoice(pg_temp.iid(13));
select is(pg_temp.alerts_of(13), 0, 'an unchanged price raises no alert');

-- Case 1: beef +11 %.
select is(pg_temp.approve(1), 'ok', 'the +11 % invoice is approved');
select is(pg_temp.alerts_of(1), 1, 'AT5: exactly one price_variance alert');
select is((select a.entity_type || ' ' || (a.entity_id = (select ph.id from public.price_history ph where ph.invoice_line_id = pg_temp.lid(1)))
             from public.alert a where a.kind = 'price_variance'), 'price_history true', 'about the new price row');
select is((select a.audience_roles::text || ' ' || a.cost_bearing::text || ' ' || a.severity::text
             from public.alert a where a.kind = 'price_variance'), '{owner} true warning', 'audience owner, cost-bearing, warning');
select is(pg_temp.payload_of(1) ->> 'change_pct', '11.00', 'change +11 %');
select is(pg_temp.payload_of(1) ->> 'baseline_eur', '10.0000', 'against a baseline of 10');
select is(pg_temp.payload_of(1) ->> 'new_price_eur', '11.1000', 'new price 11.10');
select is(pg_temp.payload_of(1) ->> 'purchases_in_baseline', '3', 'from 3 purchases');
select is(pg_temp.payload_of(1) ->> 'threshold_pct', '10', 'threshold 10');
select is(pg_temp.payload_of(1) ->> 'ingredient_name', 'Manzo (demo)', 'the ingredient is named');
select is(pg_temp.payload_of(1) ->> 'supplier_name', 'Fornitore Demo Srl', 'and the supplier');
select is(pg_temp.payload_of(1) ->> 'invoice_number', 'FT 1', 'and the invoice number');
select is(pg_temp.payload_of(1) ->> 'unit', 'kg', 'and the unit');
select is(pg_temp.payload_of(1) ->> 'recipes_count', '4', 'four recipes are affected (stew, Fondo and the two plates)');
select is(pg_temp.payload_of(1) ->> 'recipes_listed', '4', 'and all are listed');
select is(pg_temp.payload_of(1) #>> '{recipes,0,name}', 'Piatto con fondo (demo)', 'the below-target plate comes first');
select is(pg_temp.payload_of(1) #>> '{recipes,0,status}', 'below_target', 'with status below_target');
select is(jsonb_path_query_array(pg_temp.payload_of(1), '$.recipes[*].type'), '["plate", "plate", "batch", "sub"]'::jsonb,
  'plates first, then batches, then subs');
reset role;
select is((select count(*)::int
             from jsonb_to_recordset((select payload -> 'recipes' from public.alert where kind = 'price_variance')) as e
                    (recipe_key uuid, type text, margin_eur numeric, gp_pct numeric, target_gp_pct numeric, status text)
             join app.plate_cost_rows('11111111-1111-4111-8111-111111111111', null, null, false) p on p.recipe_key = e.recipe_key
            where e.type = 'plate' and e.margin_eur = round(p.gross_margin, 4) and e.gp_pct = round(p.gp_pct, 2)
              and e.status = p.status and e.target_gp_pct = p.target_gp_pct), 2,
  'the plates carry the NEW margin, GP % and status (equal to the plate outputs read after the approval)');
select is((select count(*)::int from jsonb_array_elements((select payload -> 'recipes' from public.alert where kind = 'price_variance')) e
            where e ->> 'type' <> 'plate' and (e ? 'margin_eur' or e ? 'gp_pct')), 0, 'batches and subs carry no margin');
select is((select e ->> 'unit_cost_eur' || ' ' || (e ->> 'cost_unit') from jsonb_array_elements(
    (select payload -> 'recipes' from public.alert where kind = 'price_variance')) e where e ->> 'type' = 'batch'),
  '1.7278 porz', 'the batch carries its new cost per portion: 5 kg x 10.3667 / 30');
-- AT4: the new average is visible in the same transaction, no refresh step.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(public.recipe_cost_at(pg_temp.k(2)) ->> 'totalCostEur', '51.8333',
  'AT4: right after the approval the stew costs 5 x avg(10, 10, 11.10) = 51.8333');
select is(pg_temp.approve(1), 'P0001 invoice_already_approved', 'a second approval is still refused (M5)');
select is(pg_temp.alerts_of(1), 1, 'and raises no second alert');

-- +9 % none; threshold 5 alerts; exactly +10 % none; -11 % alerts; first purchase none.
select is(pg_temp.approve(2), 'ok', 'the +9 % invoice is approved');
select is(pg_temp.alerts_of(2), 0, 'AT5: +9 % raises no alert (threshold 10)');
select public.update_cost_settings('{"price_variance_pct":5}');
select is(pg_temp.approve(3), 'ok', 'threshold 5: the +9 % veal invoice is approved');
select is(pg_temp.alerts_of(3), 1, 'AT5: +9 % now alerts');
select is(pg_temp.payload_of(3) ->> 'threshold_pct', '5', 'with the threshold in the payload');
select public.update_cost_settings('{"price_variance_pct":10}');
select is(pg_temp.approve(4), 'ok', 'the exactly +10 % invoice is approved');
select is(pg_temp.alerts_of(4), 0, 'exactly +10 % is not more than the threshold: no alert');
select is(pg_temp.approve(5), 'ok', 'the -11 % invoice is approved');
select is(pg_temp.alerts_of(5), 1, 'a decrease alerts too');
select is(pg_temp.payload_of(5) ->> 'change_pct', '-11.00', 'with change_pct -11');
select is(pg_temp.approve(6), 'ok', 'the first purchase of an ingredient is approved');
select is(pg_temp.alerts_of(6), 0, 'a first purchase has no baseline: no alert');
select is(pg_temp.payload_of(1) ->> 'recipes_count', '4', 'unrelated approvals did not touch the first alert');

-- Two lines of one ingredient: one alert, the largest change.
select is(pg_temp.approve(7), 'ok', 'the two-line duck invoice is approved');
select is(pg_temp.alerts_of(7), 1, 'two lines of one ingredient raise one alert');
select is(pg_temp.payload_of(7) ->> 'change_pct', '15.00', 'for the +15 % line');
select is((select a.entity_id = (select ph.id from public.price_history ph where ph.invoice_line_id = pg_temp.lid(72))
             from public.alert a where a.payload ->> 'invoice_id' = pg_temp.iid(7)::text), true, 'whose price row is the entity');

-- The baseline is the average in force on the invoice's own date, without this invoice.
select is(pg_temp.approve(8), 'ok', 'the goose invoice dated before a dearer purchase is approved');
select is(pg_temp.payload_of(8) ->> 'baseline_eur', '10.0000', 'its baseline ignores the later purchase at 20 and itself');
select is(pg_temp.payload_of(8) ->> 'change_pct', '11.00', 'so the change is +11 %');
select is(pg_temp.approve(12), 'ok', 'a later chicken invoice at 13.00');
select is(round((pg_temp.payload_of(12) ->> 'baseline_eur')::numeric, 4), 10.3000,
  'the baseline of the next chicken invoice includes the earlier +9 % one: avg(10, 10, 10.90) = 10.30');

-- Many recipes: one alert, bounded.
select is(pg_temp.approve(9), 'ok', 'the venison invoice (+20 %, 201 recipes) is approved');
select is(pg_temp.alerts_of(9), 1, 'one alert');
select is(pg_temp.payload_of(9) ->> 'recipes_count', '201', 'recipes_count is the full count (200 plates and the sub)');
select cmp_ok((pg_temp.payload_of(9) ->> 'recipes_listed')::int, '<=', 20, 'at most 20 are listed');
select is(jsonb_array_length(pg_temp.payload_of(9) -> 'recipes'), (pg_temp.payload_of(9) ->> 'recipes_listed')::int,
  'recipes_listed is the length of the list');
select cmp_ok(octet_length(pg_temp.payload_of(9)::text), '<=', 7680, 'the payload fits the 7 680-byte budget');
select is((select count(*)::int from jsonb_array_elements(pg_temp.payload_of(9) -> 'recipes') e
            where e ->> 'type' = 'plate' and e ->> 'status' = 'below_target'), jsonb_array_length(pg_temp.payload_of(9) -> 'recipes'),
  'the listed recipes are the below-target plates (they come first)');
select cmp_ok((select max(length(e ->> 'name')) from jsonb_array_elements(pg_temp.payload_of(9) -> 'recipes') e), '<=', 80,
  'names are cut to 80 characters');

-- An alert never undoes an approval.
reset role;
create or replace function app.price_variance_payload(p_tenant uuid, p_invoice uuid, p_ingredient uuid,
    p_new_price numeric, p_baseline numeric, p_purchases integer, p_change_pct numeric, p_threshold numeric)
  returns jsonb language sql as $$ select jsonb_build_object('pad', repeat('x', 9000)) $$;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.approve(10), 'ok', 'a 9 KB payload: the invoice is still approved');
reset role;
select is((select status::text from public.invoice where id = pg_temp.iid(10)), 'approved', 'its status is approved');
select is((select count(*)::int from public.payable where invoice_id = pg_temp.iid(10)), 1, 'with its payable');
select is((select count(*)::int from public.raw_lot where invoice_line_id = pg_temp.lid(10)), 1, 'its lot');
select is((select count(*)::int from public.price_history where invoice_line_id = pg_temp.lid(10)), 1, 'and its price row');
select is((select count(*)::int from public.alert where payload ->> 'invoice_id' = pg_temp.iid(10)::text or entity_id in
            (select id from public.price_history where invoice_line_id = pg_temp.lid(10))), 0, 'but no alert');
select is((select code || ' ' || sqlstate || ' ' || caller || ' ' || kind || ' ' || entity_type
             from app.alert_refusal order by id desc limit 1),
  'alert_payload_invalid P0001 approve_invoice price_variance price_history', 'one refusal is recorded');
create or replace function app.price_variance_check(p_tenant uuid, p_invoice uuid) returns integer
  language plpgsql as $$ begin raise division_by_zero; end $$;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.approve(11), 'ok', 'a check that fails with division_by_zero: the invoice is still approved');
reset role;
select is((select status::text from public.invoice where id = pg_temp.iid(11)), 'approved', 'its status is approved');
select is((select count(*)::int from public.payable where invoice_id = pg_temp.iid(11)), 1, 'with its payable');
select is((select count(*)::int from public.price_history where invoice_line_id = pg_temp.lid(11)), 1, 'and its price row');
select is((select code || ' ' || sqlstate || ' ' || caller || ' ' || kind || ' ' || entity_type || ' ' || entity_id
             from app.alert_refusal order by id desc limit 1),
  'check_failed 22012 approve_invoice price_variance invoice ' || pg_temp.iid(11), 'one check_failed refusal with SQLSTATE 22012');

-- M5 return value: unchanged keys.
select is((select array_agg(k order by k) from approve_ret, jsonb_object_keys(approve_ret.j) k),
  array['amount', 'dueDate', 'payableId', 'receipts'], 'the return value keeps its four keys');

select * from finish();
rollback;
