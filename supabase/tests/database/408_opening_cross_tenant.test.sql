-- Opening stock, step 2 (docs/plans/2026-11-18-opening-stock.md §5 step 2, AT8): X, the cross-tenant suite on Demo A and Demo B. On main it asserts the baseline that the opening-stock
-- work must keep: tenant B's owner, admin and chef read none of A's stock rows, and cannot reach A's locations, ingredients or movements through the stock procedures. It passes on main
-- by design. Steps 5, 6, 7, 9, 10 and 11 add their B-against-A cases to this file as the opening tables and procedures arrive. Fake data only.
-- Proof that it can fail: a temporary policy that lets B read A's ledger turns the first group red (see the mutation test at the end, which runs that policy inside a rolled-back block).
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000fa', 'admin-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000ca', 'chef-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('b0000000-0000-4000-8000-0000000000fb', 'admin-b@example.test'),
  ('b0000000-0000-4000-8000-0000000000cb', 'chef-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A Demo'),
  ('a1000000-0000-4000-8000-0000000000fa', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000fa', 'admin', 'Admin A Demo'),
  ('a1000000-0000-4000-8000-0000000000ca', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000ca', 'chef', 'Chef A Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('b1000000-0000-4000-8000-0000000000fb', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-0000000000fb', 'admin', 'Admin B Demo'),
  ('b1000000-0000-4000-8000-0000000000cb', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-0000000000cb', 'chef', 'Chef B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Dispensa A (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Dispensa B (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Farina 00 A (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Mozzarella A (demo)', 'kg', true),
  ('1b000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Farina 00 B (demo)', 'kg', true),
  ('1b000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Mozzarella B (demo)', 'kg', true);
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore A (demo)', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222', 'Fornitore B (demo)', 'IT01234567897');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000a1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e1000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/e1000000-0000-4000-8000-0000000000b1.pdf', 'application/pdf', 2048, 'review', '5b000000-0000-4000-8000-00000000005b');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted) values
  ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000a1', 1, 'Riga demo', 10, 1, 10, '{}', '{}'),
  ('a2000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'e1000000-0000-4000-8000-0000000000b1', 1, 'Riga demo', 10, 1, 10, '{}', '{}');
-- Each tenant has one lot (a receipt of 10 kg of Farina 00 at 1,00), one price row and one waste of 0,5 kg (all written by the table owner, as a fixture).
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by) values
  ('a3000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1',
   '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1', 'LOT-A', '1998-11-03', 10, 'kg', 10, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('a3000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '1b000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000b1',
   '5b000000-0000-4000-8000-00000000005b', 'a2000000-0000-4000-8000-0000000000b1', 'LOT-B', '1998-11-03', 10, 'kg', 10, 'kg', 1, 'b1000000-0000-4000-8000-00000000000b');
insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by) values
  ('a4000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
   'receipt', 10, 1, 'invoice_line', 'a2000000-0000-4000-8000-0000000000a1', '1998-11-03', 'a1000000-0000-4000-8000-00000000000a'),
  ('a4000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '1b000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
   'receipt', 10, 1, 'invoice_line', 'a2000000-0000-4000-8000-0000000000b1', '1998-11-03', 'b1000000-0000-4000-8000-00000000000b');
insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, effective_on, created_by) values
  ('a4000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
   'waste', -0.5, 1, 'spoilage', 'manual', 'a5000000-0000-4000-8000-0000000000a1', '1998-11-04', 'a1000000-0000-4000-8000-00000000000a'),
  ('a4000000-0000-4000-8000-0000000000b2', '22222222-2222-4222-8222-222222222222', '1b000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
   'waste', -0.5, 1, 'spoilage', 'manual', 'a5000000-0000-4000-8000-0000000000b1', '1998-11-04', 'b1000000-0000-4000-8000-00000000000b');
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1', 1, 'kg', '1998-11-03', 'a1000000-0000-4000-8000-00000000000a'),
  ('22222222-2222-4222-8222-222222222222', '1b000000-0000-4000-8000-000000000001', '5b000000-0000-4000-8000-00000000005b', 'a2000000-0000-4000-8000-0000000000b1', 1, 'kg', '1998-11-03', 'b1000000-0000-4000-8000-00000000000b');

-- Step 5: A has one opening operation and one draft line (written by the table owner, as a fixture; the procedures arrive in steps 6 and 7).
insert into public.stock_opening (id, tenant_id, location_id, effective_on, request_id, line_count, created_by) values
  ('0e000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', '1998-11-02', 'e0000000-0000-4000-8000-0000000000a1', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.opening_draft_line (id, tenant_id, location_id, ingredient_id, qty, unit_cost, created_by, updated_by) values
  ('0d000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000002', 3, 0.8,
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

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
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
-- Who is B: p_who is 'owner', 'admin' or 'chef'; every case below runs for all three.
create function pg_temp.as_b(p_who text) returns void language sql as $$
  select pg_temp.act_as(case p_who when 'owner' then 'b0000000-0000-4000-8000-00000000000b' when 'admin' then 'b0000000-0000-4000-8000-0000000000fb' else 'b0000000-0000-4000-8000-0000000000cb' end::uuid,
                        '22222222-2222-4222-8222-222222222222', p_who)
$$;
grant execute on function pg_temp.err(text), pg_temp.act_as(uuid, uuid, text), pg_temp.as_b(text) to authenticated;
-- A's rows in the ledger tables, counted as the current session sees them.
create function pg_temp.a_rows() returns text language sql as $$
  select (select count(*) from public.stock_movement where tenant_id = '11111111-1111-4111-8111-111111111111')
      || '/' || (select count(*) from public.raw_lot where tenant_id = '11111111-1111-4111-8111-111111111111')
      || '/' || (select count(*) from public.price_history where tenant_id = '11111111-1111-4111-8111-111111111111')
$$;
create function pg_temp.b_rows() returns text language sql as $$
  select (select count(*) from public.stock_movement where tenant_id = '22222222-2222-4222-8222-222222222222')
      || '/' || (select count(*) from public.raw_lot where tenant_id = '22222222-2222-4222-8222-222222222222')
      || '/' || (select count(*) from public.price_history where tenant_id = '22222222-2222-4222-8222-222222222222')
$$;
grant execute on function pg_temp.a_rows(), pg_temp.b_rows() to authenticated;

-- 0. Control: A's own owner sees A's rows (so "0 of A's rows" for B is not an empty fixture) ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.a_rows(), '2/1/1', 'control: A''s owner reads A''s two movements, one lot and one price row');
select is(pg_temp.b_rows(), '0/0/0', 'control: and none of B''s');

-- 1. B reads none of A's stock rows (the first group: the one the mutation turns red) -----------------------------------------------------------------------------------
select pg_temp.as_b('owner');
select is(pg_temp.a_rows(), '0/0/0', 'B''s owner reads 0 of A''s movements, lots and price rows');
select is(pg_temp.b_rows(), '2/1/1', 'and all of B''s own');
select pg_temp.as_b('admin');
select is(pg_temp.a_rows(), '0/0/0', 'B''s admin reads 0 of A''s movements, lots and price rows');
select pg_temp.as_b('chef');
select is(pg_temp.a_rows(), '0/0/0', 'B''s chef reads 0 of A''s movements, lots and price rows');
select is((select count(*)::int from public.ingredient where tenant_id = '11111111-1111-4111-8111-111111111111'), 0, 'B''s chef reads none of A''s ingredients');
select is((select count(*)::int from public.location where tenant_id = '11111111-1111-4111-8111-111111111111'), 0, 'and none of A''s locations');
select is((select count(*)::int from public.v_stock_on_hand where tenant_id = '11111111-1111-4111-8111-111111111111'), 0, 'and none of A''s balances (v_stock_on_hand)');
select is((select count(*)::int from public.audit_event where tenant_id = '11111111-1111-4111-8111-111111111111'), 0, 'and none of A''s audit rows');

-- 1b. Step 5: B reads none of A's opening operations or draft lines (A's owner does: the control) ---------------------------------------------------------------------------------
create function pg_temp.a_opening_rows() returns text language sql as $$
  select (select count(*) from public.stock_opening where tenant_id = '11111111-1111-4111-8111-111111111111')
      || '/' || (select count(*) from public.opening_draft_line where tenant_id = '11111111-1111-4111-8111-111111111111')
$$;
grant execute on function pg_temp.a_opening_rows() to authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.a_opening_rows(), '1/1', 'control: A''s owner reads A''s opening operation and draft line');
select pg_temp.as_b('owner');
select is(pg_temp.a_opening_rows(), '0/0', 'B''s owner reads 0 of A''s opening operations and draft lines');
select pg_temp.as_b('admin');
select is(pg_temp.a_opening_rows(), '0/0', 'B''s admin reads 0 of them');
select pg_temp.as_b('chef');
select is(pg_temp.a_opening_rows(), '0/0', 'B''s chef reads 0 of them');

-- 2. The stock procedures cannot be pointed at A ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_b('owner');
select is(pg_temp.err($$ select public.post_waste('1a000000-0000-4000-8000-000000000001', 1, 'kg', 'spoilage', '10000000-0000-4000-8000-0000000000b1', null) $$), 'P0002 ingredient_not_found',
  'B posting a waste of A''s ingredient at B''s location is refused');
select is(pg_temp.err($$ select public.post_waste('1b000000-0000-4000-8000-000000000001', 1, 'kg', 'spoilage', '10000000-0000-4000-8000-0000000000a1', null) $$), 'P0001 location_not_found',
  'B posting a waste of B''s ingredient at A''s location is refused');
select is(pg_temp.err($$ select public.reverse_movement('a4000000-0000-4000-8000-0000000000a2') $$), 'P0002 movement_not_found', 'B reversing A''s waste is refused (not found)');
select is(pg_temp.err($$ select public.stock_reconciliation('1998-11-01', '1998-11-30', '10000000-0000-4000-8000-0000000000a1') $$), 'P0001 location_not_found', 'B''s reconciliation of A''s location is refused');
select is(pg_temp.err($$ select public.stock_on_hand('10000000-0000-4000-8000-0000000000a1') $$), 'P0002 location_not_found', 'B''s balance read of A''s location is refused');
select is((select count(*)::int from public.stock_on_hand(null) where ingredient_id in ('1a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000002')), 0, 'B''s balance read lists none of A''s ingredients');
select is(pg_temp.err($$ select * from public.stock_movements('1a000000-0000-4000-8000-000000000001') $$), 'P0002 ingredient_not_found', 'B reads no movement of A''s ingredient through stock_movements (ingredient not found)');
select is((select count(*)::int from public.ingredient_costs() where ingredient_id in ('1a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000002')), 0, 'B''s ingredient costs list none of A''s ingredients');
select is((select count(*)::int from public.ingredient_costs() where ingredient_id = '1b000000-0000-4000-8000-000000000001'), 1, 'control: they do list B''s own');
-- Step 6: the draft procedures cannot be pointed at A.
select pg_temp.as_b('owner');
select is((select count(*)::int from jsonb_array_elements(public.opening_draft() -> 'locations') l
            where l ->> 'locationId' = '10000000-0000-4000-8000-0000000000a1' or l -> 'lines' @> '[{"id": "0d000000-0000-4000-8000-0000000000a1"}]'), 0,
  'B''s owner: opening_draft() shows none of A''s locations or draft lines');
select is(pg_temp.err($$ select public.opening_draft_put('[{"id": "0d000000-0000-4000-8000-0000000000b9", "locationId": "10000000-0000-4000-8000-0000000000a1", "ingredientId": "1b000000-0000-4000-8000-000000000001", "qty": 1, "unitCostEur": 1}]') $$),
  'P0001 location_not_found', 'B''s owner putting a draft line at A''s location: location_not_found');
select is(pg_temp.err($$ select public.opening_draft_put('[{"id": "0d000000-0000-4000-8000-0000000000a1", "locationId": "10000000-0000-4000-8000-0000000000b1", "ingredientId": "1b000000-0000-4000-8000-000000000001", "qty": 1, "unitCostEur": 1}]') $$)
       || ' / ' || pg_temp.err($$ select public.opening_draft_remove(array['0d000000-0000-4000-8000-0000000000a1']::uuid[]) $$)
       || ' / ' || pg_temp.err($$ select public.opening_draft_clear('10000000-0000-4000-8000-0000000000a1') $$),
  '22023 invalid_request / ok / P0001 location_not_found', 'B cannot take over A''s draft line id, its remove of that id removes nothing (next case), and it cannot clear A''s location');
-- Step 7: the confirm and the reads cannot be pointed at A.
select is(pg_temp.err($$ select public.post_opening_stock('10000000-0000-4000-8000-0000000000a1', '1998-11-02', 'e0000000-0000-4000-8000-0000000000b9',
    '[{"id": "0d000000-0000-4000-8000-0000000000a1", "ingredientId": "1a000000-0000-4000-8000-000000000002", "qty": 3, "unitCostEur": 0.8}]') $$),
  'P0001 location_not_found', 'B''s owner confirming A''s draft at A''s location: location_not_found');
select is(pg_temp.err($$ select public.post_opening_stock('10000000-0000-4000-8000-0000000000b1', '1998-11-02', 'e0000000-0000-4000-8000-0000000000a1',
    '[{"id": "0d000000-0000-4000-8000-0000000000b9", "ingredientId": "1b000000-0000-4000-8000-000000000002", "qty": 3, "unitCostEur": 0.8}]') $$),
  'P0001 opening_draft_changed', 'B reusing A''s request id at B''s location is not a replay of A''s operation (B''s own, empty draft answers)');
select is(pg_temp.err($$ select public.opening_history('10000000-0000-4000-8000-0000000000a1') $$), 'P0001 location_not_found', 'B''s history of A''s location: location_not_found');
select is(public.opening_stock_summary(), '{"booked": false, "draftLines": 0}'::jsonb, 'B''s summary counts none of A''s operations or draft lines');
reset role;
select is((select count(*)::int from public.stock_movement where tenant_id = '11111111-1111-4111-8111-111111111111'), 2, 'nothing was written to A''s ledger by any of the refused calls');
select is((select count(*)::int from public.stock_opening), 1, 'and no operation was booked by B (A''s one fixture row only)');
select is((select count(*)::int from public.opening_draft_line where tenant_id = '11111111-1111-4111-8111-111111111111'), 1, 'and A''s draft line is still there');

-- 3. Mutation: a policy that lets B read A's ledger turns the first group red. The block is rolled back; the ledger is not touched ----------------------------------------------
create function pg_temp.mutated_a_rows() returns text language plpgsql as $$
declare
  v text;
begin
  begin
    create policy x_mutation_b_reads_a on public.stock_movement for select to authenticated using (tenant_id = '11111111-1111-4111-8111-111111111111');
    set local role authenticated;
    perform pg_temp.as_b('owner');
    v := pg_temp.a_rows();
    reset role;
    raise exception 'mutation_rollback' using errcode = 'RB001';
  exception when sqlstate 'RB001' then
    null;
  end;
  return v;
end
$$;
select is(pg_temp.mutated_a_rows(), '2/0/0', 'mutation: with a policy that lets B read A, B''s owner reads A''s two movements, so the first group''s "0/0/0" would fail');
select is((select count(*)::int from pg_policy where polname = 'x_mutation_b_reads_a'), 0, 'and the mutation is gone');

select * from finish();
rollback;
