-- M8 review fix 2: each ingredient's alert is built and raised in its own block. One invoice moves two
-- ingredients by +20 %. Ingredient A reaches 1 001 active recipes, so building its payload fails
-- (app.recipe_costs refuses more than 1 000 keys: too_many_keys, a legitimate failure). Ingredient B
-- reaches one plate. B's alert must survive A's failure, A's failure is recorded as check_failed for A's
-- price row only, and the approval commits.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.supplier (id, tenant_id, name, vat_number, payment_terms_days) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903', 30);
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella');
-- Ingredient 1 (A, many recipes) and 2 (B, one plate).
insert into public.ingredient (id, tenant_id, name, base_unit)
  select ('1a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         (array['Sale (demo)', 'Pepe (demo)'])[n], 'kg' from generate_series(1, 2) n;
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty,
    pack_unit, invoice_unit)
  select ('51000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         '5a000000-0000-4000-8000-00000000005a', ('1a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         'ART-' || n, 1, 1, 'kg', 'kg' from generate_series(1, 2) n;

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

-- Three earlier purchases at 10.00 of each ingredient (their price rows hang on a fake invoice).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf',
          'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
    line_amount, field_confidence, extracted)
  select ('b2000000-0000-4000-8000-' || lpad((i * 10 + d)::text, 12, '0'))::uuid,
         '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000f1', i * 10 + d,
         'Acquisto demo', 1, 10, 10, '{}', '{}'
    from generate_series(1, 2) i, generate_series(1, 3) d;
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
    effective_on, created_by)
  select '11111111-1111-4111-8111-111111111111', ('1a000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         '5a000000-0000-4000-8000-00000000005a',
         ('b2000000-0000-4000-8000-' || lpad((i * 10 + d)::text, 12, '0'))::uuid, 10, 'kg',
         ('2026-09-0' || d)::date, 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 2) i, generate_series(1, 3) d;

-- The invoice: 2 kg of A and 2 kg of B at 12.00 (+20 % each).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_vat, supplier_name,
    number_raw, invoice_date, due_date, net_total, vat_total, gross_total, supplier_id)
  values ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000001.pdf', 'application/pdf', 100,
    'review', 'IT12345678903', 'Fornitore Demo Srl', 'FT 1', '2026-10-10', '2026-12-31', 48, 4.8, 52.8,
    '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, line_amount, vat_rate,
    unit, ingredient_id, supplier_item_id, mapping_source, is_stock, credit_qty, field_confidence, extracted)
  select ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         '00000000-0000-4000-8000-000000000001', n, 'Prodotto', 2, 24, 10, 'kg',
         ('1a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         ('51000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'manual', true, 0, '{}', '{}'
    from generate_series(1, 2) n;

-- Recipes, as the table owner: 1 001 plates with 1 kg of A, one plate with 1 kg of B.
create temporary table plates as
  select n, ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as kid,
         ('ed000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as rid,
         case when n = 1002 then 2 else 1 end as ing
    from generate_series(1, 1002) n;
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  select kid, '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto ' || n || ' (demo)',
         'a1000000-0000-4000-8000-00000000000a' from plates;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
  select rid, '11111111-1111-4111-8111-111111111111', kid, 1, '2026-01-01T00:00Z', 'Piatto ' || n || ' (demo)',
         'a1000000-0000-4000-8000-00000000000a' from plates;
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', rid, 1,
         ('1a000000-0000-4000-8000-' || lpad(ing::text, 12, '0'))::uuid, 1, 'kg',
         'a1000000-0000-4000-8000-00000000000a' from plates;

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select count(*)::int from public.recipe_key), 1002, 'the fixture is built: 1 001 plates on A, one on B');
select is(pg_temp.err(format('select public.approve_invoice(%L)', '00000000-0000-4000-8000-000000000001')), 'ok',
  'the approval commits although the payload of one ingredient cannot be built');
reset role;
select is((select status::text from public.invoice where id = '00000000-0000-4000-8000-000000000001'), 'approved',
  'the invoice is approved');
select is((select count(*)::int from public.payable where invoice_id = '00000000-0000-4000-8000-000000000001'), 1,
  'with its payable');
select is((select count(*)::int from public.price_history ph join public.invoice_line il on il.id = ph.invoice_line_id
            where il.invoice_id = '00000000-0000-4000-8000-000000000001'), 2, 'and both price rows');
select is((select count(*)::int from public.alert where kind = 'price_variance'), 1,
  'exactly one alert is stored: the other ingredient''s alert was not rolled back');
select is((select payload ->> 'ingredient_id' from public.alert where kind = 'price_variance'),
  '1a000000-0000-4000-8000-000000000002', 'it is the one for ingredient B');
select is((select payload ->> 'recipes_count' from public.alert where kind = 'price_variance'), '1',
  'listing its one plate');
select is((select count(*)::int from app.alert_refusal), 1, 'exactly one refusal is recorded');
select is((select r.code || ' ' || r.sqlstate || ' ' || r.caller || ' ' || r.kind || ' ' || r.entity_type
             from app.alert_refusal r), 'check_failed P0001 approve_invoice price_variance price_history',
  'it is a check_failed refusal on a price row, with the SQLSTATE of the failure');
select is((select r.entity_id from app.alert_refusal r),
  (select ph.id from public.price_history ph where ph.ingredient_id = '1a000000-0000-4000-8000-000000000001'
      and ph.invoice_line_id = 'a2000000-0000-4000-8000-000000000001'),
  'and the price row is ingredient A''s');
select is((select count(*)::int from public.raw_lot where invoice_line_id in
            ('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002')), 2,
  'both lots are received');

select * from finish();
rollback;
