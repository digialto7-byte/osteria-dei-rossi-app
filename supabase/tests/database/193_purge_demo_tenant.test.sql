-- Demo data step 4 (migration 20261105100300_demo_purge.sql; ADR-018 revision 1): purge_demo_data resets the operational data of a
-- tenant that begin_demo_data marked. Fixture: the target D (a real tenant with its own founder-owner, an old real staff user,
-- an old device and an old audit row, all from BEFORE the marker) which then gets the demo owner and admin and two rows in EVERY
-- table of app.demo_purge_tables() (plus two app.alert_refusal rows), and two unmarked tenants R1 and R2 with the same rows.
-- The reset deletes D's operational rows and the demo users and nothing else: D keeps its row, its founder, its old real staff,
-- device and audit row; R1 and R2 keep every table's rows, byte for byte (md5 of the rows), and stay append-only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(89);

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
-- The fewest rows any listed table holds for the tenant (sale_settings is one row per tenant by design, M17 unique (tenant_id),
-- and is checked on its own; the tenant table holds the one tenant row), and the total.
create function pg_temp.minmax(p_tenant uuid) returns text language sql as $$
  select min(value::int) filter (where key not in ('sale_settings', 'tenant')) || '/' || sum(value::int) from jsonb_each_text(app.demo_tenant_counts(p_tenant))
$$;

create function pg_temp.id(p_tag text, p_k text) returns uuid language sql as $$
  select md5(p_tag || ':' || p_k)::uuid
$$;

create function pg_temp.mkall(p_tenant uuid, p_tag text, v_owner uuid) returns void language plpgsql as $$
declare
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
      values (pg_temp.id(p_tag, 'ses' || k), p_tenant, pg_temp.id(p_tag, 'usr' || k), pg_temp.id(p_tag, 'dev' || k), pg_temp.id(p_tag, 'as' || k), now(), now() + interval '1 day');
    insert into public.auth_attempt (id, tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
      values (pg_temp.id(p_tag, 'att' || k), p_tenant, pg_temp.id(p_tag, 'dev' || k), pg_temp.id(p_tag, 'usr' || k), 'success', now(), now() + interval '1 second');

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

    -- M17: menu items (one per plate key), their prices, two tables, a closed session per table; settings once per tenant
    insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by)
      values (pg_temp.id(p_tag, 'mi' || k), p_tenant, 'Piatto ' || k || ' (demo)', 'Primi', 'primi', pg_temp.id(p_tag, 'rkp' || k), v_owner, v_owner);
    insert into public.menu_item_price (id, tenant_id, menu_item_id, price, vat_rate, created_by)
      values (pg_temp.id(p_tag, 'mip' || k), p_tenant, pg_temp.id(p_tag, 'mi' || k), 14, 10, v_owner);
    insert into public.dining_table (id, tenant_id, name, created_by, updated_by)
      values (pg_temp.id(p_tag, 'dt' || k), p_tenant, 'Tavolo ' || k || ' (demo)', v_owner, v_owner);
    insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, business_date, coperto_amount, coperto_vat_rate,
                                      opened_by, closed_at, closed_by, created_by, updated_by)
      values (pg_temp.id(p_tag, 'ts' || k), p_tenant, pg_temp.id(p_tag, 'dt' || k), 'Tavolo ' || k || ' (demo)', 2, '2026-10-24', 2, 10,
              v_owner, '2026-10-24T20:00:00Z', v_owner, v_owner, v_owner);
    if i = 1 then
      insert into public.sale_settings (id, tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
        values (pg_temp.id(p_tag, 'ss'), p_tenant, 2, 10, v_owner, v_owner);
    end if;

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
  ('f0000000-0000-4000-8000-0000000000f1', 'owner-d@example.test'),
  ('f0000000-0000-4000-8000-0000000000f2', 'staff-real@staff.invalid'),
  ('f0000000-0000-4000-8000-0000000000f3', 'staff-real-later@staff.invalid'),
  ('d0000000-0000-4000-8000-0000000000d1', 'owner.demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'admin.demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d3', 'owner.demo2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d4', 'admin.demo2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d5', 'owner.demo3@example.test'),
  ('d0000000-0000-4000-8000-0000000000d6', 'admin.demo3@example.test');
select public.create_tenant_with_owner('Locale Uno (demo)', 'IT00000000001', 'a0000000-0000-4000-8000-0000000000a1', 'Titolare Uno (demo)');
select public.create_tenant_with_owner('Locale Due (demo)', 'IT00000000002', 'a0000000-0000-4000-8000-0000000000a2', 'Titolare Due (demo)');
select public.create_tenant_with_owner('Locale Target (demo)', 'IT00000000099', 'f0000000-0000-4000-8000-0000000000f1', 'Titolare Target (demo)');

create temp table ctx as
  select (select id from public.tenant where vat_number = 'IT00000000099') as d,
         (select id from public.tenant where vat_number = 'IT00000000001') as r1,
         (select id from public.tenant where vat_number = 'IT00000000002') as r2,
         (select u.id from public.app_user u where u.auth_id = 'f0000000-0000-4000-8000-0000000000f1') as founder;
create temp table res (label text, j jsonb);
create temp table snaps (label text, snap text);
grant all on ctx, res, snaps to public;

-- D before the marker: the founder from long ago, a real staff user, a device, a used code, a session and an audit row of the
-- venue itself. None of it is operational data, so begin_demo_data accepts the tenant.
update public.tenant set settings = settings || '{"kept": "yes"}'::jsonb where id = (select d from ctx);
update public.app_user set created_at = '2026-01-01T09:00:00Z' where id = (select founder from ctx);
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, created_by, created_at)
  select pg_temp.id('REAL', 'usr'), d, 'f0000000-0000-4000-8000-0000000000f2', 'waiter', 'Cameriere reale (demo)', 'pin', founder, '2026-01-02T09:00:00Z' from ctx;
insert into public.device_enrolment (id, tenant_id, label, code_hash, expires_at, created_by, created_at)
  select pg_temp.id('REAL', 'enr'), d, 'Codice reale (demo)', repeat(md5('REALenr'), 2), '2026-01-02T10:00:00Z', founder, '2026-01-02T09:00:00Z' from ctx;
insert into public.venue_device (id, tenant_id, label, token_hash, enrolment_id, created_by, created_at)
  select pg_temp.id('REAL', 'dev'), d, 'Telefono reale (demo)', repeat(md5('REALdev'), 2), pg_temp.id('REAL', 'enr'), founder, '2026-01-02T09:00:00Z' from ctx;
update public.device_enrolment set used_at = '2026-01-02T09:30:00Z', device_id = pg_temp.id('REAL', 'dev') where id = pg_temp.id('REAL', 'enr');
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at)
  select pg_temp.id('REAL', 'ses'), d, pg_temp.id('REAL', 'usr'), pg_temp.id('REAL', 'dev'), pg_temp.id('REAL', 'as'), '2026-01-03T09:00:00Z', '2026-01-04T00:00:00Z' from ctx;
insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by, created_at)
  select d, 'tenant', d, 'tenant.settings_changed', founder, '2026-01-05T09:00:00Z' from ctx;
create temp table real_before as
  select md5(string_agg(x::text, ',' order by x::text)) as users from public.app_user x where x.tenant_id = (select d from ctx);
create temp table settings_before as select settings from public.tenant where id = (select d from ctx);
grant select on real_before, settings_before to public;

select public.begin_demo_data((select d from ctx), 'd0000000-0000-4000-8000-0000000000d1', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d2', 'Supporto DigiAlto (demo)');
create temp table demo_owner as select u.id from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d1';
grant select on demo_owner to public;
-- The demo changes the tenant's settings (the cost rules do), and the reset must put them back.
update public.tenant set settings = settings || '{"demo_cost_rule": 7}'::jsonb where id = (select d from ctx);

select pg_temp.mkall(d, 'D', (select id from demo_owner)) from ctx;
-- A real user the REAL owner adds AFTER the marker, with a login session on the real (old) device: not a demo user, so it and its
-- session must survive the reset byte for byte (demo users are the ones begin_demo_data made and those they created, never "newer
-- than the marker").
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, created_by)
  select pg_temp.id('LATER', 'usr'), d, 'f0000000-0000-4000-8000-0000000000f3', 'chef', 'Cuoco reale dopo (demo)', 'pin', founder from ctx;
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at)
  select pg_temp.id('LATER', 'ses'), d, pg_temp.id('LATER', 'usr'), pg_temp.id('REAL', 'dev'), pg_temp.id('LATER', 'as'), now(), now() + interval '1 day' from ctx;
-- A code from BEFORE the marker (the founder's) that was redeemed for a device the demo made: the reset deletes the code with the
-- device, or the foreign key from the code to the device would fail it.
insert into public.device_enrolment (id, tenant_id, label, code_hash, expires_at, created_by, created_at)
  select pg_temp.id('OLDCODE', 'enr'), d, 'Codice vecchio (demo)', repeat(md5('OLDCODE'), 2), '2026-01-02T10:00:00Z', founder, '2026-01-02T09:00:00Z' from ctx;
insert into public.venue_device (id, tenant_id, label, token_hash, enrolment_id, created_by)
  select pg_temp.id('OLDCODE', 'dev'), d, 'Dispositivo del codice vecchio (demo)', repeat(md5('OLDCODEdev'), 2), pg_temp.id('OLDCODE', 'enr'), (select id from demo_owner) from ctx;
update public.device_enrolment set used_at = '2026-01-02T09:30:00Z', device_id = pg_temp.id('OLDCODE', 'dev') where id = pg_temp.id('OLDCODE', 'enr');
create temp table later_before as
  select (select md5(x::text) from public.app_user x where x.id = pg_temp.id('LATER', 'usr')) as usr,
         (select md5(x::text) from public.staff_session x where x.id = pg_temp.id('LATER', 'ses')) as ses,
         (select array_agg(i.file_path order by i.file_path) from public.invoice i where i.tenant_id = (select d from ctx)) as paths;
grant select on later_before to public;
select pg_temp.mkall(r1, 'R1', (select id from public.app_user where tenant_id = r1)) from ctx;
select pg_temp.mkall(r2, 'R2', (select id from public.app_user where tenant_id = r2)) from ctx;
insert into snaps select 'd', pg_temp.snap(d) from ctx;
insert into snaps select 'r1', pg_temp.snap(r1) from ctx;
insert into snaps select 'r2', pg_temp.snap(r2) from ctx;

-- The fixture ----------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from jsonb_object_keys(app.demo_tenant_counts((select d from ctx)))), (select cardinality(app.demo_purge_tables()) + 1 from ctx limit 1), 'the counts cover every listed table and alert_refusal');
select ok((select split_part(pg_temp.minmax(d), '/', 1)::int >= 2 from ctx), 'D has at least two rows in every table of the list (and in alert_refusal)');
select is((select count(*)::int from public.sale_settings where tenant_id in (select d from ctx union select r1 from ctx union select r2 from ctx)), 3, 'each tenant has its one sale_settings row');
select ok((select split_part(pg_temp.minmax(r1), '/', 1)::int >= 2 and split_part(pg_temp.minmax(r2), '/', 1)::int >= 2 from ctx), 'so do R1 and R2');
select is((select count(*)::int from public.tenant where demo_data_since is not null), 1, 'only D is marked');

-- Grants ------------------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.purge_demo_data(text)', 'execute')), array['authenticated'], 'purge_demo_data: authenticated only');
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.purge_demo_data_by_id(uuid, text)', 'execute')), array['service_role'], 'purge_demo_data_by_id: service_role only');
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.demo_purge_pending()', 'execute')), array['service_role'], 'demo_purge_pending: service_role only');
select is((select array_agg(r.role order by r.role) from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'public.demo_purge_cleanup_done(bigint, integer, integer)', 'execute')), array['service_role'], 'demo_purge_cleanup_done: service_role only');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role), unnest(array['app.purge_demo_data_core(uuid, text, uuid)', 'app.demo_purge_tables()', 'app.demo_tenant_counts(uuid)']) f(fn)
            where has_function_privilege(r.role, f.fn, 'execute')), 0, 'the core, the table list and the counts are closed to every API role');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_table_privilege(r.role, 'app.demo_purge_log', 'select, insert, update, delete, truncate')
               or has_any_column_privilege(r.role, 'app.demo_purge_log', 'select, insert, update')
               or has_table_privilege(r.role, 'app.demo_state', 'select, insert, update, delete, truncate')), 0, 'no API role has a privilege on app.demo_purge_log or app.demo_state');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'app.demo_purge_log'::regclass) and (select c.relrowsecurity from pg_class c where c.oid = 'app.demo_state'::regclass), 'and both have RLS on');

-- Refused callers: nothing is deleted ---------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('f0000000-0000-4000-8000-0000000000f1', (select d from ctx), 'owner');
select is(pg_temp.err($$ select public.purge_demo_data('locale target (demo)') $$), 'P0001:confirm_name_mismatch', 'owner of D, wrong name (lower case): confirm_name_mismatch');
select is(pg_temp.err($$ select public.purge_demo_data('Locale Target (demo) ') $$), 'P0001:confirm_name_mismatch', 'a name with a trailing space: mismatch');
select is(pg_temp.err($$ select public.purge_demo_data(null) $$), 'P0001:confirm_name_mismatch', 'a null name: mismatch');
select pg_temp.act_as('d0000000-0000-4000-8000-0000000000d2', (select d from ctx), 'admin');
select is(left(pg_temp.err($$ select public.purge_demo_data('Locale Target (demo)') $$), 6), '42501:', 'admin of D: refused');
select pg_temp.act_as(pg_temp.id('D', 'au1'), (select d from ctx), 'chef');
select is(left(pg_temp.err($$ select public.purge_demo_data('Locale Target (demo)') $$), 6), '42501:', 'chef of D: refused');
select pg_temp.act_as(pg_temp.id('D', 'au2'), (select d from ctx), 'waiter');
select is(left(pg_temp.err($$ select public.purge_demo_data('Locale Target (demo)') $$), 6), '42501:', 'waiter of D: refused');
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000a1', (select r1 from ctx), 'owner');
select is(pg_temp.err($$ select public.purge_demo_data('Locale Uno (demo)') $$), '42501:not_demo_tenant', 'owner of an unmarked tenant, with its exact name: not_demo_tenant');
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000a2', (select r2 from ctx), 'owner');
select is(pg_temp.err($$ select public.purge_demo_data('Locale Target (demo)') $$), '42501:not_demo_tenant', 'owner of the other unmarked tenant, with D''s name: not_demo_tenant');
-- An owner of D whose token names another tenant is not an owner of anything there.
select pg_temp.act_as('f0000000-0000-4000-8000-0000000000f1', (select r1 from ctx), 'owner');
select is(left(pg_temp.err($$ select public.purge_demo_data('Locale Target (demo)') $$), 6), '42501:', 'D''s owner with a token that names R1: refused');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err($$ select public.purge_demo_data('Locale Target (demo)') $$), 6), '42501:', 'no session: refused');
reset role;

set local role service_role;
select is(pg_temp.err(format('select public.purge_demo_data_by_id(%L, %L)', (select r1 from ctx), 'Locale Uno (demo)')), '42501:not_demo_tenant', 'by id, R1 (with its exact name): not_demo_tenant');
select is(pg_temp.err(format('select public.purge_demo_data_by_id(%L, %L)', (select r2 from ctx), 'Locale Target (demo)')), '42501:not_demo_tenant', 'by id, R2: not_demo_tenant');
select is(pg_temp.err(format('select public.purge_demo_data_by_id(%L, %L)', gen_random_uuid(), 'x')), '42501:not_demo_tenant', 'by id, an unknown tenant: not_demo_tenant');
select is(pg_temp.err(format('select public.purge_demo_data_by_id(%L, %L)', (select d from ctx), 'Locale Target')), 'P0001:confirm_name_mismatch', 'by id, D with a wrong name: confirm_name_mismatch');
select is(pg_temp.err(format('select public.purge_demo_data_by_id(%L, null)', (select d from ctx))), 'P0001:confirm_name_mismatch', 'by id, D with no name: confirm_name_mismatch');
reset role;

select is((select pg_temp.snap(d) = (select snap from snaps where label = 'd') from ctx), true, 'D is byte for byte what it was after all those refusals');
select is((select pg_temp.snap(r1) = (select snap from snaps where label = 'r1') and pg_temp.snap(r2) = (select snap from snaps where label = 'r2') from ctx), true, 'and so are R1 and R2');
select is((select count(*)::int from app.demo_purge_log), 0, 'no purge was logged');
select is(coalesce(current_setting('app.demo_purge', true), ''), '', 'and the setting is empty');

-- The owner of D resets D from the app ------------------------------------------------------------------------------------------------------
create temp table before_d as select app.demo_tenant_counts((select d from ctx)) as counts, (select d from ctx) as d;
grant all on before_d to public;
set local role authenticated;
select pg_temp.act_as('f0000000-0000-4000-8000-0000000000f1', (select d from ctx), 'owner');
select is(pg_temp.err($$ insert into res select 'app', public.purge_demo_data('Locale Target (demo)') $$), 'ok', 'the owner of D resets D with the exact name');
reset role;
select set_config('request.jwt.claims', '', true);

select is((select j ->> 'tenantId' from res where label = 'app'), (select d::text from ctx), 'the result names the tenant');
select is((select j -> 'rowCounts' from res where label = 'app'), (select counts from before_d), 'and carries the row counts from before the reset');
select is((select count(*)::int from public.tenant where id = (select d from ctx)), 1, 'D''s tenant row is still there');
select is((select demo_data_since is null from public.tenant where id = (select d from ctx)), true, 'its marker is cleared');
select is((select t.settings = b.settings from public.tenant t, settings_before b where t.id = (select d from ctx)), true, 'its settings are back to what they were before the demo');
select is((select count(*)::int from app.demo_state where tenant_id = (select d from ctx)), 0, 'and the state row is gone');
select is((select string_agg(key || '=' || value, ',' order by key) from jsonb_each_text(app.demo_tenant_counts((select d from ctx))) where value::int <> 0),
          'app_user=3,audit_event=2,device_enrolment=1,staff_session=2,tenant=1,venue_device=1', 'D keeps only: the tenant row, the founder and the old real staff user, the old audit row and the reset''s own, the old device, code and session');
select is((select string_agg(display_name, ',' order by display_name) from public.app_user where tenant_id = (select d from ctx)), 'Cameriere reale (demo),Cuoco reale dopo (demo),Titolare Target (demo)', 'the users left are the founder, the old real staff and the real user added after the marker');
select is((select md5(string_agg(x::text, ',' order by x::text)) from public.app_user x where x.tenant_id = (select d from ctx) and x.created_at < '2026-02-01') = (select users from real_before), true, 'the two users from before the demo are byte for byte as they were');
select is((select count(*)::int from public.audit_event e where e.tenant_id = (select d from ctx) and e.action = 'tenant.settings_changed' and e.created_at < '2026-02-01'), 1, 'the old audit row survived');
select is((select count(*)::int from public.audit_event e where e.tenant_id = (select d from ctx) and e.action = 'tenant.demo_data_removed' and e.created_by = (select founder from ctx)), 1, 'and the reset wrote one tenant.demo_data_removed row, by the owner who pressed the button');
select is((select count(*)::int from public.app_user where tenant_id = (select d from ctx) and auth_id in ('d0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-0000000000d2', pg_temp.id('D', 'au1'), pg_temp.id('D', 'au2'))), 0, 'the demo owner, admin and the two demo staff are gone');
select is((select md5(x::text) from public.app_user x where x.id = pg_temp.id('LATER', 'usr')) = (select usr from later_before), true, 'the real user added after the marker survives, byte for byte');
select is((select md5(x::text) from public.staff_session x where x.id = pg_temp.id('LATER', 'ses')) = (select ses from later_before), true, 'and so does its login session');
select is((select l.auth_ids @> array['f0000000-0000-4000-8000-0000000000f3'::uuid] from app.demo_purge_log l), false, 'its Auth id is not in the ids to delete');
select is((select count(*)::int from public.device_enrolment where id = pg_temp.id('OLDCODE', 'enr')) + (select count(*)::int from public.venue_device where id = pg_temp.id('OLDCODE', 'dev')), 0, 'a code from before the marker that was redeemed for a demo device goes with that device (no foreign key failure)');
select is((select l.file_paths from app.demo_purge_log l), (select paths from later_before), 'the log keeps the exact file paths of the invoices it deleted, and nothing else');
select is((select cardinality(l.file_paths) from app.demo_purge_log l), 3, 'three of them');
select is((select count(*)::int from app.demo_purge_log), 1, 'one log row');
select is((select l.via || ',' || (l.tenant_id = (select d from ctx)) || ',' || l.tenant_name || ',' || (l.cleaned_at is null) from app.demo_purge_log l),
          'app,true,Locale Target (demo),true', 'via app, for D, with the name, not cleaned yet');
select is((select l.row_counts from app.demo_purge_log l), (select counts from before_d), 'the log keeps the counts');
select is((select l.actor_auth from app.demo_purge_log l), 'f0000000-0000-4000-8000-0000000000f1'::uuid, 'and the actor');
select is((select cardinality(l.auth_ids) from app.demo_purge_log l), 4, 'four auth ids to delete: demo owner, demo admin and the two demo staff (never the founder or the real staff)');
select ok((select l.auth_ids @> array['d0000000-0000-4000-8000-0000000000d1'::uuid, 'd0000000-0000-4000-8000-0000000000d2'::uuid, pg_temp.id('D', 'au1'), pg_temp.id('D', 'au2')]
                 and not l.auth_ids && array['f0000000-0000-4000-8000-0000000000f1'::uuid, 'f0000000-0000-4000-8000-0000000000f2'::uuid] from app.demo_purge_log l), 'they are exactly those');
select is((select pg_temp.snap(r1) = (select snap from snaps where label = 'r1') and pg_temp.snap(r2) = (select snap from snaps where label = 'r2') from ctx), true, 'R1 and R2 are byte for byte unchanged');
select is(coalesce(current_setting('app.demo_purge', true), '') || coalesce(current_setting('app.demo_marker_write', true), ''), '', 'both settings are empty after the reset');

-- DigiAlto's clean-up: only the paths of the log row, and only the refusals up to the reset --------------------------------------------------
-- A refusal written AFTER the reset (the tenant is live again) is not the demo's: it must survive demo_purge_cleanup_done.
insert into app.alert_refusal (tenant_id, kind, caller, code, sqlstate, at) select d, 'test_alert', 'alert_rules', 'later_refusal', 'P0001', clock_timestamp() + interval '1 second' from ctx;
-- One written by a concurrent run just before the reset commit is the demo's own and goes.
insert into app.alert_refusal (tenant_id, kind, caller, code, sqlstate, at) select d, 'test_alert', 'alert_rules', 'early_refusal', 'P0001', (select purged_at - interval '1 second' from app.demo_purge_log) from ctx;
create temp table log_row as select id from app.demo_purge_log;
grant select on log_row to public;
set local role service_role;
select is((select array_agg(p.file_paths) from public.demo_purge_pending() p), array[(select paths from later_before)], 'demo_purge_pending hands the script the exact paths of the row');
select is(pg_temp.err(format('select public.demo_purge_cleanup_done(%L, 4, 3)', (select id from log_row))), 'ok', 'cleanup_done accepts the row');
reset role;
select is((select array_agg(code order by code) from app.alert_refusal where tenant_id = (select d from ctx)), array['later_refusal'], 'only the refusal written after the reset survives');
select is((select l.file_paths from app.demo_purge_log l), '{}'::text[], 'the paths are emptied once the files are gone');
select is((select l.auth_ids from app.demo_purge_log l), '{}'::uuid[], 'and so are the Auth ids');
select is((select count(*)::int from public.demo_purge_pending()), 0, 'nothing is pending any more');
delete from app.alert_refusal where tenant_id = (select d from ctx);

-- Unmarked now: D cannot be reset again; others stay append-only -----------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('f0000000-0000-4000-8000-0000000000f1', (select d from ctx), 'owner');
select is(pg_temp.err($$ select public.purge_demo_data('Locale Target (demo)') $$), '42501:not_demo_tenant', 'D without a marker can not be reset any more');
reset role;
-- Once the reset has cleared the marker, D can never be purged again: not through the function (the assertion above, and
-- 'D without a marker'), and not by setting the purge setting by hand either, whatever role does it.
create temp table d_after as select pg_temp.snap(d) as snap from ctx;
grant select on d_after to public;
select set_config('app.demo_purge', (select d::text from ctx), true);
select is(pg_temp.err($$ delete from public.audit_event where tenant_id = (select d from ctx) $$), 'P0001:append_only', 'setting app.demo_purge to D by hand: D''s audit rows still can not be deleted');
select is(pg_temp.err($$ delete from public.venue_device where tenant_id = (select d from ctx) $$), 'P0001:venue_device_immutable', 'nor its device');
select is(pg_temp.err($$ delete from public.staff_session where tenant_id = (select d from ctx) $$), 'P0001:staff_session_immutable', 'nor its sessions');
select is(pg_temp.err($$ delete from public.device_enrolment where tenant_id = (select d from ctx) $$), 'P0001:device_enrolment_immutable', 'nor its codes');
select is((select app.demo_purge_allows(d) from ctx), false, 'demo_purge_allows(D) is false although the setting names D');
select set_config('app.demo_purge', '', true);
select is((select pg_temp.snap(d) = (select snap from d_after) from ctx), true, 'D is byte for byte what it was after the reset');

select is(pg_temp.err($$ delete from public.stock_movement where tenant_id = (select r1 from ctx) $$), 'P0001:append_only', 'R1''s ledger rows still cannot be deleted');
select is(pg_temp.err($$ delete from public.stock_movement where tenant_id = (select d from ctx) $$), 'ok', 'a delete that finds no row is not an error');
select is(pg_temp.err($$ update public.audit_event set reason = 'x' where tenant_id = (select r1 from ctx) $$), 'P0001:append_only', 'nor updated');
select is(pg_temp.err($$ update public.audit_event set reason = 'x' where tenant_id = (select d from ctx) $$), 'P0001:append_only', 'D''s remaining audit rows can not be updated either');
select is(pg_temp.err($$ delete from public.audit_event where tenant_id = (select d from ctx) $$), 'P0001:append_only', 'nor deleted by hand: D is not marked');
select is(pg_temp.err($$ truncate public.audit_event $$), 'P0001:append_only', 'nor truncated');
select is(pg_temp.err($$ delete from public.venue_device where tenant_id = (select r2 from ctx) $$), 'P0001:venue_device_immutable', 'R2''s devices neither');

-- The script path: D again, marked again (it is empty), reset by id -----------------------------------------------------------------------------
select public.begin_demo_data((select d from ctx), 'd0000000-0000-4000-8000-0000000000d3', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d4', 'Supporto DigiAlto (demo)');
select is((select demo_data_since is not null from public.tenant where id = (select d from ctx)), true, 'D can be marked again once it holds no operational data');
select pg_temp.mkall((select d from ctx), 'E', (select u.id from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d3'));
set local role service_role;
select is(pg_temp.err(format('insert into res select %L, public.purge_demo_data_by_id(%L, %L)', 'script', (select d from ctx), 'Locale Target (demo)')), 'ok', 'the script path resets it by id');
reset role;
select is((select j ->> 'tenantId' from res where label = 'script'), (select d::text from ctx), 'the result names the tenant');
select is((select string_agg(key || '=' || value, ',' order by key) from jsonb_each_text(app.demo_tenant_counts((select d from ctx))) where value::int <> 0),
          'app_user=3,audit_event=1,device_enrolment=1,staff_session=2,tenant=1,venue_device=1', 'D is back to the tenant row, the founder, the real staff, the old device and the old audit row (the script writes no audit row; the first reset''s row has this transaction''s time, which is inside the second marker''s window, so it went too)');
select is((select l.via || ',' || coalesce(l.actor_auth::text, 'none') from app.demo_purge_log l where l.id = (select max(id) from app.demo_purge_log)), 'script,none', 'logged via script, no actor');
select is((select pg_temp.snap(r1) = (select snap from snaps where label = 'r1') and pg_temp.snap(r2) = (select snap from snaps where label = 'r2') from ctx), true, 'R1 and R2 are still byte for byte unchanged');

-- One transaction: a failure part-way leaves everything as it was ------------------------------------------------------------------------
select public.begin_demo_data((select d from ctx), 'd0000000-0000-4000-8000-0000000000d5', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d6', 'Supporto DigiAlto (demo)');
select pg_temp.mkall((select d from ctx), 'F', (select u.id from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d5'));
insert into snaps select 'f', pg_temp.snap(d) from ctx;
-- A table the list does not know, with a row that points at a demo user: the last statement of the reset must fail on its foreign key.
create table public.zz_rogue (id int primary key, tenant_id uuid not null, user_id uuid not null references public.app_user (id));
insert into public.zz_rogue select 1, d, (select u.id from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d5') from ctx;
select is(left(pg_temp.err(format('select public.purge_demo_data_by_id(%L, %L)', (select d from ctx), 'Locale Target (demo)')), 6), '23503:', 'a table outside the list that still references a demo user makes the reset fail (23503)');
select is((select pg_temp.snap(d) = (select snap from snaps where label = 'f') from ctx), true, 'and nothing at all was deleted');
select is((select demo_data_since is not null from public.tenant where id = (select d from ctx)), true, 'the marker is still set');
select is((select count(*)::int from app.demo_purge_log), 2, 'no log row for the failed attempt');
select is(coalesce(current_setting('app.demo_purge', true), '') || coalesce(current_setting('app.demo_marker_write', true), ''), '', 'and both settings are empty');

select * from finish();
rollback;
