-- Opening stock, step 9 (docs/plans/2026-11-18-opening-stock.md §3.6, §5 step 9; AT5): public.reverse_opening_stock reverses a WHOLE operation with a reason code: one mirror per
-- row (same unit cost, the opposite qty, the original's effective_on, ref_type 'reversal', reverses_id set), the rows back in the location's draft (new ids), one audit row with the
-- reason, the line count and the total. Owner and admin only; refused after the location's first closed monthly count and during an open count; refused while the location's draft
-- holds rows; public.reverse_movement still refuses an opening movement. This file reads the real clock, so its dates are computed from today. B-against-A cases are in 408 (X).
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
set local timezone = 'UTC';
select plan(31);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000fa', 'admin-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000ca', 'chef-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000da', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('a1000000-0000-4000-8000-0000000000fa', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000fa', 'admin', 'Admin Demo'),
  ('a1000000-0000-4000-8000-0000000000ca', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000ca', 'chef', 'Chef Demo'),
  ('a1000000-0000-4000-8000-0000000000da', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000da', 'waiter', 'Cameriere Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Frigo 1 (demo)'),
  ('10000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Cantina (demo)'),
  ('10000000-0000-4000-8000-0000000000a4', '11111111-1111-4111-8111-111111111111', 'Banco (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Farina 00 (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Mozzarella (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Pomodoro pelato (demo)', 'kg', true);
create temp table ctx as select app.business_date('11111111-1111-4111-8111-111111111111', now()) as today;
grant select on ctx to authenticated;

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
    'sub', case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'a0000000-0000-4000-8000-0000000000fa'
                      when 'chef' then 'a0000000-0000-4000-8000-0000000000ca' else 'a0000000-0000-4000-8000-0000000000da' end,
    'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', p_who,
    'aal', case when p_who = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
create function pg_temp.draft(p_loc text, p_ing text, p_qty numeric, p_cost numeric) returns jsonb language sql as $$
  select public.opening_draft_put(jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'locationId', p_loc, 'ingredientId', p_ing, 'qty', p_qty, 'unitCostEur', p_cost)))
$$;
-- Books the location's whole draft, dated p_date, and returns the opening id.
create function pg_temp.book(p_loc text, p_date date) returns uuid language sql as $$
  select (public.post_opening_stock(p_loc::uuid, p_date, gen_random_uuid(),
            (select jsonb_agg(jsonb_build_object('id', d.id, 'ingredientId', d.ingredient_id, 'qty', d.qty, 'unitCostEur', d.unit_cost))
               from public.opening_draft_line d where d.location_id = p_loc::uuid)) ->> 'openingId')::uuid
$$;
create function pg_temp.rev(p_opening uuid, p_reason text) returns text language sql as $$
  select pg_temp.err(format('select public.reverse_opening_stock(%L, %L)', p_opening, p_reason))
$$;
create function pg_temp.on_hand(p_ing text, p_loc text) returns numeric language sql security definer set search_path = '' as $$
  select app.location_on_hand('11111111-1111-4111-8111-111111111111', p_ing::uuid, p_loc::uuid)
$$;
create function pg_temp.n() returns text language sql security definer set search_path = '' as $$
  select (select count(*) from public.stock_movement where type::text = 'opening' and ref_type = 'reversal') || '/' || (select count(*) from public.opening_draft_line)
      || '/' || (select count(*) from public.audit_event where action = 'stock.opening_reversed')
$$;
create temp table ops (label text primary key, id uuid, r jsonb);
grant all on ops to authenticated;
grant execute on function pg_temp.err(text), pg_temp.act_as(text), pg_temp.draft(text, text, numeric, numeric), pg_temp.book(text, date), pg_temp.rev(uuid, text),
  pg_temp.on_hand(text, text), pg_temp.n() to authenticated;

-- 0. The function and the reason list ---------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'reverse_opening_stock'
              and p.prosecdef and p.proconfig = array['search_path=""']
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 1,
  'reverse_opening_stock is a definer with an empty search_path, executable by authenticated only');
select is(app.opening_reversal_reasons(), array['qty_wrong', 'cost_wrong', 'ingredient_wrong', 'location_wrong'], 'the reason codes are the four of spec section 5');
select ok(not has_function_privilege('authenticated', 'app.opening_reversal_reasons()', 'execute') and not has_function_privilege('anon', 'app.opening_reversal_reasons()', 'execute'),
  'and no API role may call the list itself');

-- The operations: Dispensa 3 lines (yesterday), Frigo 1 one line, Cantina one line, Banco one line.
set local role authenticated;
select pg_temp.act_as('owner');
select pg_temp.draft('10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000001', 25, 0.8);
select pg_temp.draft('10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000002', 4, 6.5);
select pg_temp.draft('10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000003', 10, 1.2);
insert into ops select 'dispensa', pg_temp.book('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx));
select pg_temp.draft('10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000002', 2, 6.5);
insert into ops select 'frigo', pg_temp.book('10000000-0000-4000-8000-0000000000a2', (select today from ctx));
select pg_temp.draft('10000000-0000-4000-8000-0000000000a3', '1a000000-0000-4000-8000-000000000001', 1, 0.8);
insert into ops select 'cantina', pg_temp.book('10000000-0000-4000-8000-0000000000a3', (select today from ctx));
select pg_temp.draft('10000000-0000-4000-8000-0000000000a4', '1a000000-0000-4000-8000-000000000001', 1, 0.8);
insert into ops select 'banco', pg_temp.book('10000000-0000-4000-8000-0000000000a4', (select today from ctx));
select is((select count(*)::int from ops where id is not null), 4, 'four operations booked (Dispensa, Frigo 1, Cantina, Banco)');

-- 1. AT5: reversing Dispensa ----------------------------------------------------------------------------------------------------------------------------------------------------
update ops set r = public.reverse_opening_stock(id, 'cost_wrong') where label = 'dispensa';
reset role;
select is((select string_agg(i.name || ':' || r.qty::numeric(12, 2) || '@' || r.unit_cost::numeric(12, 2), ',' order by i.name)
             from public.stock_movement r
             join public.stock_movement o on o.id = r.reverses_id
             join public.ingredient i on i.id = r.ingredient_id
            where o.ref_type = 'opening' and o.ref_id = (select id from ops where label = 'dispensa')
              and r.type::text = 'opening' and r.ref_type = 'reversal' and r.raw_lot_id is null and r.reason_code is null
              and r.unit_cost = o.unit_cost and r.qty = -o.qty and r.effective_on = o.effective_on and r.location_id = o.location_id
              and r.ref_id = (select (r ->> 'reversalOperationId')::uuid from ops where label = 'dispensa')
              and r.created_by = 'a1000000-0000-4000-8000-00000000000a'),
  'Farina 00 (demo):-25.00@0.80,Mozzarella (demo):-4.00@6.50,Pomodoro pelato (demo):-10.00@1.20',
  'reversing a 3-line Dispensa opening (cost_wrong) writes three mirrors: same unit cost, negated qty, the original''s effective_on, ref_type reversal, one fresh operation id');
select is(pg_temp.on_hand('1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1')::numeric(12, 2)::text || '/'
       || pg_temp.on_hand('1a000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1')::numeric(12, 2)::text || '/'
       || pg_temp.on_hand('1a000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-0000000000a1')::numeric(12, 2)::text, '0.00/0.00/0.00',
  'the balances at Dispensa are back to their prior values');
select is((select string_agg(i.name || ':' || d.qty::numeric(12, 2) || '@' || d.unit_cost::numeric(12, 2) || ':' || (d.updated_by = 'a1000000-0000-4000-8000-00000000000a')::text, ',' order by i.name)
             from public.opening_draft_line d join public.ingredient i on i.id = d.ingredient_id where d.location_id = '10000000-0000-4000-8000-0000000000a1'),
  'Farina 00 (demo):25.00@0.80:true,Mozzarella (demo):4.00@6.50:true,Pomodoro pelato (demo):10.00@1.20:true', 'the draft holds the three original lines again, written by the caller');
select is((select array_agg(d.id order by d.id) from public.opening_draft_line d where d.location_id = '10000000-0000-4000-8000-0000000000a1'),
          (select array_agg(x::uuid order by x::uuid) from ops, jsonb_array_elements_text(r -> 'restoredLineIds') x where label = 'dispensa'),
  'the answer lists the restored line ids');
select is((select (r ->> 'openingId')::uuid = id from ops where label = 'dispensa'), true, 'and the reversed opening id');
select is((select string_agg(e.entity_type || '|' || (e.after ->> 'reason_code') || '|' || (e.after ->> 'lines') || '|' || (e.after ->> 'total_value_eur') || '|'
                             || (select string_agg(k, ',' order by k) from jsonb_object_keys(e.after) k), ';')
             from public.audit_event e where e.action = 'stock.opening_reversed' and e.entity_id = (select id from ops where label = 'dispensa')
              and e.created_by = 'a1000000-0000-4000-8000-00000000000a'),
  'stock_opening|cost_wrong|3|58.00|lines,reason_code,total_value_eur', 'one stock.opening_reversed audit row: {reason_code, lines, total_value_eur} and nothing else');
select is(pg_temp.n(), '3/3/1', 'three mirrors, three draft lines, one audit row in all');

-- 2. Refusals ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('owner');
select is(pg_temp.rev((select id from ops where label = 'dispensa'), 'qty_wrong'), 'P0001 already_reversed', 'a second reversal: already_reversed');
select pg_temp.draft('10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000003', 1, 1);
select is(pg_temp.rev((select id from ops where label = 'frigo'), 'qty_wrong'), 'P0001 opening_draft_not_empty', 'Frigo 1''s draft holds a line: opening_draft_not_empty (Q9)');
select is(pg_temp.rev((select id from ops where label = 'frigo'), 'foo'), 'P0001 opening_reason_invalid', 'reason foo: opening_reason_invalid');
select is(pg_temp.rev((select id from ops where label = 'frigo'), null), '22023 invalid_request', 'a null reason: 22023');
select is(pg_temp.rev(null, 'qty_wrong'), '22023 invalid_request', 'a null id: 22023');
select is(pg_temp.rev(gen_random_uuid(), 'qty_wrong'), 'P0002 opening_not_found', 'an unknown id: opening_not_found');
reset role;
select is(pg_temp.n(), '3/4/1', 'and none of them wrote a mirror or an audit row (the new draft line at Frigo 1 is the only change)');
-- Cantina is counted (a closed monthly count after its booking), Banco has an open count.
insert into public.count_session (tenant_id, location_id, type, status, started_by, closed_at, closed_by)
  values ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a3', 'monthly', 'closed', 'a1000000-0000-4000-8000-00000000000a', clock_timestamp(), 'a1000000-0000-4000-8000-00000000000a');
insert into public.count_session (tenant_id, location_id, type, status, started_by)
  values ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a4', 'daily', 'open', 'a1000000-0000-4000-8000-00000000000a');
set local role authenticated;
select pg_temp.act_as('owner');
select is(pg_temp.rev((select id from ops where label = 'cantina'), 'qty_wrong'), 'P0001 opening_location_counted ' || (select today::text from ctx),
  'after a closed monthly count at Cantina: opening_location_counted');
select is(pg_temp.rev((select id from ops where label = 'banco'), 'qty_wrong'), 'P0001 opening_count_open', 'during an open count at Banco: opening_count_open');

-- 3. Roles --------------------------------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('chef');
select is(pg_temp.rev((select id from ops where label = 'cantina'), 'qty_wrong'), '42501 permission denied: opening stock needs owner or admin', 'the chef: 42501');
select pg_temp.act_as('waiter');
select is(pg_temp.rev((select id from ops where label = 'cantina'), 'qty_wrong'), '42501 permission denied: opening stock needs owner or admin', 'the waiter: 42501');
select pg_temp.act_as('admin');
select is(public.opening_draft_remove(array(select d.id from public.opening_draft_line d where d.location_id = '10000000-0000-4000-8000-0000000000a2')) ->> 'removed', '1',
  'the admin clears Frigo 1''s extra line');
select is(pg_temp.rev((select id from ops where label = 'frigo'), 'location_wrong'), 'ok', 'and then reverses Frigo 1 (the admin may)');
reset role;
select is((select count(*)::int from public.audit_event where action = 'stock.opening_reversed' and entity_id = (select id from ops where label = 'frigo')
             and created_by = 'a1000000-0000-4000-8000-0000000000fa' and after ->> 'reason_code' = 'location_wrong'), 1, 'its audit row names the admin and location_wrong');

-- 4. Rebooking the restored, edited draft gives the corrected balances ------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('owner');
select public.opening_draft_put(jsonb_build_array(jsonb_build_object('id', d.id, 'locationId', d.location_id, 'ingredientId', d.ingredient_id, 'qty', 24, 'unitCostEur', 0.9)))
  from public.opening_draft_line d where d.location_id = '10000000-0000-4000-8000-0000000000a1' and d.ingredient_id = '1a000000-0000-4000-8000-000000000001';
insert into ops select 'rebook', pg_temp.book('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx));
select is(pg_temp.on_hand('1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1')::numeric(12, 2)::text || '/'
       || pg_temp.on_hand('1a000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1')::numeric(12, 2)::text, '24.00/4.00',
  'rebooking the restored draft with Farina edited to 24 kg gives the corrected balances');

-- 5. The reads ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(coalesce(o -> 'reversed' ->> 'reasonCode', 'null') || '|' || coalesce(o -> 'reversed' ->> 'byName', '-') || '|' || (o ->> 'correctable'), ' ' order by o ->> 'lineCount', o ->> 'totalValueEur')
             from jsonb_array_elements(public.opening_history('10000000-0000-4000-8000-0000000000a1') -> 'operations') o),
  'cost_wrong|Titolare Demo|false null|-|true', 'opening_history(Dispensa): the reversed operation shows its reason and who reversed it and is not correctable; the rebooked one is');
select is((select count(*)::int from jsonb_array_elements(public.stock_movements('1a000000-0000-4000-8000-000000000001') -> 'operations') o
            where (o ->> 'type') = 'opening' and (o ->> 'reversible') = 'false' and (o ->> 'isReversal') = 'false') || '/'
       || (select count(*)::int from jsonb_array_elements(public.stock_movements('1a000000-0000-4000-8000-000000000001') -> 'operations') o
            where (o ->> 'type') = 'opening' and (o ->> 'isReversal') = 'true'),
  '4/1', 'stock_movements (Farina): the four opening operations are not reversible from Magazzino; Dispensa''s reversal reads isReversal');
select is(pg_temp.err(format('select public.reverse_movement(%L)',
            (select m.id from public.stock_movement m where m.ref_type = 'opening' and m.ref_id = (select id from ops where label = 'rebook') limit 1))),
  'P0001 movement_not_reversible', 'public.reverse_movement on an opening movement: movement_not_reversible (unchanged)');
select is(public.opening_stock_summary() ->> 'booked', 'true', 'the summary still says booked (the rebooked operation and Cantina and Banco have no mirror)');
reset role;
select is((select coalesce(string_agg(check_key, ','), '-') from app.ledger_checks_body('11111111-1111-4111-8111-111111111111', now())), '-',
  'the nightly ledger checks report nothing for the fixture (rev_bad included)');

select * from finish();
rollback;
