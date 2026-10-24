-- Demo data step 4 (migration 20261105100300_demo_purge.sql; ADR-018): the purge of a demo tenant.
-- Fixture: the demo tenant D and two real tenants R1 and R2, each with two rows in EVERY table of app.demo_purge_tables()
-- (plus two app.alert_refusal rows), written as the migration owner. The purge deletes D and nothing else: R1 and R2 keep
-- every table's rows, byte for byte (md5 of the rows), and stay append-only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

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

-- A digest of every row of the tenant in every table of the list, plus its alert_refusal rows.
create function pg_temp.snap(p_tenant uuid) returns text language plpgsql as $$
declare
  t text;
  r text;
  out text := '';
begin
  foreach t in array app.demo_purge_tables() loop
    execute format('select coalesce(md5(string_agg(x::text, %L order by x::text)), %L) from public.%I x where x.%I = $1',
                   ',', '-', t, case when t = 'tenant' then 'id' else 'tenant_id' end) into r using p_tenant;
    out := out || t || '=' || r || ';';
  end loop;
  select coalesce(md5(string_agg(x::text, ',' order by x::text)), '-') into r from app.alert_refusal x where x.tenant_id = p_tenant;
  return md5(out || 'alert_refusal=' || r);
end
$$;
-- The fewest rows any listed table holds for the tenant (the tenant table itself holds one), and the total.
create function pg_temp.minmax(p_tenant uuid) returns text language sql as $$
  select min(value::int) filter (where key <> 'tenant') || '/' || sum(value::int) from jsonb_each_text(app.demo_tenant_counts(p_tenant))
$$;

create function pg_temp.id(p_tag text, p_k text) returns uuid language sql as $$
  select md5(p_tag || ':' || p_k)::uuid
$$;

create function pg_temp.mkall(p_tenant uuid, p_tag text) returns void language plpgsql as $$
declare
  v_owner uuid := (select id from public.app_user where tenant_id = p_tenant and role = 'owner');
  i int;
  k text;
  v_hex text;
begin
  for i in 1..2 loop
    k := i::text;
    -- staff, devices, sessions, attempts, codes
    insert into auth.users (id, email) values (pg_temp.id(p_tag, 'au' || k), 'staff-' || p_tag || k || '@staff.invalid');
    insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, created_by)
      values (pg_temp.id(p_tag, 'usr' || k), p_tenant, pg_temp.id(p_tag, 'au' || k), case i when 1 then 'chef' else 'waiter' end::public.app_role,
              'Personale ' || k || ' (demo)', 'pin', v_owner);
    insert into public.device_enrolment (id, tenant_id, label, code_hash, expires_at, created_by)
      values (pg_temp.id(p_tag, 'enr' || k), p_tenant, 'Codice ' || k || ' (demo)', repeat(md5(p_tag || 'enr' || k), 2), '2026-10-24T10:00:00Z', v_owner);
    insert into public.venue_device (id, tenant_id, label, token_hash, enrolment_id, created_by)
      values (pg_temp.id(p_tag, 'dev' || k), p_tenant, 'Dispositivo ' || k || ' (demo)', repeat(md5(p_tag || 'dev' || k), 2), pg_temp.id(p_tag, 'enr' || k), v_owner);
    update public.device_enrolment set used_at = '2026-10-24T09:00:00Z', device_id = pg_temp.id(p_tag, 'dev' || k) where id = pg_temp.id(p_tag, 'enr' || k);
    insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at)
      values (pg_temp.id(p_tag, 'ses' || k), p_tenant, pg_temp.id(p_tag, 'usr' || k), pg_temp.id(p_tag, 'dev' || k), pg_temp.id(p_tag, 'as' || k), '2026-10-24T09:00:00Z', '2026-10-25T00:00:00Z');
    insert into public.auth_attempt (id, tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
      values (pg_temp.id(p_tag, 'att' || k), p_tenant, pg_temp.id(p_tag, 'dev' || k), pg_temp.id(p_tag, 'usr' || k), 'success', '2026-10-24T09:00:00Z', '2026-10-24T09:00:01Z');

    -- master data
    insert into public.location (id, tenant_id, name) values (pg_temp.id(p_tag, 'loc' || k), p_tenant, 'Luogo ' || k || ' (demo)');
    insert into public.ingredient (id, tenant_id, name, base_unit) values (pg_temp.id(p_tag, 'ing' || k), p_tenant, 'Ingrediente ' || k || ' (demo)', 'kg');
    insert into public.supplier (id, tenant_id, name, vat_number)
      values (pg_temp.id(p_tag, 'sup' || k), p_tenant, 'Fornitore ' || k || ' (demo)', case i when 1 then 'IT12345678903' else 'IT00000000000' end);
    insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit)
      values (pg_temp.id(p_tag, 'item' || k), p_tenant, pg_temp.id(p_tag, 'sup' || k), pg_temp.id(p_tag, 'ing' || k), 'COD-' || k, 1, 'kg');
    insert into public.cost_centre (id, tenant_id, name) values (pg_temp.id(p_tag, 'cc' || k), p_tenant, 'Centro ' || k || ' (demo)');

    -- invoices, payables, prices, stock
    insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename, created_by)
      values (pg_temp.id(p_tag, 'inv' || k), p_tenant, p_tenant || '/2026/' || pg_temp.id(p_tag, 'inv' || k) || '.pdf', 'application/pdf', 2048, 'fattura.pdf', v_owner);
    insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
      values (pg_temp.id(p_tag, 'line' || k), p_tenant, pg_temp.id(p_tag, 'inv' || k), 1, 'Riga ' || k || ' (demo)', 2, 5, 10, '{}', '{}');
    insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date, due_date_source, created_by)
      values (pg_temp.id(p_tag, 'pay' || k), p_tenant, pg_temp.id(p_tag, 'inv' || k), pg_temp.id(p_tag, 'sup' || k), 10, 0, 10, '2026-11-20', 'invoice', v_owner);
    insert into public.price_history (id, tenant_id, ingredient_id, supplier_id, supplier_item_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
      values (pg_temp.id(p_tag, 'ph' || k), p_tenant, pg_temp.id(p_tag, 'ing' || k), pg_temp.id(p_tag, 'sup' || k), pg_temp.id(p_tag, 'item' || k), pg_temp.id(p_tag, 'line' || k), 5, 'kg', '2026-10-01', v_owner);
    insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
      values (pg_temp.id(p_tag, 'lot' || k), p_tenant, pg_temp.id(p_tag, 'ing' || k), pg_temp.id(p_tag, 'loc' || k), pg_temp.id(p_tag, 'sup' || k), pg_temp.id(p_tag, 'line' || k), '2026-10-01', 2, 'kg', 2, 'kg', 1, v_owner);
    insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
      values (pg_temp.id(p_tag, 'mov' || k), p_tenant, pg_temp.id(p_tag, 'ing' || k), pg_temp.id(p_tag, 'lot' || k), pg_temp.id(p_tag, 'loc' || k), 'receipt', 2, 5, 'invoice_line', pg_temp.id(p_tag, 'line' || k), '2026-10-01', v_owner);
    insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
      values (pg_temp.id(p_tag, 'use' || k), p_tenant, pg_temp.id(p_tag, 'ing' || k), pg_temp.id(p_tag, 'lot' || k), pg_temp.id(p_tag, 'loc' || k), 'consumption', -1, 5, 'batch', pg_temp.id(p_tag, 'bat' || k), '2026-10-02', v_owner);

    -- counts
    insert into public.count_session (id, tenant_id, location_id, type, started_by) values (pg_temp.id(p_tag, 'cs' || k), p_tenant, pg_temp.id(p_tag, 'loc' || k), 'daily', v_owner);
    insert into public.count_line (id, tenant_id, session_id, ingredient_id, position, created_by)
      values (pg_temp.id(p_tag, 'cl' || k), p_tenant, pg_temp.id(p_tag, 'cs' || k), pg_temp.id(p_tag, 'ing' || k), 1, v_owner);

    -- recipes: a batch recipe and a plate that uses it, per i
    insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
      values (pg_temp.id(p_tag, 'rkb' || k), p_tenant, 'batch', 1, 'ragu ' || k, v_owner),
             (pg_temp.id(p_tag, 'rkp' || k), p_tenant, 'plate', 1, 'tagliatelle ' || k, v_owner);
    insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by)
      values (pg_temp.id(p_tag, 'rb' || k), p_tenant, pg_temp.id(p_tag, 'rkb' || k), 1, '2026-10-01', 'Ragù ' || k || ' (demo)', 8, 'kg', 40, 72, v_owner);
    insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
      values (pg_temp.id(p_tag, 'rp' || k), p_tenant, pg_temp.id(p_tag, 'rkp' || k), 1, '2026-10-01', 'Tagliatelle ' || k || ' (demo)', v_owner);
    insert into public.recipe_line (id, tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by)
      values (pg_temp.id(p_tag, 'rlb' || k), p_tenant, pg_temp.id(p_tag, 'rb' || k), 1, pg_temp.id(p_tag, 'ing' || k), 1, 'kg', v_owner);
    insert into public.recipe_line (id, tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by)
      values (pg_temp.id(p_tag, 'rlp' || k), p_tenant, pg_temp.id(p_tag, 'rp' || k), 1, pg_temp.id(p_tag, 'rkb' || k), 1, 'porz', v_owner);
    insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
      values (pg_temp.id(p_tag, 'rp' || k), p_tenant, 14, 70, v_owner);

    -- batches
    insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
                              output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, location_id, created_by)
      values (pg_temp.id(p_tag, 'bat' || k), p_tenant, pg_temp.id(p_tag, 'rkb' || k), pg_temp.id(p_tag, 'rb' || k), 1, '261024-RAG-' || k, '2026-10-24', 'RAG', i,
              '2026-10-24T09:00:00Z', v_owner, 8, 'kg', 40, 40, 72, '2026-10-24T09:00:00Z'::timestamptz + interval '72 hours', pg_temp.id(p_tag, 'loc' || k), v_owner);
    insert into public.batch_movement (id, tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
      values (pg_temp.id(p_tag, 'bm' || k), p_tenant, pg_temp.id(p_tag, 'bat' || k), 'produce', 40, 'batch', pg_temp.id(p_tag, 'bat' || k), '2026-10-24', v_owner);
    insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
      values (pg_temp.id(p_tag, 'bat' || k), p_tenant, 20, 0.5, false, '{}', '2026-10-24T09:00:00Z', v_owner);
    insert into public.batch_input (id, tenant_id, batch_id, ingredient_id, location_id, raw_lot_id, qty, stock_movement_id, created_by)
      values (pg_temp.id(p_tag, 'bi' || k), p_tenant, pg_temp.id(p_tag, 'bat' || k), pg_temp.id(p_tag, 'ing' || k), pg_temp.id(p_tag, 'loc' || k), pg_temp.id(p_tag, 'lot' || k), 1, pg_temp.id(p_tag, 'use' || k), v_owner);
    insert into public.staff_meal_rule (id, tenant_id, recipe_key, default_count, created_by, updated_by)
      values (pg_temp.id(p_tag, 'smr' || k), p_tenant, pg_temp.id(p_tag, 'rkb' || k), 4, v_owner, v_owner);
    insert into public.staff_meal_confirmation (id, tenant_id, rule_id, business_date, count, created_by)
      values (pg_temp.id(p_tag, 'smc' || k), p_tenant, pg_temp.id(p_tag, 'smr' || k), '2026-10-24', 4, v_owner);

    -- costs, duplicates, alerts, audit, refusals
    insert into public.fixed_cost_period (id, tenant_id, month, rent, labour, utilities, created_by)
      values (pg_temp.id(p_tag, 'fc' || k), p_tenant, case i when 1 then date '2026-09-01' else date '2026-10-01' end, 100, 200, 50, v_owner);
    insert into public.ingredient_cost_basis (id, tenant_id, ingredient_id, basis, valid_from, created_by)
      values (pg_temp.id(p_tag, 'icb' || k), p_tenant, pg_temp.id(p_tag, 'ing' || k), 'moving_average', '2026-10-01', v_owner);
    insert into public.alert (id, tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles, cost_bearing, payload)
      values (pg_temp.id(p_tag, 'alr' || k), p_tenant, 'test_alert', 'ingredient', pg_temp.id(p_tag, 'ing' || k), '2026-10-24', 'info', '{owner}', false, '{}');
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
      values (p_tenant, 'invoice', pg_temp.id(p_tag, 'inv' || k), 'invoice.approved', v_owner);
    insert into app.alert_refusal (tenant_id, kind, caller, code, sqlstate) values (p_tenant, 'test_alert', 'alert_rules', 'unknown_alert_kind', 'P0001');
  end loop;
  -- A third invoice, so there are two distinct duplicate pairs.
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename, created_by)
    values (pg_temp.id(p_tag, 'inv3'), p_tenant, p_tenant || '/2026/' || pg_temp.id(p_tag, 'inv3') || '.pdf', 'application/pdf', 2048, 'fattura.pdf', v_owner);
  insert into public.invoice_duplicate_decision (id, tenant_id, invoice_id, other_id, decided_by)
    values (pg_temp.id(p_tag, 'idd1'), p_tenant, pg_temp.id(p_tag, 'inv1'), pg_temp.id(p_tag, 'inv2'), v_owner),
           (pg_temp.id(p_tag, 'idd2'), p_tenant, pg_temp.id(p_tag, 'inv1'), pg_temp.id(p_tag, 'inv3'), v_owner);
end
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-0000000000a1', 'owner-r1@example.test'),
  ('a0000000-0000-4000-8000-0000000000a2', 'owner-r2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d1', 'owner-demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'admin-demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d3', 'owner-demo-2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d4', 'admin-demo-2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d5', 'owner-demo-3@example.test'),
  ('d0000000-0000-4000-8000-0000000000d6', 'admin-demo-3@example.test');
select public.create_tenant_with_owner('Locale Uno (demo)', 'IT00000000001', 'a0000000-0000-4000-8000-0000000000a1', 'Titolare Uno (demo)');
select public.create_tenant_with_owner('Locale Due (demo)', 'IT00000000002', 'a0000000-0000-4000-8000-0000000000a2', 'Titolare Due (demo)');
select public.create_demo_tenant('Osteria Demo (dati di prova)', 'IT00000000099', 'd0000000-0000-4000-8000-0000000000d1', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d2', 'Supporto DigiAlto (demo)');

create temp table ctx as
  select (select id from public.tenant where is_demo) as d,
         (select id from public.tenant where vat_number = 'IT00000000001') as r1,
         (select id from public.tenant where vat_number = 'IT00000000002') as r2;
create temp table res (label text, j jsonb);
create temp table snaps (label text, snap text);
grant all on ctx, res, snaps to public;

select pg_temp.mkall(d, 'D') from ctx;
select pg_temp.mkall(r1, 'R1') from ctx;
select pg_temp.mkall(r2, 'R2') from ctx;
insert into snaps select 'd', pg_temp.snap(d) from ctx;
insert into snaps select 'r1', pg_temp.snap(r1) from ctx;
insert into snaps select 'r2', pg_temp.snap(r2) from ctx;

-- The fixture ----------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from jsonb_object_keys(app.demo_tenant_counts((select d from ctx)))), (select cardinality(app.demo_purge_tables()) + 1 from ctx limit 1), 'the counts cover every listed table and alert_refusal');
select ok((select split_part(pg_temp.minmax(d), '/', 1)::int >= 2 from ctx), 'D has at least two rows in every table of the list (and in alert_refusal)');
select ok((select split_part(pg_temp.minmax(r1), '/', 1)::int >= 2 and split_part(pg_temp.minmax(r2), '/', 1)::int >= 2 from ctx), 'so do R1 and R2');

-- Grants ------------------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.purge_demo_tenant(text)', 'execute')), array['authenticated'], 'purge_demo_tenant: authenticated only');
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.purge_demo_tenant_by_id(uuid, text)', 'execute')), array['service_role'], 'purge_demo_tenant_by_id: service_role only');
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.demo_purge_pending()', 'execute')), array['service_role'], 'demo_purge_pending: service_role only');
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.demo_purge_cleanup_done(bigint, integer, integer)', 'execute')), array['service_role'], 'demo_purge_cleanup_done: service_role only');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role), unnest(array['app.purge_demo_tenant_core(uuid, text, uuid)', 'app.demo_purge_tables()', 'app.demo_tenant_counts(uuid)']) f(fn)
            where has_function_privilege(r.role, f.fn, 'execute')), 0, 'the core, the table list and the counts are closed to every API role');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_table_privilege(r.role, 'app.demo_purge_log', 'select, insert, update, delete, truncate')
               or has_any_column_privilege(r.role, 'app.demo_purge_log', 'select, insert, update')), 0, 'no API role has a privilege on app.demo_purge_log');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'app.demo_purge_log'::regclass), 'and it has RLS on');

-- Refused callers: nothing is deleted ---------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-0000000000d1', (select d from ctx), 'owner');
select is(pg_temp.err($$ select public.purge_demo_tenant('osteria demo') $$), 'P0001:confirm_name_mismatch', 'owner of D, wrong name (lower case, cut): confirm_name_mismatch');
select is(pg_temp.err($$ select public.purge_demo_tenant('Osteria Demo (dati di prova) ') $$), 'P0001:confirm_name_mismatch', 'a name with a trailing space: mismatch');
select is(pg_temp.err($$ select public.purge_demo_tenant(null) $$), 'P0001:confirm_name_mismatch', 'a null name: mismatch');
select pg_temp.act_as('d0000000-0000-4000-8000-0000000000d2', (select d from ctx), 'admin');
select is(left(pg_temp.err($$ select public.purge_demo_tenant('Osteria Demo (dati di prova)') $$), 6), '42501:', 'admin of D: refused');
select pg_temp.act_as(pg_temp.id('D', 'au1'), (select d from ctx), 'chef');
select is(left(pg_temp.err($$ select public.purge_demo_tenant('Osteria Demo (dati di prova)') $$), 6), '42501:', 'chef of D: refused');
select pg_temp.act_as(pg_temp.id('D', 'au2'), (select d from ctx), 'waiter');
select is(left(pg_temp.err($$ select public.purge_demo_tenant('Osteria Demo (dati di prova)') $$), 6), '42501:', 'waiter of D: refused');
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000a1', (select r1 from ctx), 'owner');
select is(pg_temp.err($$ select public.purge_demo_tenant('Locale Uno (demo)') $$), '42501:not_demo_tenant', 'owner of a real tenant, with its exact name: not_demo_tenant');
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000a2', (select r2 from ctx), 'owner');
select is(pg_temp.err($$ select public.purge_demo_tenant('Osteria Demo (dati di prova)') $$), '42501:not_demo_tenant', 'owner of the other real tenant, with the demo name: not_demo_tenant');
-- An owner of D whose token names another tenant is not an owner of anything.
select pg_temp.act_as('d0000000-0000-4000-8000-0000000000d1', (select r1 from ctx), 'owner');
select is(left(pg_temp.err($$ select public.purge_demo_tenant('Osteria Demo (dati di prova)') $$), 6), '42501:', 'D''s owner with a token that names R1: refused');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err($$ select public.purge_demo_tenant('Osteria Demo (dati di prova)') $$), 6), '42501:', 'no session: refused');
reset role;

set local role service_role;
select is(pg_temp.err(format('select public.purge_demo_tenant_by_id(%L, %L)', (select r1 from ctx), 'Locale Uno (demo)')), '42501:not_demo_tenant', 'by id, R1 (with its exact name): not_demo_tenant');
select is(pg_temp.err(format('select public.purge_demo_tenant_by_id(%L, %L)', (select r2 from ctx), 'Osteria Demo (dati di prova)')), '42501:not_demo_tenant', 'by id, R2: not_demo_tenant');
select is(pg_temp.err(format('select public.purge_demo_tenant_by_id(%L, %L)', gen_random_uuid(), 'x')), '42501:not_demo_tenant', 'by id, an unknown tenant: not_demo_tenant');
select is(pg_temp.err(format('select public.purge_demo_tenant_by_id(%L, %L)', (select d from ctx), 'Osteria Demo')), 'P0001:confirm_name_mismatch', 'by id, D with a wrong name: confirm_name_mismatch');
select is(pg_temp.err(format('select public.purge_demo_tenant_by_id(%L, null)', (select d from ctx))), 'P0001:confirm_name_mismatch', 'by id, D with no name: confirm_name_mismatch');
reset role;

select is((select pg_temp.snap(d) = (select snap from snaps where label = 'd') from ctx), true, 'D is byte for byte what it was after all those refusals');
select is((select pg_temp.snap(r1) = (select snap from snaps where label = 'r1') and pg_temp.snap(r2) = (select snap from snaps where label = 'r2') from ctx), true, 'and so are R1 and R2');
select is((select count(*)::int from app.demo_purge_log), 0, 'no purge was logged');
select is(coalesce(current_setting('app.demo_purge', true), ''), '', 'and the setting is empty');

-- The owner of D purges D from the app ------------------------------------------------------------------------------------------------------
create temp table before_d as select app.demo_tenant_counts((select d from ctx)) as counts, (select d from ctx) as d;
grant all on before_d to public;
set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-0000000000d1', (select d from ctx), 'owner');
select is(pg_temp.err($$ insert into res select 'app', public.purge_demo_tenant('Osteria Demo (dati di prova)') $$), 'ok', 'the owner of D purges D with the exact name');
reset role;
select set_config('request.jwt.claims', '', true);

select is((select j ->> 'tenantId' from res where label = 'app'), (select d::text from ctx), 'the result names the tenant');
select is((select j -> 'rowCounts' from res where label = 'app'), (select counts from before_d), 'and carries the row counts from before the purge');
select is((select count(*)::int from public.tenant where is_demo), 0, 'D is gone');
select is((select pg_temp.minmax(d) from ctx), '0/0', 'every table of the list holds no D row, nor alert_refusal');
select is((select count(*)::int from public.app_user where tenant_id = (select d from ctx)), 0, 'no D user (the tenant and its users went in one statement)');
select is((select count(*)::int from public.venue_device where tenant_id = (select d from ctx)) + (select count(*)::int from public.device_enrolment where tenant_id = (select d from ctx)), 0, 'devices and codes too (they reference each other)');
select is((select count(*)::int from app.demo_purge_log), 1, 'one log row');
select is((select l.via || ',' || (l.tenant_id = (select d from ctx)) || ',' || l.tenant_name || ',' || (l.cleaned_at is null) from app.demo_purge_log l),
          'app,true,Osteria Demo (dati di prova),true', 'via app, for D, with the name, not cleaned yet');
select is((select l.row_counts from app.demo_purge_log l), (select counts from before_d), 'the log keeps the counts');
select is((select l.actor_auth from app.demo_purge_log l), 'd0000000-0000-4000-8000-0000000000d1'::uuid, 'and the actor');
select is((select cardinality(l.auth_ids) from app.demo_purge_log l), 4, 'four auth ids: owner, admin and the two staff');
select ok((select l.auth_ids @> array['d0000000-0000-4000-8000-0000000000d1'::uuid, 'd0000000-0000-4000-8000-0000000000d2'::uuid, pg_temp.id('D', 'au1'), pg_temp.id('D', 'au2')] from app.demo_purge_log l), 'they are the ids of D''s users');
select is((select pg_temp.snap(r1) = (select snap from snaps where label = 'r1') and pg_temp.snap(r2) = (select snap from snaps where label = 'r2') from ctx), true, 'R1 and R2 are byte for byte unchanged');
select is(coalesce(current_setting('app.demo_purge', true), ''), '', 'the setting is empty after the purge');

-- Real tenants stay append-only, and only a demo can be purged again --------------------------------------------------------------------
select is(pg_temp.err($$ delete from public.stock_movement where tenant_id = (select r1 from ctx) $$), 'P0001:append_only', 'R1''s ledger rows still cannot be deleted');
select is(pg_temp.err($$ update public.audit_event set reason = 'x' where tenant_id = (select r1 from ctx) $$), 'P0001:append_only', 'nor updated');
select is(pg_temp.err($$ truncate public.audit_event $$), 'P0001:append_only', 'nor truncated');
select is(pg_temp.err($$ delete from public.venue_device where tenant_id = (select r2 from ctx) $$), 'P0001:venue_device_immutable', 'R2''s devices neither');

-- The script path: a second demo tenant, purged by id -----------------------------------------------------------------------------------------
select public.create_demo_tenant('Osteria Demo (dati di prova)', 'IT00000000098', 'd0000000-0000-4000-8000-0000000000d3', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d4', 'Supporto DigiAlto (demo)');
create temp table ctx2 as select (select id from public.tenant where is_demo) as d2;
grant select on ctx2 to public;
select pg_temp.mkall(d2, 'E') from ctx2;
select is((select d2 <> d from ctx2, ctx), true, 'a new demo tenant, a new id');
set local role service_role;
select is(pg_temp.err(format('insert into res select %L, public.purge_demo_tenant_by_id(%L, %L)', 'script', (select d2 from ctx2), 'Osteria Demo (dati di prova)')), 'ok', 'the script path purges it by id');
reset role;
select is((select j ->> 'tenantId' from res where label = 'script'), (select d2::text from ctx2), 'the result names the tenant');
select is((select pg_temp.minmax(d2) from ctx2), '0/0', 'nothing of it is left');
select is((select count(*)::int from public.tenant where is_demo), 0, 'no demo tenant remains');
select is((select l.via || ',' || coalesce(l.actor_auth::text, 'none') from app.demo_purge_log l where l.tenant_id = (select d2 from ctx2)), 'script,none', 'logged via script, no actor');
select is((select pg_temp.snap(r1) = (select snap from snaps where label = 'r1') and pg_temp.snap(r2) = (select snap from snaps where label = 'r2') from ctx), true, 'R1 and R2 are still byte for byte unchanged');

-- One transaction: a failure part-way leaves everything as it was ------------------------------------------------------------------------
select public.create_demo_tenant('Osteria Demo (dati di prova)', 'IT00000000097', 'd0000000-0000-4000-8000-0000000000d5', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d6', 'Supporto DigiAlto (demo)');
create temp table ctx3 as select (select id from public.tenant where is_demo) as d3;
grant select on ctx3 to public;
select pg_temp.mkall(d3, 'F') from ctx3;
insert into snaps select 'f', pg_temp.snap(d3) from ctx3;
-- A table the list does not know, with a row of F in it: the last statement of the purge must fail on its foreign key.
create table public.zz_rogue (id int primary key, tenant_id uuid not null references public.tenant (id));
insert into public.zz_rogue select 1, d3 from ctx3;
select is(left(pg_temp.err(format('select public.purge_demo_tenant_by_id(%L, %L)', (select d3 from ctx3), 'Osteria Demo (dati di prova)')), 6), '23503:', 'a table outside the list that still references the tenant makes the purge fail (23503)');
select is((select pg_temp.snap(d3) = (select snap from snaps where label = 'f') from ctx3), true, 'and nothing at all was deleted');
select is((select count(*)::int from app.demo_purge_log), 2, 'no log row for the failed attempt');
select is(coalesce(current_setting('app.demo_purge', true), ''), '', 'and the setting is empty');
drop table public.zz_rogue;

-- Pending and cleanup ----------------------------------------------------------------------------------------------------------------------------
set local role service_role;
select is((select count(*)::int from public.demo_purge_pending()), 2, 'demo_purge_pending lists both purges');
select is((select p.tenant_name || ',' || cardinality(p.auth_ids) from public.demo_purge_pending() p where p.tenant_id = (select d2 from ctx2)), 'Osteria Demo (dati di prova),4', 'with the name and the ids to remove');
reset role;
-- A refusal written after the purge (an hourly run that lost the race) belongs to the purged tenant.
insert into app.alert_refusal (tenant_id, kind, caller, code, sqlstate) select d2, 'test_alert', 'alert_rules', 'unknown_alert_kind', 'P0001' from ctx2;
create temp table pend as select p.id, p.tenant_id from public.demo_purge_pending() p;
grant select on pend to public;
set local role service_role;
select is(pg_temp.err(format('select public.demo_purge_cleanup_done(%L, 4, 3)', (select id from pend where tenant_id = (select d2 from ctx2)))), 'ok', 'cleanup_done accepts a pending row');
select is(pg_temp.err(format('select public.demo_purge_cleanup_done(%L, 4, 3)', (select id from pend where tenant_id = (select d2 from ctx2)))), 'P0001:purge_log_not_found', 'and refuses the same row twice');
select is(pg_temp.err('select public.demo_purge_cleanup_done(-1, 0, 0)'), 'P0001:purge_log_not_found', 'and an unknown row');
select is(left(pg_temp.err(format('select public.demo_purge_cleanup_done(%L, -1, 0)', (select id from pend where tenant_id = (select d from ctx)))), 6), '23514:', 'and a negative count');
select is((select count(*)::int from public.demo_purge_pending()), 1, 'one purge is still pending');
reset role;
select is((select l.cleaned_at is not null and l.auth_ids = '{}' and l.actor_auth is null and l.auth_deleted = 4 and l.objects_deleted = 3
             from app.demo_purge_log l where l.tenant_id = (select d2 from ctx2)), true, 'cleaned: time set, ids and actor emptied, the counts kept');
select is((select count(*)::int from app.alert_refusal where tenant_id = (select d2 from ctx2)), 0, 'cleanup_done removed the late refusal row of the purged tenant');
select is((select count(*)::int from app.alert_refusal where tenant_id in (select r1 from ctx union select r2 from ctx)), 4, 'and left the real tenants'' refusal rows alone');
select is((select pg_temp.snap(r1) = (select snap from snaps where label = 'r1') and pg_temp.snap(r2) = (select snap from snaps where label = 'r2') from ctx), true, 'R1 and R2: still byte for byte unchanged at the end');

select * from finish();
rollback;
