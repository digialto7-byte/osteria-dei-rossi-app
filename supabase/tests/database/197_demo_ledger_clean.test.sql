-- Demo data (ADR-018, plan §3.1.2 and step 11): a tenant filled the way the seed fills the demo (stage and approve invoices, produce
-- batches as the chef, discard, waste, transfer, count and close) leaves the nightly invariant check (app.ledger_checks_body and
-- ledger_invariants_run) clean. Every write goes through the real procedures as the right role; the only raw inserts are the
-- fixtures that need an Auth user (the chef's row). The same check also catches a deliberate break, so "clean" is not vacuous.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ':' || msg;
end
$$;
create function pg_temp.act_as(p_auth uuid, p_tenant uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated',
    'tenant_id', p_tenant, 'app_role', p_role)::text, true)
$$;
create function pg_temp.m(p_key text) returns uuid language plpgsql stable as $$ begin return (select id from pg_temp.mm where k = p_key); end $$;
-- A line as the extraction leaves it.
create function pg_temp.xline(p_code text, p_desc text, p_qty numeric, p_unit text, p_price numeric, p_lot text, p_expiry date) returns jsonb language sql as $$
  select jsonb_build_object('raw_description', p_desc, 'supplier_code', p_code, 'qty', p_qty, 'unit_raw', p_unit, 'unit_price', p_price,
    'line_amount', round(p_qty * p_price, 4), 'vat_rate', 10, 'lot_code', p_lot, 'expiry', p_expiry, 'field_confidence', '{}'::jsonb,
    'checks', '[]'::jsonb, 'extracted', jsonb_build_object('description', p_desc, 'supplier_code', p_code, 'qty', p_qty, 'unit', p_unit,
      'unit_price', p_price, 'line_amount', round(p_qty * p_price, 4), 'vat_rate', 10, 'lot_code', p_lot, 'expiry', p_expiry))
$$;
create function pg_temp.xres(p_vat text, p_name text, p_number text, p_date date, p_net numeric, p_lines jsonb) returns jsonb language sql as $$
  select jsonb_build_object('header', jsonb_build_object('supplier_vat', p_vat, 'supplier_name', p_name, 'number_raw', p_number,
      'invoice_date', p_date, 'due_date', p_date + 30, 'payment_terms', '30 giorni', 'net_total', p_net, 'vat_total', round(p_net * 0.1, 2),
      'gross_total', p_net + round(p_net * 0.1, 2)),
    'lines', p_lines, 'gate_flags', '[]'::jsonb, 'totals_diff', 0, 'field_confidence', '{}'::jsonb, 'extraction_json', '{}'::jsonb)
$$;

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-0000000000f1', 'owner-d@example.test'),
  ('d0000000-0000-4000-8000-0000000000d1', 'owner-demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'admin-demo@example.test'),
  ('c0000000-0000-4000-8000-0000000000c1', 'staff-c1@staff.invalid');
select public.create_tenant_with_owner('Locale Tre (demo)', 'IT00000000099', 'f0000000-0000-4000-8000-0000000000f1', 'Titolare Tre (demo)');
select public.begin_demo_data((select id from public.tenant where vat_number = 'IT00000000099'), 'd0000000-0000-4000-8000-0000000000d1', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d2', 'Supporto DigiAlto (demo)');
create temp table ctx as
  select t.id as tenant, (select u.id from public.app_user u where u.tenant_id = t.id and u.auth_id = 'd0000000-0000-4000-8000-0000000000d1') as owner_user
    from public.tenant t where t.demo_data_since is not null;
grant select on ctx to public;
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method)
  select 'c1000000-0000-4000-8000-0000000000c1', tenant, 'c0000000-0000-4000-8000-0000000000c1', 'chef', 'Chef Bruno (demo)', 'pin' from ctx;

-- The owner: master data (two locations, two suppliers, three ingredients).
set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-0000000000d1', (select tenant from ctx), 'owner');
insert into public.location (name) values ('Cella frigo (demo)'), ('Dispensa (demo)');
insert into public.supplier (name, vat_number, payment_terms_days) values
  ('Macelleria Fittizia (demo)', 'IT00000001016', 30),
  ('Latteria Immaginaria (demo)', 'IT00000001032', 30);
insert into public.ingredient (name, base_unit) values
  ('Manzo macinato (demo)', 'kg'),
  ('Uova (demo)', 'pz'),
  ('Latte intero (demo)', 'l');
create temp table mm (k text primary key, id uuid not null);
grant all on mm to public;
insert into mm select 'cella', id from public.location where name = 'Cella frigo (demo)';
insert into mm select 'dispensa', id from public.location where name = 'Dispensa (demo)';
insert into mm select 'manzo', id from public.ingredient where name = 'Manzo macinato (demo)';
insert into mm select 'uova', id from public.ingredient where name = 'Uova (demo)';
insert into mm select 'latte', id from public.ingredient where name = 'Latte intero (demo)';
reset role;

-- The service role stages two invoices; the owner maps the lines and approves them.
set local role service_role;
select pg_temp.err(format($f$ select public.demo_stage_invoice(%L, '11000000-0000-4000-8000-000000000001', %L, 4096, %L, %L::jsonb) $f$,
  (select tenant from ctx), (select tenant from ctx) || '/' || to_char(current_date, 'YYYY') || '/11000000-0000-4000-8000-000000000001.pdf', (select owner_user from ctx),
  pg_temp.xres('IT00000001016', 'Macelleria Fittizia (demo)', 'DEMO-F1', current_date - 3, 98,
    jsonb_build_array(pg_temp.xline('MAN-10', 'Manzo macinato (demo)', 10, 'kg', 9.8, null, null))))) as staged_one \gset
select pg_temp.err(format($f$ select public.demo_stage_invoice(%L, '11000000-0000-4000-8000-000000000002', %L, 4096, %L, %L::jsonb) $f$,
  (select tenant from ctx), (select tenant from ctx) || '/' || to_char(current_date, 'YYYY') || '/11000000-0000-4000-8000-000000000002.pdf', (select owner_user from ctx),
  pg_temp.xres('IT00000001032', 'Latteria Immaginaria (demo)', 'DEMO-F2', current_date - 2, 10.6,
    jsonb_build_array(pg_temp.xline('UOV-18', 'Uova (demo)', 18, 'pz', 0.3, null, null),
                      pg_temp.xline('LAT-04', 'Latte intero (demo)', 4, 'l', 1.3, 'L-01', current_date + 1))))) as staged_two \gset
reset role;
select is(:'staged_one'::text, 'ok', 'the first invoice is staged');
select is(:'staged_two'::text, 'ok', 'the second invoice is staged');

set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-0000000000d1', (select tenant from ctx), 'owner');
select public.review_update_line('11000000-0000-4000-8000-000000000001', l.id, jsonb_build_object('ingredient_id', pg_temp.m('manzo')))
  from public.invoice_line l where l.invoice_id = '11000000-0000-4000-8000-000000000001' and l.supplier_code = 'MAN-10';
select public.review_update_line('11000000-0000-4000-8000-000000000002', l.id,
         jsonb_build_object('ingredient_id', case l.supplier_code when 'UOV-18' then pg_temp.m('uova') else pg_temp.m('latte') end)::jsonb)
  from public.invoice_line l where l.invoice_id = '11000000-0000-4000-8000-000000000002';
select is(pg_temp.err($$ select public.approve_invoice('11000000-0000-4000-8000-000000000001', pg_temp.m('cella')) $$), 'ok', 'the owner approves the first invoice into the cold room');
select is(pg_temp.err($$ select public.approve_invoice('11000000-0000-4000-8000-000000000002', pg_temp.m('cella')) $$), 'ok', 'and the second');
-- A batch recipe: 8 kg, 40 portions, 72 hours, from beef and milk.
create temp table made (key uuid);
grant all on made to public;
insert into made select (public.create_recipe('batch', jsonb_build_object('name', 'Ragù di manzo (demo)', 'outputQty', 8, 'outputUnit', 'kg',
  'portionsPerBatch', 40, 'shelfLifeHours', 72, 'lines', jsonb_build_array(
    jsonb_build_object('ingredientId', pg_temp.m('manzo'), 'qty', 5, 'unit', 'kg'),
    jsonb_build_object('ingredientId', pg_temp.m('latte'), 'qty', 1, 'unit', 'l')))) ->> 'key')::uuid;
reset role;

-- The chef (through the claims a PIN login leaves): two productions from the proposal, a discard, a split, waste, a transfer, a count.
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-0000000000c1', (select tenant from ctx), 'chef');
create temp table batches (n int, id uuid);
grant all on batches to public;
insert into batches
  select n, (public.produce_batch(
      (public.batch_proposal((select key from made), 8, null) -> 'recipe' ->> 'id')::uuid, 8,
      (select jsonb_agg(jsonb_build_object('ingredientId', i ->> 'ingredientId', 'qty', (i ->> 'proposedQty')::numeric, 'unit', i ->> 'baseUnit',
                                           'locationId', pg_temp.m('cella')))
         from jsonb_array_elements(public.batch_proposal((select key from made), 8, null) -> 'inputs') i
        where (i ->> 'isStock')::boolean),
      null, null, pg_temp.m('cella')) ->> 'batchId')::uuid
    from generate_series(1, 2) n;
select is((select count(*)::int from batches), 2, 'the chef produces two batches');
select is(pg_temp.err(format($f$ select public.discard_batch(%L, 6, 'breakage') $f$, (select id from batches where n = 2))), 'ok', 'discards 6 portions');
select is(pg_temp.err(format($f$ select public.split_batch(%L, 20, 48, pg_temp.m('cella')) $f$, (select id from batches where n = 1))), 'ok', 'splits 20 portions into a new lot');
select is(pg_temp.err($$ select public.post_waste(pg_temp.m('latte'), 0.5, 'l', 'spoilage', pg_temp.m('cella'), null) $$), 'ok', 'wastes 0,5 l of milk');
select is(pg_temp.err($$ select public.post_transfer(pg_temp.m('uova'), 6, 'pz', pg_temp.m('cella'), pg_temp.m('dispensa'), null) $$), 'ok', 'moves 6 eggs to the dispensa');
select public.set_ingredient_critical(pg_temp.m('manzo'), true);
create temp table session (id uuid);
grant all on session to public;
insert into session select (public.count_start('daily', pg_temp.m('cella')) ->> 'id')::uuid;
select public.count_record_lines((select id from session), jsonb_build_array(jsonb_build_object('ingredient_id', pg_temp.m('manzo'), 'qty', 7.6, 'unit', 'kg')));
select is(pg_temp.err(format($f$ select public.count_close(%L) $f$, (select id from session))), 'ok', 'counts the beef at 7,6 against 8,0 expected and closes');
reset role;

-- The nightly check ------------------------------------------------------------------------------------------------------------------------
select is_empty($$ select * from app.ledger_checks_body((select tenant from ctx), now()) $$, 'app.ledger_checks_body finds nothing on the filled tenant');
set local role service_role;
select is(pg_temp.err($$ select public.ledger_invariants_run(now()) $$), 'ok', 'the nightly run succeeds');
reset role;
select is((select count(*)::int from public.alert where kind = 'ledger_drift'), 0, 'and raises no ledger_drift for the tenant');

-- Not vacuous: break a lot behind the ledger's back (the table owner switches its append-only guard off inside this rolled-back
-- transaction) and the same check sees it.
alter table public.stock_movement disable trigger stock_movement_append_only;
delete from public.stock_movement where type::text = 'receipt' and tenant_id = (select tenant from ctx) and ref_id = (select id from public.invoice_line where invoice_id = '11000000-0000-4000-8000-000000000001' limit 1);
alter table public.stock_movement enable trigger stock_movement_append_only;
select isnt_empty($$ select * from app.ledger_checks_body((select tenant from ctx), now()) $$, 'a lot whose receipt is gone is reported by the same check');

select * from finish();
rollback;
