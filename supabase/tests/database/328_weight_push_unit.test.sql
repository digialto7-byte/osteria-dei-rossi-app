-- P2-0b review fix (money): a running push must not survive a switch of the price unit. The push price is in the unit of the menu price it was
-- compared with at the start, so update_menu_item refuses portion <-> etto while a push is in force (P0001 push_active) and add_order_line never reads
-- a push price in the wrong unit. Also: a push on a weighted dish is per etto and is compared with the per-etto menu price (push_price_above_menu).
-- Owner sets the menu and the push, the waiter orders. Fake data only; items and lines found by id.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{"sale_vat_pct": 10}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4,
   'a1000000-0000-4000-8000-00000000000a', '1998-10-24', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true) $$;
create function pg_temp.as_owner() returns void language sql as $$ select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_waiter() returns void language sql as $$ select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter') $$;
create function pg_temp.ts() returns text language sql as $$
  select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
create function pg_temp.line_id(n int) returns uuid language sql immutable as $$ select ('e3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to public;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from ids where ids.k = $1 $$;
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
create function pg_temp.upd_item(p_k text, p_patch text) returns text language sql as $$
  select pg_temp.err(format($f$ select public.update_menu_item(%L, %L::jsonb) $f$, pg_temp.id(p_k), p_patch)) $$;
create function pg_temp.push(p_k text, p_body text) returns text language sql as $$
  select pg_temp.err(format($f$ select public.push_menu_item(%L, %L::jsonb) $f$, pg_temp.id(p_k), p_body)) $$;
create function pg_temp.add(p_line int, p_item text, p_extra text default '') returns text language sql as $$
  select pg_temp.err(format($f$ select public.add_order_line('14000000-0000-4000-8000-000000000001', %L::jsonb) $f$,
    '{"lineId":"' || pg_temp.line_id(p_line) || '","menuItemId":"' || pg_temp.id(p_item) || '","clientUpdatedAt":"' || pg_temp.ts() || '"' || p_extra || '}')) $$;
create function pg_temp.row_of(n int) returns text language sql as $$
  select coalesce(weight_g::text, '-') || '/' || coalesce(price_per_100g::text, '-') || '/' || qty || '/' || unit_price || '/' || price_source
    from public.order_line where id = pg_temp.line_id(n) $$;
-- What the item is now: unit, price in force, name, push, and how many price rows and audit rows it has.
create function pg_temp.state_of(p_k text) returns text language sql as $$
  select t.price_unit || '/' || trim_scale(t.price) || '/' || i.name || '/' || coalesce(trim_scale(i.push_price)::text, '-') || '/'
         || (i.push_until > clock_timestamp()) || '/'
         || (select count(*) from public.menu_item_price p where p.menu_item_id = i.id) || '/'
         || (select count(*) from public.audit_event a where a.entity_id = i.id and a.action = 'menu_item.updated')
    from public.menu_item i, lateral app.menu_item_sale_terms_at(i.tenant_id, array[i.id], clock_timestamp()) t
   where i.id = pg_temp.id(p_k) $$;

select pg_temp.as_owner();
insert into ids select 'p1', (public.create_menu_item('{"name":"Tagliatelle (demo)","category":"Primi","course":"primi","recipeKey":null,"price":14,"vatRate":10}'::jsonb) -> 'item' ->> 'id')::uuid;
insert into ids select 'w1', (public.create_menu_item('{"name":"Bistecca a peso (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":4.25,"vatRate":10,"priceUnit":"etto","portionWeightG":400}'::jsonb) -> 'item' ->> 'id')::uuid;

-- Portion -> etto during a push ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.push('p1', '{"pushed":true,"pushPrice":12}'), 'ok', 'the owner pushes the 14,00 portion dish at 12,00');
select is(pg_temp.state_of('p1'), 'portion/14/Tagliatelle (demo)/12/true/1/0', 'state before: portion, 14, push 12, one price row, no update audit');
select is(pg_temp.upd_item('p1', '{"priceUnit":"etto","price":4.25,"portionWeightG":400}'), 'P0001 push_active', 'switching to etto while the push runs is refused');
select is(pg_temp.state_of('p1'), 'portion/14/Tagliatelle (demo)/12/true/1/0', 'and nothing changed: unit, price, push, price rows and audit are as before');
select is((select count(*) from public.menu_item_price where menu_item_id = pg_temp.id('p1') and portion_weight_g is not null), 0::bigint, 'the reference portion weight was not written either');
select is(pg_temp.upd_item('p1', '{"priceUnit":"etto"}'), 'P0001 price_required', 'a switch without a price is still price_required (the earlier check)');
-- Other edits during the push are as before.
select is(pg_temp.upd_item('p1', '{"name":"Tagliatelle al ragu (demo)"}'), 'ok', 'a name edit during the push is accepted');
select is(pg_temp.upd_item('p1', '{"price":13}'), 'ok', 'a price edit in the same unit during the push is accepted');
select is(pg_temp.upd_item('p1', '{"priceUnit":"portion","price":13.5}'), 'ok', 'naming the same unit again is not a switch');
select is(pg_temp.state_of('p1'), 'portion/13.5/Tagliatelle al ragu (demo)/12/true/3/3', 'the push is untouched by them: still 12, three price rows, three update audits');
select pg_temp.as_waiter();
select is(pg_temp.add(1, 'p1'), 'ok', 'add during the push');
select is(pg_temp.row_of(1), '-/-/1.0/12.00/push', 'a portion costs the 12,00 push price');
-- After the push stops, the switch works and the next add uses the new unit's price.
select pg_temp.as_owner();
select is(pg_temp.push('p1', '{"pushed":false}'), 'ok', 'the push is stopped');
select is(pg_temp.upd_item('p1', '{"priceUnit":"etto","price":4.25,"portionWeightG":400}'), 'ok', 'now the switch to etto at 4,25 with 400 g succeeds');
select pg_temp.as_waiter();
select is(pg_temp.add(2, 'p1', ',"weightG":1200'), 'ok', 'a 1 200 g add');
select is(pg_temp.row_of(2), '1200/4.25/1.0/51.00/menu', 'costs 51,00 at 4,25 per etto (not 144,00)');

-- Etto -> portion during a push ---------------------------------------------------------------------------------------------------------------
select pg_temp.as_owner();
select is(pg_temp.push('p1', '{"pushed":true,"pushPrice":4}'), 'ok', 'the weighted dish is pushed at 4,00 per etto');
select is(pg_temp.upd_item('p1', '{"priceUnit":"portion","price":14}'), 'P0001 push_active', 'switching back to portion while the push runs is refused');
select is(pg_temp.state_of('p1'), 'etto/4.25/Tagliatelle al ragu (demo)/4/true/4/4', 'and nothing changed: still etto 4,25, push 4, four price rows and four update audits (the refused switch added none)');
select pg_temp.as_waiter();
select is(pg_temp.add(3, 'p1', ',"weightG":1000'), 'ok', 'a 1 000 g add during the push');
select is(pg_temp.row_of(3), '1000/4.00/1.0/40.00/push', 'is priced per etto at the push price: 40,00');
select pg_temp.as_owner();
select is(pg_temp.push('p1', '{"pushed":false}'), 'ok', 'the push is stopped');
select is(pg_temp.upd_item('p1', '{"priceUnit":"portion","price":14}'), 'ok', 'now the switch back to portion at 14,00 succeeds');
select pg_temp.as_waiter();
select is(pg_temp.add(4, 'p1'), 'ok', 'a portion add');
select is(pg_temp.row_of(4), '-/-/1.0/14.00/menu', 'costs 14,00, not a per-etto price');

-- An ended push does not block the switch -----------------------------------------------------------------------------------------------------
select pg_temp.as_owner();
select is(pg_temp.push('p1', '{"pushed":true,"pushPrice":12}'), 'ok', 'a push is started again');
update public.menu_item set push_until = now() - interval '1 minute' where id = pg_temp.id('p1');
select is(pg_temp.upd_item('p1', '{"priceUnit":"etto","price":4.25,"portionWeightG":400}'), 'ok', 'a push whose end has passed does not block the switch');

-- A push on a weighted dish is per etto and compared with the per-etto menu price -----------------------------------------------------------------
select is(pg_temp.push('w1', '{"pushed":true,"pushPrice":4.3}'), 'P0001 push_price_above_menu', 'a push of 4,30 per etto is above the 4,25 per-etto menu price');
select is(pg_temp.push('w1', '{"pushed":true,"pushPrice":14}'), 'P0001 push_price_above_menu', 'and a per-portion figure such as 14,00 is refused for the same reason');
select is(pg_temp.push('w1', '{"pushed":true,"pushPrice":4.25}'), 'ok', 'a push at the menu price, 4,25 per etto, is accepted');
select pg_temp.as_waiter();
select is(pg_temp.add(5, 'w1', ',"weightG":1200'), 'ok', 'a 1 200 g add on the pushed weighted dish');
select is(pg_temp.row_of(5), '1200/4.25/1.0/51.00/push', 'is priced from the per-etto push price: 51,00');
select pg_temp.as_owner();
select is(pg_temp.upd_item('w1', '{"priceUnit":"portion","price":14}'), 'P0001 push_active', 'and the weighted dish cannot be switched while that push runs');

select * from finish();
rollback;
