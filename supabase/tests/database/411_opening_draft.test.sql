-- Opening stock, step 6 (docs/plans/2026-11-18-opening-stock.md §3.3, §3.4, §5 step 6): the helpers, the cut-off and the draft procedures opening_draft, opening_draft_put,
-- opening_draft_remove and opening_draft_clear. Owner and admin only (require_opening_writer, through app.role(), so the MFA gate applies); every line is strict (base unit, EUR per
-- base unit net of VAT, at most 4 decimals, never rounded); a location with a closed MONTHLY count (V3, lead ruling on Q4) or with an open count of either type cannot be drafted.
-- B-against-A cases are in 408 (X). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
set local timezone = 'UTC';
select plan(63);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000fa', 'admin-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000ca', 'chef-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000da', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('a1000000-0000-4000-8000-0000000000fa', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000fa', 'admin', 'Admin Demo'),
  ('a1000000-0000-4000-8000-0000000000ca', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000ca', 'chef', 'Chef Demo'),
  ('a1000000-0000-4000-8000-0000000000da', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000da', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
-- A's locations: two clean ones, an inactive one, and one per count state (open daily, cancelled, closed daily, closed monthly).
insert into public.location (id, tenant_id, name, is_active) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)', true),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Frigo 1 (demo)', true),
  ('10000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Cantina chiusa (demo)', false),
  ('10000000-0000-4000-8000-0000000000a4', '11111111-1111-4111-8111-111111111111', 'Banco (demo)', true),
  ('10000000-0000-4000-8000-0000000000a5', '11111111-1111-4111-8111-111111111111', 'Cella (demo)', true),
  ('10000000-0000-4000-8000-0000000000a6', '11111111-1111-4111-8111-111111111111', 'Retro (demo)', true),
  ('10000000-0000-4000-8000-0000000000a7', '11111111-1111-4111-8111-111111111111', 'Magazzino (demo)', true),
  ('10000000-0000-4000-8000-0000000000a8', '11111111-1111-4111-8111-111111111111', 'Sala (demo)', true),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Dispensa B (demo)', true);
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Farina 00 (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Mozzarella (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Sale fino (demo, non a magazzino)', 'kg', false),
  ('1b000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Farina 00 B (demo)', 'kg', true);
-- 200 more stock ingredients of A, for the 200-line bound.
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock)
  select ('1c000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'Voce ' || n || ' (demo)', 'pz', true from generate_series(1, 200) n;
insert into public.count_session (tenant_id, location_id, type, status, started_by, closed_at, closed_by, cancelled_at, cancelled_by) values
  ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a4', 'daily', 'open', 'a1000000-0000-4000-8000-00000000000a', null, null, null, null),
  ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a8', 'monthly', 'open', 'a1000000-0000-4000-8000-00000000000a', null, null, null, null),
  ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a5', 'monthly', 'cancelled', 'a1000000-0000-4000-8000-00000000000a', null, null, '1998-12-10T10:00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a6', 'daily', 'closed', 'a1000000-0000-4000-8000-00000000000a', '1998-12-11T10:00:00Z', 'a1000000-0000-4000-8000-00000000000a', null, null),
  ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a7', 'monthly', 'closed', 'a1000000-0000-4000-8000-00000000000a', '1998-12-15T10:00:00Z', 'a1000000-0000-4000-8000-00000000000a', null, null);

create temp table ctx as select app.business_date('11111111-1111-4111-8111-111111111111', now()) as today;
grant select on ctx to authenticated;

-- 'ok', or "SQLSTATE message[ detail]".
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
create function pg_temp.act_as(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'a0000000-0000-4000-8000-0000000000fa' when 'admin1' then 'a0000000-0000-4000-8000-0000000000fa'
                      when 'chef' then 'a0000000-0000-4000-8000-0000000000ca' when 'waiter' then 'a0000000-0000-4000-8000-0000000000da' else 'b0000000-0000-4000-8000-00000000000b' end,
    'role', 'authenticated',
    'tenant_id', case when p_who = 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end,
    'app_role', case p_who when 'ownerb' then 'owner' when 'admin1' then 'admin' else p_who end,
    'aal', case when p_who = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
-- One draft line as JSON (numbers as given, so a test can send 1.00001 or a string).
create function pg_temp.line(p_id text, p_loc text, p_ing text, p_qty text, p_cost text) returns jsonb language sql as $$
  select format('{"id": "%s", "locationId": "%s", "ingredientId": "%s", "qty": %s, "unitCostEur": %s}', p_id, p_loc, p_ing, p_qty, p_cost)::jsonb
$$;
create function pg_temp.put1(p_id text, p_loc text, p_ing text, p_qty text, p_cost text) returns text language sql as $$
  select pg_temp.err(format('select public.opening_draft_put(%L::jsonb)', jsonb_build_array(pg_temp.line(p_id, p_loc, p_ing, p_qty, p_cost))))
$$;
-- The lines of one location in opening_draft(), as "qty@cost=value" in screen order.
create function pg_temp.loc_lines(p_loc text) returns text language sql as $$
  select string_agg((l ->> 'qty')::numeric::text || '@' || (l ->> 'unitCostEur')::numeric::text || '=' || (l ->> 'valueEur'), ',' order by o)
    from jsonb_array_elements(public.opening_draft() -> 'locations') loc, jsonb_array_elements(loc -> 'lines') with ordinality t(l, o)
   where loc ->> 'locationId' = p_loc
$$;
create function pg_temp.loc(p_loc text) returns jsonb language sql as $$
  select loc from jsonb_array_elements(public.opening_draft() -> 'locations') loc where loc ->> 'locationId' = p_loc
$$;
create function pg_temp.n_rows() returns int language sql security definer set search_path = '' as $$ select count(*)::int from public.opening_draft_line $$;
grant execute on function pg_temp.err(text), pg_temp.act_as(text), pg_temp.line(text, text, text, text, text), pg_temp.put1(text, text, text, text, text),
  pg_temp.loc_lines(text), pg_temp.loc(text), pg_temp.n_rows() to authenticated;

-- 0. The functions: definers with an empty search_path; the public ones executable by authenticated only, the app helpers by no API role ------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('opening_draft', 'opening_draft_put', 'opening_draft_remove', 'opening_draft_clear')
              and p.prosecdef and p.proconfig = array['search_path=""']
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 4,
  'the four draft procedures are definers with an empty search_path, executable by authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
              and p.proname in ('require_opening_writer', 'opening_max_lines', 'opening_location_state', 'opening_check_bookable', 'opening_check_date', 'opening_line_values')
              and p.proconfig = array['search_path=""']
              and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 6,
  'the six app helpers have an empty search_path and no API role may execute them');
select is(app.opening_max_lines(), 200, 'app.opening_max_lines() is 200 (Q7)');

set local role authenticated;
select pg_temp.act_as('owner');

-- 1. Put and read ------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000001', '25', '0.8'), 'ok',
  'owner A puts one Dispensa line: Farina 25 kg at 0,80');
select is(pg_temp.loc_lines('10000000-0000-4000-8000-0000000000a1'), '25@0.8=20.00', 'opening_draft() shows that line under Dispensa with valueEur 20.00');
select is((select (l ->> 'ingredientName') || '|' || (l ->> 'baseUnit') || '|' || (l ->> 'updatedByName') || '|' || (l ->> 'id')
             from jsonb_array_elements(pg_temp.loc('10000000-0000-4000-8000-0000000000a1') -> 'lines') l),
  'Farina 00 (demo)|kg|Titolare Demo|0d000000-0000-4000-8000-000000000001', 'the line carries its id, the ingredient name, the base unit and who changed it last');
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000001', '30', '0.8'), 'ok', 'the same id again with qty 30');
select is(pg_temp.loc_lines('10000000-0000-4000-8000-0000000000a1') || ' / ' || pg_temp.n_rows(), '30@0.8=24.00 / 1', 'updates the line in place (still one row)');
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000001', '2', '1'),
  'P0001 opening_line_duplicate 1a000000-0000-4000-8000-000000000001', 'the same ingredient at Dispensa under another id: opening_line_duplicate, with the ingredient id as detail');
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000001', '2', '1.2345'), 'ok',
  'the same ingredient at Frigo 1 is accepted (4 decimals of cost)');
select is(pg_temp.err($$ select public.opening_draft_put(jsonb_build_array(
    pg_temp.line('0d000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000002', '3', '5'),
    pg_temp.line('0d000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000002', '4', '5'))) $$),
  'P0001 opening_line_duplicate 1a000000-0000-4000-8000-000000000002', 'two lines of the same ingredient and location in one call: opening_line_duplicate');
select is(pg_temp.err($$ select public.opening_draft_put(jsonb_build_array(
    pg_temp.line('0d000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000002', '3', '5'),
    pg_temp.line('0d000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000002', '4', '5'))) $$),
  '22023 invalid_request', 'the same id twice in one call: 22023');
-- An id may move: Frigo's line becomes Mozzarella at Dispensa.
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000002', '1.5', '6'), 'ok',
  'an existing id put with another location and ingredient');
select is(pg_temp.loc_lines('10000000-0000-4000-8000-0000000000a1') || ' / ' || coalesce(pg_temp.loc_lines('10000000-0000-4000-8000-0000000000a2'), '-') || ' / ' || pg_temp.n_rows(),
  '1.5@6=9.00,30@0.8=24.00 / - / 2', 'changes in place: Dispensa holds both lines (newest first), Frigo 1 none, two rows in all');
select is((select (d ->> 'lineCount') || '|' || (d ->> 'totalValueEur') || '|' || (pg_temp.loc('10000000-0000-4000-8000-0000000000a1') ->> 'lineCount') || '|'
                  || (pg_temp.loc('10000000-0000-4000-8000-0000000000a1') ->> 'totalValueEur') from (select public.opening_draft() d) x), '2|33.00|2|33.00',
  'line counts and totals (sums of the rounded values) per location and overall');

-- 2. Strict lines ------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000002', '0', '1'), 'P0001 opening_qty_invalid', 'qty 0: opening_qty_invalid');
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000002', '-1', '1'), 'P0001 opening_qty_invalid', 'qty -1: opening_qty_invalid');
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000002', '100000.0001', '1'), 'P0001 opening_qty_invalid', 'qty 100000.0001: opening_qty_invalid');
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000002', '1.00001', '1'), 'P0001 opening_qty_invalid', 'qty 1.00001 (5 decimals): refused, never rounded');
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000002', '1', '-0.01'), 'P0001 opening_cost_invalid', 'unitCostEur -0.01: opening_cost_invalid');
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000002', '1', '1.00001'), 'P0001 opening_cost_invalid', 'unitCostEur 1.00001: refused, never rounded');
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000002', '1', '100000.01'), 'P0001 opening_cost_invalid', 'unitCostEur 100000.01: opening_cost_invalid');
select is(pg_temp.put1('0d000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000002', '1.5000', '0'), 'ok', 'qty 1.5000 (trailing zeros) at cost 0 is accepted');
select is(pg_temp.err($$ select public.opening_draft_put('[{"id": "0d000000-0000-4000-8000-00000000000a", "locationId": "10000000-0000-4000-8000-0000000000a2", "ingredientId": "1a000000-0000-4000-8000-000000000001", "qty": 1}]') $$),
  '22023 invalid_request', 'a missing key (unitCostEur): 22023');
select is(pg_temp.err($$ select public.opening_draft_put('[{"id": "0d000000-0000-4000-8000-00000000000a", "locationId": "10000000-0000-4000-8000-0000000000a2", "ingredientId": "1a000000-0000-4000-8000-000000000001", "qty": "1", "unitCostEur": 1}]') $$),
  '22023 invalid_request', 'a string qty: 22023');
select is(pg_temp.err($$ select public.opening_draft_put('[{"id": "0d000000-0000-4000-8000-00000000000a", "locationId": "10000000-0000-4000-8000-0000000000a2", "ingredientId": "1a000000-0000-4000-8000-000000000001", "qty": 1, "unitCostEur": 1, "note": "x"}]') $$),
  '22023 invalid_request', 'an extra key: 22023');
select is(pg_temp.err($$ select public.opening_draft_put('[{"id": "not-a-uuid", "locationId": "10000000-0000-4000-8000-0000000000a2", "ingredientId": "1a000000-0000-4000-8000-000000000001", "qty": 1, "unitCostEur": 1}]') $$),
  '22023 invalid_request', 'a bad uuid: 22023');
select is(pg_temp.err($$ select public.opening_draft_put('[]') $$) || ' / ' || pg_temp.err($$ select public.opening_draft_put(null) $$) || ' / ' || pg_temp.err($$ select public.opening_draft_put('{}') $$),
  '22023 invalid_request / 22023 invalid_request / 22023 invalid_request', 'an empty array, null and an object: 22023');
select is(pg_temp.put1('0d000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000003', '1', '1'), 'P0001 ingredient_not_stock', 'a non-stock ingredient: ingredient_not_stock');
select is(pg_temp.put1('0d000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-0000000000a2', '1b000000-0000-4000-8000-000000000001', '1', '1'), 'P0002 ingredient_not_found', 'B''s ingredient: ingredient_not_found');
select is(pg_temp.put1('0d000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-0000000000a3', '1a000000-0000-4000-8000-000000000001', '1', '1'), 'P0001 location_not_found', 'an inactive location: location_not_found');
select is(pg_temp.n_rows(), 3, 'none of the refused puts wrote a row');

-- 3. The 200-line bound (per location, after the write) ----------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select public.opening_draft_put((select jsonb_agg(pg_temp.line(gen_random_uuid()::text, '10000000-0000-4000-8000-0000000000a2', '1c000000-0000-4000-8000-' || lpad(n::text, 12, '0'), '1', '1')) from generate_series(1, 200) n)) $$),
  'P0001 opening_draft_full', '200 new lines at Frigo 1, which already holds one: 201 after the write, opening_draft_full');
select is(pg_temp.n_rows(), 3, 'and nothing was written');
select is(pg_temp.err($$ select public.opening_draft_put((select jsonb_agg(pg_temp.line(gen_random_uuid()::text, '10000000-0000-4000-8000-0000000000a6', '1c000000-0000-4000-8000-' || lpad(n::text, 12, '0'), '1', '1')) from generate_series(1, 200) n)) $$),
  'ok', '200 lines at Retro (empty, and its only count is a closed DAILY one, which does not end the window: V3) in one call: accepted');
select is(pg_temp.put1('0d000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-0000000000a6', '1a000000-0000-4000-8000-000000000001', '1', '1'), 'P0001 opening_draft_full', 'a 201st line at Retro: opening_draft_full');
select is(pg_temp.err($$ select public.opening_draft_put((select jsonb_agg(pg_temp.line(gen_random_uuid()::text, '10000000-0000-4000-8000-0000000000a5', '1c000000-0000-4000-8000-' || lpad(n::text, 12, '0'), '1', '1')) from generate_series(1, 201) n)) $$),
  '22023 invalid_request', '201 lines in one call: 22023 (the array bound)');

-- 4. The cut-off (O2 with V3: only a closed MONTHLY count ends the window; an open count of either type refuses) --------------------------------------------------------------
select is(pg_temp.put1('0d000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-0000000000a7', '1a000000-0000-4000-8000-000000000001', '1', '1'),
  'P0001 opening_location_counted 1998-12-15', 'Magazzino has a closed monthly count: opening_location_counted, with the count''s business date as detail');
select is(pg_temp.put1('0d000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-0000000000a4', '1a000000-0000-4000-8000-000000000001', '1', '1'),
  'P0001 opening_count_open', 'Banco has an open (daily) count: opening_count_open');
select is(pg_temp.put1('0d000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-0000000000a8', '1a000000-0000-4000-8000-000000000001', '1', '1'),
  'P0001 opening_count_open', 'Sala has an open MONTHLY count: opening_count_open too (either type refuses)');
select is(pg_temp.put1('0d000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-0000000000a5', '1a000000-0000-4000-8000-000000000001', '1', '1'), 'ok', 'Cella''s only count was cancelled: accepted');
select is(pg_temp.put1('0d000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000003', '1', '1') || ' / '
       || pg_temp.put1('0d000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000001', '1', '1'),
  'P0001 ingredient_not_stock / ok', 'Dispensa and Frigo 1 (no count) are still open to drafting');
select is((select string_agg((l ->> 'bookable') || '|' || coalesce(l ->> 'countedOn', '-') || '|' || (l ->> 'countOpen'), ' ' order by l ->> 'name')
             from jsonb_array_elements(public.opening_draft() -> 'locations') l
            where l ->> 'locationId' in ('10000000-0000-4000-8000-0000000000a4', '10000000-0000-4000-8000-0000000000a5', '10000000-0000-4000-8000-0000000000a6', '10000000-0000-4000-8000-0000000000a7')),
  'false|-|true true|-|false false|1998-12-15|false true|-|false',
  'opening_draft() per location (by name): Banco not bookable (open count), Cella bookable, Magazzino counted on 15 Dec 1998, Retro bookable (a daily count only)');

-- 5. The state of the screen ---------------------------------------------------------------------------------------------------------------------------------------------
select is((select (d ->> 'maxLines') || '|' || (d ->> 'booked') || '|' || ((d ->> 'today')::date = (select today from ctx))::text from (select public.opening_draft() d) x),
  '200|false|true', 'opening_draft() has maxLines 200, booked false (no operation yet) and today = the business date');
select is((select string_agg(l ->> 'name', ',' order by l ->> 'name') from jsonb_array_elements(public.opening_draft() -> 'locations') l),
  'Banco (demo),Cella (demo),Dispensa (demo),Frigo 1 (demo),Magazzino (demo),Retro (demo),Sala (demo)', 'every active location of A is listed, and no inactive one without draft lines, and nothing of B');
select is((select coalesce(l ->> 'firstReceiptOn', '-') from (select pg_temp.loc('10000000-0000-4000-8000-0000000000a1') l) x), '-', 'no receipt at Dispensa: firstReceiptOn is null');

-- 6. Remove and clear ------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(public.opening_draft_remove(array['0d000000-0000-4000-8000-0000000000ff']::uuid[]), '{"removed": 0}'::jsonb, 'removing an unknown id: {removed: 0} (removing is idempotent)');
select is(public.opening_draft_remove(array['0d000000-0000-4000-8000-000000000002']::uuid[]), '{"removed": 1}'::jsonb, 'removing Dispensa''s Mozzarella line: {removed: 1}');
select is(pg_temp.err($$ select public.opening_draft_remove(array[]::uuid[]) $$) || ' / ' || pg_temp.err($$ select public.opening_draft_remove(null) $$)
       || ' / ' || pg_temp.err($$ select public.opening_draft_remove(array[null]::uuid[]) $$),
  '22023 invalid_request / 22023 invalid_request / 22023 invalid_request', 'an empty array, null and a null id: 22023');
select is(public.opening_draft_clear('10000000-0000-4000-8000-0000000000a6'), '{"removed": 200}'::jsonb, 'clearing Retro removes its 200 lines');
select is(pg_temp.loc_lines('10000000-0000-4000-8000-0000000000a1') || ' / ' || pg_temp.n_rows(), '30@0.8=24.00 / 4', 'and only those: Dispensa keeps its Farina line (four rows remain in A)');
select is(pg_temp.err($$ select public.opening_draft_clear('10000000-0000-4000-8000-0000000000b1') $$), 'P0001 location_not_found', 'clearing B''s location: location_not_found');

-- 7. Roles and the MFA gate ----------------------------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.matrix() returns text language sql as $$
  select pg_temp.err($q$ select public.opening_draft() $q$) || ','
      || pg_temp.err($q$ select public.opening_draft_put(jsonb_build_array(pg_temp.line('0d000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000a5', '1a000000-0000-4000-8000-000000000002', '1', '1'))) $q$) || ','
      || pg_temp.err($q$ select public.opening_draft_remove(array['0d000000-0000-4000-8000-0000000000e1']::uuid[]) $q$) || ','
      || pg_temp.err($q$ select public.opening_draft_clear('10000000-0000-4000-8000-0000000000a6') $q$)
$$;
grant execute on function pg_temp.matrix() to authenticated;
select pg_temp.act_as('chef');
select is(regexp_replace(pg_temp.matrix(), ' [^,]*', '', 'g'), '42501,42501,42501,42501', 'the chef: 42501 on all four');
select pg_temp.act_as('waiter');
select is(regexp_replace(pg_temp.matrix(), ' [^,]*', '', 'g'), '42501,42501,42501,42501', 'the waiter: 42501 on all four');
select pg_temp.act_as('admin');
select is(pg_temp.matrix(), 'ok,ok,ok,ok', 'the admin (aal2): allowed on all four');
select pg_temp.act_as('owner');
select is((select l ->> 'updatedByName' from jsonb_array_elements(pg_temp.loc('10000000-0000-4000-8000-0000000000a5') -> 'lines') l), 'Titolare Demo', 'the admin''s remove left Cella with the owner''s line only');
reset role;
-- The gate (#79, FD31): an admin at aal1 with enforcement "required", and an owner with a verified factor at aal1, have no role.
update public.tenant set mfa_enforcement = 'required' where id = '11111111-1111-4111-8111-111111111111';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), 'a0000000-0000-4000-8000-00000000000a', 'Principale', 'totp', 'verified', now(), now(), 'fake-secret-value');
set local role authenticated;
select pg_temp.act_as('admin1');
select is(regexp_replace(pg_temp.matrix(), ' [^,]*', '', 'g'), '42501,42501,42501,42501', 'an admin at aal1 under "required": 42501 on all four');
select pg_temp.act_as('owner');
select is(regexp_replace(pg_temp.matrix(), ' [^,]*', '', 'g'), '42501,42501,42501,42501', 'an owner with a verified factor at aal1: 42501 on all four');
reset role;
update public.tenant set mfa_enforcement = 'enrolled' where id = '11111111-1111-4111-8111-111111111111';
delete from auth.mfa_factors where user_id = 'a0000000-0000-4000-8000-00000000000a';

-- 8. The date rule (used by the confirm of step 7; cases here pin the helper) -----------------------------------------------------------------------------------------------
create function pg_temp.date_ok(p_loc uuid, p_date date) returns text language sql as $$
  select pg_temp.err(format('select app.opening_check_date(%L, %L, %L)', '11111111-1111-4111-8111-111111111111', p_loc, p_date))
$$;
select is(pg_temp.date_ok('10000000-0000-4000-8000-0000000000a1', app.business_date('11111111-1111-4111-8111-111111111111', now())), 'ok', 'today''s business date is allowed');
select is(pg_temp.date_ok('10000000-0000-4000-8000-0000000000a1', app.business_date('11111111-1111-4111-8111-111111111111', now()) + 1), 'P0001 opening_date_in_future', 'tomorrow: opening_date_in_future');
select is(pg_temp.date_ok('10000000-0000-4000-8000-0000000000a1', app.business_date('11111111-1111-4111-8111-111111111111', now()) - 366), 'ok', 'today - 366 is allowed');
select is(pg_temp.date_ok('10000000-0000-4000-8000-0000000000a1', app.business_date('11111111-1111-4111-8111-111111111111', now()) - 367), 'P0001 opening_date_too_old', 'today - 367: opening_date_too_old');
select is(pg_temp.date_ok('10000000-0000-4000-8000-0000000000a1', null), '22023 invalid_request', 'a null date: 22023');

select * from finish();
rollback;
