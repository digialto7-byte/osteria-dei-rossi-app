-- M16 step 9: the hourly body with the three M16 rules next to M9's two (plan §3.1.9-11; AT4, AT6), the wrapper
-- public.alert_rules_run, the re-pinned body, per-tenant per-rule isolation, and a timing guard. Fake data only.
--   tenant A: the combined fixture at D = 2026-11-02 (AT4); tenant B: D = 2026-11-01 (a normal Sunday);
--   tenant C: D = 2026-10-25 (the 25-hour day, AT6); tenant P: the synthetic performance fixture.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'), ('c0000000-0000-4000-8000-00000000000c', 'owner-c@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'owner-p@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220'),
  ('44444444-4444-4444-8444-444444444444', 'Osteria Demo P', 'IT33333333335');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-00000000000c', 'owner', 'Titolare C Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '44444444-4444-4444-8444-444444444444', 'd0000000-0000-4000-8000-00000000000d', 'owner', 'Titolare P Demo');

create temporary table reg (k text primary key, id uuid not null);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create sequence pg_temp.seq;
create function pg_temp.owner_of(p_tenant uuid) returns uuid language sql as $$ select id from public.app_user where tenant_id = p_tenant $$;

-- The fixture of one tenant, placed relative to D (a Sunday): the AT1 stew (4 of 5 portions, beef 12,3 kg), a broth batch with
-- use-by D 20:00 Rome (6 portions), an onion lot expiring D+1, and two purchase ingredients on 2 kg: Vitello (Macelleria:
-- Mon/Thu, 11:00, lead 2) and Latte (Latteria: Tue, 11:00, lead 2, whose order date falls on D).
create function pg_temp.world(p_tenant uuid, p text, d date) returns void language plpgsql as $$
declare
  v_by uuid := pg_temp.owner_of(p_tenant);
  v_loc uuid := gen_random_uuid();
  v_inv uuid := gen_random_uuid();
  v_mac uuid := gen_random_uuid();
  v_lat uuid := gen_random_uuid();
  v_use_by timestamptz := ((d::timestamp + time '20:00') at time zone 'Europe/Rome');
  v_line uuid;
  r record;
begin
  insert into public.location (id, tenant_id, name) values (v_loc, p_tenant, 'Cella (demo)');
  insert into public.supplier (id, tenant_id, name, vat_number, lead_time_days, delivery_weekdays, order_cutoff_time) values
    (v_mac, p_tenant, 'Macelleria X (demo)', 'IT12345678903', 2, '{1,4}', '11:00'),
    (v_lat, p_tenant, 'Latteria W (demo)', 'IT44444444440', 2, '{2}', '11:00');
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
    values (v_inv, p_tenant, p_tenant || '/2026/' || v_inv || '.pdf', 'application/pdf', 2048, 'review', v_mac);
  insert into reg values (p || 'loc', v_loc), (p || 'inv', v_inv), (p || 'mac', v_mac), (p || 'lat', v_lat);
  -- ingredients, lots (the receipts)
  for r in select * from (values ('beef', 'Manzo muscolo (demo)', 12.3, null::date), ('onion', 'Cipolla (demo)', 1, null), ('onionx', 'Cipolla (demo)', 1, d + 1),
                                 ('carrot', 'Carota (demo)', 2, null), ('vitello', 'Vitello (demo)', 2, null), ('latte', 'Latte (demo)', 2, null)) v (k, name, qty, expiry) loop
    if r.k <> 'onionx' then
      insert into reg values (p || r.k, gen_random_uuid());
      insert into public.ingredient (id, tenant_id, name, base_unit, is_stock, min_level, target_level)
        values (pg_temp.id(p || r.k), p_tenant, r.name, 'kg', true,
                case when r.k in ('vitello', 'latte') then 5 end, case when r.k in ('vitello', 'latte') then 12 end);
    end if;
    v_line := gen_random_uuid();
    insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
      values (v_line, p_tenant, v_inv, nextval('pg_temp.seq'), 'Riga demo', 1, 10, 10, '{}', '{}');
    insert into reg values (p || 'lot_' || r.k, gen_random_uuid());
    insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received, base_unit,
        source_qty, source_unit, base_factor, created_by)
      values (pg_temp.id(p || 'lot_' || r.k), p_tenant, pg_temp.id(p || replace(r.k, 'onionx', 'onion')), v_loc, v_mac, v_line, upper(r.k), r.expiry,
        '2026-10-01', r.qty, 'kg', r.qty, 'kg', 1, v_by);
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
      values (p_tenant, pg_temp.id(p || replace(r.k, 'onionx', 'onion')), pg_temp.id(p || 'lot_' || r.k), v_loc, 'receipt', r.qty, 10, 'invoice_line', v_line, '2026-10-01', v_by);
  end loop;
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values (gen_random_uuid(), p_tenant, 'Acqua (demo)', 'l', false);
  insert into public.supplier_item (tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, is_preferred, is_active)
    values (p_tenant, v_mac, pg_temp.id(p || 'vitello'), 'VI5', 1, 5, 'kg', true, true), (p_tenant, v_lat, pg_temp.id(p || 'latte'), 'LA5', 1, 5, 'kg', true, true);
  -- recipes: soffritto (sub), stew (batch, rule 5/30/180), broth (batch, no rule)
  insert into reg values (p || 'k_sof', gen_random_uuid()), (p || 'r_sof', gen_random_uuid()), (p || 'k_stew', gen_random_uuid()), (p || 'r_stew', gen_random_uuid()),
                         (p || 'k_brodo', gen_random_uuid()), (p || 'r_brodo', gen_random_uuid());
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by, rule_min_portions, rule_target_portions, rule_prep_time_min) values
    (pg_temp.id(p || 'k_sof'), p_tenant, 'sub', 1, 'soffritto (demo)', v_by, null, null, null),
    (pg_temp.id(p || 'k_stew'), p_tenant, 'batch', 1, 'spezzatino (demo)', v_by, 5, 30, 180),
    (pg_temp.id(p || 'k_brodo'), p_tenant, 'batch', 1, 'brodo (demo)', v_by, null, null, null);
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
    (pg_temp.id(p || 'r_sof'), p_tenant, pg_temp.id(p || 'k_sof'), 1, '2026-10-01T00:00Z', 'Soffritto (demo)', 1, 'kg', null, null, v_by),
    (pg_temp.id(p || 'r_stew'), p_tenant, pg_temp.id(p || 'k_stew'), 1, '2026-10-01T00:00Z', 'Spezzatino (demo)', 6, 'kg', 30, 72, v_by),
    (pg_temp.id(p || 'r_brodo'), p_tenant, pg_temp.id(p || 'k_brodo'), 1, '2026-10-01T00:00Z', 'Brodo (demo)', 5, 'l', 20, 48, v_by);
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, created_by) values
    (p_tenant, pg_temp.id(p || 'r_sof'), 1, pg_temp.id(p || 'onion'), null, 0.6, 'kg', v_by),
    (p_tenant, pg_temp.id(p || 'r_sof'), 2, pg_temp.id(p || 'carrot'), null, 0.4, 'kg', v_by),
    (p_tenant, pg_temp.id(p || 'r_stew'), 1, pg_temp.id(p || 'beef'), null, 5, 'kg', v_by),
    (p_tenant, pg_temp.id(p || 'r_stew'), 2, null, pg_temp.id(p || 'k_sof'), 0.5, 'kg', v_by),
    (p_tenant, pg_temp.id(p || 'r_brodo'), 1, pg_temp.id(p || 'onion'), null, 0.2, 'kg', v_by);
  -- batches: the stew with 4 portions (use-by far), the broth with 6 portions (use-by D 20:00 Rome)
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
      output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, location_id, created_by)
    select gen_random_uuid(), p_tenant, pg_temp.id(p || 'k_' || x.k), pg_temp.id(p || 'r_' || x.k), 1, '261023-' || x.code || '-1', '2026-10-23', x.code, 1,
           x.use_by - make_interval(hours => x.shelf), v_by, 6, 'kg', x.portions, x.portions, x.shelf, x.use_by, v_loc, v_by
      from (values ('stew', 'SPEZZA', 4, 72, d::timestamptz + interval '60 days'), ('brodo', 'BRODO', 6, 48, v_use_by)) x (k, code, portions, shelf, use_by);
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    select tenant_id, id, 'produce', portions_initial, 'batch', id, '2026-10-23', created_by from public.batch where tenant_id = p_tenant;
end
$$;
-- A payable due 7 days after D (M9's reminder rule fires on D).
create function pg_temp.payable(p_tenant uuid, p text, d date) returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, number_raw, invoice_date)
    values (v_inv, p_tenant, p_tenant || '/2026/' || v_inv || '.pdf', 'application/pdf', 2048, 'FT 1', '2026-10-01');
  insert into public.payable (tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date, due_date_source, status, created_by)
    values (p_tenant, v_inv, pg_temp.id(p || 'mac'), 100, 0, 100, d + 7, 'invoice', 'open', pg_temp.owner_of(p_tenant));
end
$$;
create function pg_temp.items() returns integer language sql as $$ select items from public.job_run_latest('alert-rules') $$;
create function pg_temp.set_of(p_tenant uuid, p_date date) returns text language sql as $$
  select coalesce(string_agg(a.kind, ',' order by a.kind, a.entity_id), '-') from public.alert a where a.tenant_id = p_tenant and a.business_date = p_date $$;

select pg_temp.world('11111111-1111-4111-8111-111111111111', 'a_', '2026-11-02');
select pg_temp.payable('11111111-1111-4111-8111-111111111111', 'a_', '2026-11-02');

-- AT4: three hourly runs on one day --------------------------------------------------------------------------------------------
select app.run_alert_rules('2026-11-02T07:00:00Z');
select is(pg_temp.items(), 7, 'run 1 raises seven alerts: prep_due, two purchase_due, batch_expiring, raw_lot_expiring and M9''s payable_due_7d and Monday digest');
select is(pg_temp.set_of('11111111-1111-4111-8111-111111111111', '2026-11-02'),
  'batch_expiring,payable_due_7d,payables_weekly_digest,prep_due,purchase_due,purchase_due,raw_lot_expiring', 'one alert per (kind, item) for 2026-11-02');
select app.run_alert_rules('2026-11-02T08:00:00Z');
select is(pg_temp.items(), 0, 'run 2 an hour later: job_run.items is 0 (only new rows are counted)');
select app.run_alert_rules('2026-11-02T09:00:00Z');
select is(pg_temp.items(), 0, 'run 3: 0');
select is((select count(*)::int from public.alert where tenant_id = '11111111-1111-4111-8111-111111111111'), 7, 'AT4: still seven alerts after three runs');
select is((select ok::text from public.job_run_latest('alert-rules')), 'true', 'and the runs are recorded ok');
select app.run_alert_rules('2026-11-02T23:30:00Z');
select is(pg_temp.items(), 5, 'a run at 00:30 Rome on 3 Nov raises a new set: the payable stage and the Monday digest were already raised, the five others are dated 3 Nov');
select is(pg_temp.set_of('11111111-1111-4111-8111-111111111111', '2026-11-03'), 'batch_expiring,prep_due,purchase_due,purchase_due,raw_lot_expiring', 'dated 2026-11-03');
select is((select severity::text from public.alert where kind = 'batch_expiring' and business_date = '2026-11-03'), 'critical', 'the broth batch is past its use-by by then: critical');
select is((select count(*)::int from public.alert where tenant_id = '11111111-1111-4111-8111-111111111111' and business_date = '2026-11-02'), 7, 'and the 2 Nov set is untouched');

-- The payloads of the combined run, as they will be read by the API ------------------------------------------------------------
select is((select a.payload from public.alert a where a.kind = 'purchase_due' and a.entity_id = pg_temp.id('a_vitello') and a.business_date = '2026-11-02')
              - 'ingredient_id' - 'supplier_id' - 'supplier_item_id',
  '{"order_qty":10,"packs_count":2,"pack_qty":5,"unit":"kg","order_by_at":"2026-11-03T10:00:00Z","delivery_date":"2026-11-05","horizon_days":3,"on_hand_qty":2,"forecast_qty":0,"projected_qty":2,"min_qty":5,"target_qty":12}'::jsonb,
  'purchase_due: 10 kg by Tue 11:00 Rome for Thu delivery');
select is((select a.payload from public.alert a where a.kind = 'purchase_due' and a.entity_id = pg_temp.id('a_latte') and a.business_date = '2026-11-02') - 'ingredient_id' - 'supplier_id' - 'supplier_item_id',
  '{"order_qty":10,"packs_count":2,"pack_qty":5,"unit":"kg","order_by_at":"2026-11-08T10:00:00Z","delivery_date":"2026-11-10","horizon_days":8,"on_hand_qty":2,"forecast_qty":0,"projected_qty":2,"min_qty":5,"target_qty":12}'::jsonb,
  'Latte (Tuesdays, lead 2): Tue 3 Nov needs ordering by Sun 1 Nov 11:00 (passed), so the window is Tue 10 Nov, order by Sun 8 Nov 11:00 (10:00Z), horizon 8');

-- AT6: the 25-hour day (tenant C) against a normal Sunday (tenant B) -------------------------------------------------------------
select pg_temp.world('33333333-3333-4333-8333-333333333333', 'c_', '2026-10-25');
select pg_temp.world('22222222-2222-4222-8222-222222222222', 'b_', '2026-11-01');
select app.run_alert_rules('2026-10-25T00:30:00Z');
select app.run_alert_rules('2026-10-25T01:30:00Z');
select app.run_alert_rules('2026-10-25T22:30:00Z');
select app.run_alert_rules('2026-11-01T00:30:00Z');
select app.run_alert_rules('2026-11-01T22:30:00Z');
select is(pg_temp.set_of('33333333-3333-4333-8333-333333333333', '2026-10-25'), 'batch_expiring,prep_due,purchase_due,purchase_due,raw_lot_expiring',
  'AT6: runs at 02:30 CEST, 02:30 CET and 23:30 CET on 25 Oct give one alert per item, all dated 2026-10-25');
select is((select count(*)::int from public.alert where tenant_id = '33333333-3333-4333-8333-333333333333' and business_date <> '2026-10-25' and business_date <> '2026-11-01'), 0,
  'and no other date appears for tenant C');
select is(pg_temp.set_of('22222222-2222-4222-8222-222222222222', '2026-11-01'), 'batch_expiring,prep_due,purchase_due,purchase_due,raw_lot_expiring',
  'a normal Sunday (1 Nov) gives the same set');
create function pg_temp.norm(p_tenant uuid, p_date date, p_shift int) returns text language sql as $$
  select string_agg(x.s, E'\n' order by x.s) from (
    select a.kind || ' ' || coalesce((select string_agg(e.key || '=' ||
             case when jsonb_typeof(e.value) = 'string' and e.value #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then ((e.value #>> '{}')::date + p_shift)::text
                  when jsonb_typeof(e.value) = 'string' and e.value #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
                       to_char(((e.value #>> '{}')::timestamptz at time zone 'UTC') + make_interval(days => p_shift), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                  else (e.value #>> '{}') end, ',' order by e.key)
             from jsonb_each(a.payload) e where e.key !~ '(_id|_key)$'), '') as s
      from public.alert a where a.tenant_id = p_tenant and a.business_date = p_date) x $$;
select is(pg_temp.norm('22222222-2222-4222-8222-222222222222', '2026-11-01', -7), pg_temp.norm('33333333-3333-4333-8333-333333333333', '2026-10-25', 0),
  'AT6: the same (kind, payload minus ids) multiset, with every date and instant of the normal Sunday shifted -7 days');
select is((select a.payload ->> 'order_by_at' from public.alert a where a.tenant_id = '33333333-3333-4333-8333-333333333333' and a.kind = 'purchase_due'
              and a.entity_id = pg_temp.id('c_latte') and a.business_date = '2026-10-25'), '2026-10-25T10:00:00Z', 'the order-by of the DST day is 11:00 CET (10:00Z), not 09:00Z');
select is((select a.payload ->> 'order_by_at' from public.alert a where a.tenant_id = '22222222-2222-4222-8222-222222222222' and a.kind = 'purchase_due'
              and a.entity_id = pg_temp.id('b_latte') and a.business_date = '2026-11-01'), '2026-11-01T10:00:00Z', 'and on the normal Sunday, 11:00 CET too');
select is((select to_char(((a.payload ->> 'order_by_at')::timestamptz at time zone 'Europe/Rome'), 'HH24:MI') from public.alert a where a.tenant_id = '33333333-3333-4333-8333-333333333333'
            and a.kind = 'purchase_due' and a.entity_id = pg_temp.id('c_latte') and a.business_date = '2026-10-25'), '11:00', 'the local time of the deadline is 11:00 in both');
select is((select a.payload ->> 'use_by_at' from public.alert a where a.tenant_id = '33333333-3333-4333-8333-333333333333' and a.kind = 'batch_expiring' and a.business_date = '2026-10-25'), '2026-10-25T19:00:00Z',
  'the broth use-by 20:00 Rome on the DST day is 19:00Z');
select is((select a.payload ->> 'state_key' from public.alert a where a.tenant_id = '33333333-3333-4333-8333-333333333333' and a.kind = 'batch_expiring' and a.business_date = '2026-10-25'), 'due_soon',
  'state due_soon on both days (18,5 h away at the first run)');

-- The body is M9's two blocks and then the three of M16 ---------------------------------------------------------------------------------
create temp table body as select pg_get_functiondef('app.alert_rules_body(timestamptz)'::regprocedure) as src;
select ok((select position('app.payable_reminder_rule(' in src) > 0 and position('app.payables_digest_rule(' in src) > position('app.payable_reminder_rule(' in src)
              and position('app.prep_rule(' in src) > position('app.payables_digest_rule(' in src)
              and position('app.purchase_rule(' in src) > position('app.prep_rule(' in src)
              and position('app.expiry_rule(' in src) > position('app.purchase_rule(' in src) from body),
  'the body calls the payable reminder, the digest, then the prep, purchase and expiry rules, in that order');
select is((select count(*)::int from regexp_matches((select src from body), 'record_alert_refusal', 'g')), 5, 'each of the five blocks records its own failure');
select ok((select src ~ '''prep_rules'', ''rule_failed''' and src ~ '''purchase_rules'', ''rule_failed''' and src ~ '''expiry_rules'', ''rule_failed''' from body), 'under the callers prep_rules, purchase_rules and expiry_rules');
select is((select md5(prosrc) from pg_proc where oid = 'app.run_alert_rules(timestamptz)'::regprocedure), 'ff878123053f643e184b4a6dd537bb27', 'app.run_alert_rules is unchanged (075 pins it)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('alert_rules_body', 'run_alert_rules')), 2, 'one definition each of the body and the runner');
select is((select schedule || ' | ' || command from cron.job where jobname = 'alert-rules'), '0 * * * * | select app.run_alert_rules()', 'the cron job is unchanged');

-- The wrapper public.alert_rules_run ----------------------------------------------------------------------------------------------------
select is((select has_function_privilege('service_role', 'public.alert_rules_run(timestamptz)', 'execute')), true, 'service_role can execute alert_rules_run');
select is((select has_function_privilege('authenticated', 'public.alert_rules_run(timestamptz)', 'execute') or has_function_privilege('anon', 'public.alert_rules_run(timestamptz)', 'execute')), false,
  'authenticated and anon cannot');
set local role service_role;
create temp table wrapped as select public.alert_rules_run('2026-11-09T07:00:00Z') as r;
reset role;
select is((select r ->> 'ok' from wrapped), 'true', 'as service_role: {ok: true, ...}');
select is((select (r ->> 'items')::int from wrapped), pg_temp.items(), 'and items is the count of the run it just did');
select is((select (r ->> 'items')::int from wrapped) > 0, true, 'a new Monday raised new alerts');
select is((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.alert_rules_run(timestamptz)'::regprocedure), true,
  'it is security definer with an empty search_path');

-- Isolation: a failing rule of one tenant rolls back only that block -------------------------------------------------------------------
delete from app.alert_refusal;
alter function app.purchase_rule(uuid, timestamptz) rename to purchase_rule_real;
create function app.purchase_rule(p_tenant uuid, p_at timestamptz) returns integer language plpgsql as $$
begin
  raise exception 'purchase exploded SEGRETO';
end
$$;
select pg_temp.payable('11111111-1111-4111-8111-111111111111', 'a_', '2026-12-01');
select app.run_alert_rules('2026-12-01T09:00:00Z');
select is((select ok::text from public.job_run_latest('alert-rules')), 'true', 'a failing rule does not fail the run');
select is((select string_agg(distinct caller || ' ' || code || ' ' || sqlstate, ',') from app.alert_refusal), 'purchase_rules rule_failed P0001',
  'one kind of refusal: purchase_rules / rule_failed / P0001');
select is((select count(*)::int from app.alert_refusal), 4, 'one per tenant (A, B, C, P)');
select ok(not exists (select 1 from app.alert_refusal where code ilike '%explod%' or kind ilike '%explod%' or caller ilike '%segreto%'), 'the error text is not stored');
select is((select count(*)::int from public.alert a where a.tenant_id = '11111111-1111-4111-8111-111111111111' and a.business_date = '2026-12-01'
            and a.kind in ('prep_due', 'batch_expiring', 'raw_lot_expiring')), 3, 'the prep and expiry alerts of the same run committed (expiry: the broth batch is long past its use-by)');
select is((select count(*)::int from public.alert a where a.tenant_id = '11111111-1111-4111-8111-111111111111' and a.business_date = '2026-12-01' and a.kind = 'purchase_due'), 0,
  'and no purchase alert was raised');
select is((select count(*)::int from public.alert a where a.tenant_id = '11111111-1111-4111-8111-111111111111' and a.kind = 'payable_due_7d' and a.business_date = '2026-12-01'), 1,
  'M9''s payable reminder of the same run is still raised');
drop function app.purchase_rule(uuid, timestamptz);
alter function app.purchase_rule_real(uuid, timestamptz) rename to purchase_rule;

-- Performance guard: 200 ingredients with min levels and a supplier, 15 days x 5 consumption rows each, 40 batch recipes below
-- their minimum (a regression bound for CI, not a production promise).
insert into public.location (id, tenant_id, name) values ('40000000-0000-4000-8000-0000000000a1', '44444444-4444-4444-8444-444444444444', 'Cella P (demo)');
insert into public.supplier (id, tenant_id, name, vat_number, lead_time_days, delivery_weekdays, order_cutoff_time)
  values ('45000000-0000-4000-8000-00000000005a', '44444444-4444-4444-8444-444444444444', 'Macelleria P (demo)', 'IT12345678903', 2, '{1,4}', '11:00');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('4e000000-0000-4000-8000-0000000000e1', '44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444/2026/4e000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review',
          '45000000-0000-4000-8000-00000000005a');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock, min_level, target_level)
  select ('41000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '44444444-4444-4444-8444-444444444444', 'Ingrediente ' || n || ' (demo)', 'kg', true, 5, 12
    from generate_series(1, 200) n;
insert into public.supplier_item (tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, is_preferred, is_active)
  select '44444444-4444-4444-8444-444444444444', '45000000-0000-4000-8000-00000000005a', ('41000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'P' || n, 1, 5, 'kg', true, true
    from generate_series(1, 200) n;
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
  select ('4a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '44444444-4444-4444-8444-444444444444', '4e000000-0000-4000-8000-0000000000e1', n, 'Riga demo', 1, 10, 10, '{}', '{}'
    from generate_series(1, 200) n;
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  select ('42000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '44444444-4444-4444-8444-444444444444', ('41000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         '40000000-0000-4000-8000-0000000000a1', '45000000-0000-4000-8000-00000000005a', ('4a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'LP' || n,
         null, '2026-10-01', 500, 'kg', 500, 'kg', 1, 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 200) n;
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  select '44444444-4444-4444-8444-444444444444', ('41000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, ('42000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         '40000000-0000-4000-8000-0000000000a1', 'receipt', 500, 10, 'invoice_line', ('4a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '2026-10-01', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 200) n;
insert into public.stock_movement (tenant_id, ingredient_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
  select '44444444-4444-4444-8444-444444444444', ('41000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '40000000-0000-4000-8000-0000000000a1', 'consumption',
         -0.5 * r, 'manual', gen_random_uuid(), (date '2026-12-01' - dd), 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 200) n, generate_series(1, 15) dd, generate_series(1, 5) r;
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by, rule_min_portions, rule_target_portions)
  select ('43000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '44444444-4444-4444-8444-444444444444', 'batch', 1, 'ricetta ' || n || ' (demo)', 'd1000000-0000-4000-8000-00000000000d', 5, 30
    from generate_series(1, 40) n;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by)
  select ('44000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '44444444-4444-4444-8444-444444444444', ('43000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 1,
         '2026-10-01T00:00Z', 'Ricetta ' || n || ' (demo)', 6, 'kg', 30, 72, 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 40) n;
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by)
  select '44444444-4444-4444-8444-444444444444', ('44000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, p, ('41000000-0000-4000-8000-' || lpad(((n * 5 + p) % 200 + 1)::text, 12, '0'))::uuid, 1, 'kg',
         'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 40) n, generate_series(1, 4) p;
analyze public.stock_movement;
create temp table timing (t0 timestamptz, t1 timestamptz);
insert into timing select clock_timestamp(), null;
select app.run_alert_rules('2026-12-01T10:00:00Z');
update timing set t1 = clock_timestamp();
select ok((select t1 - t0 from timing) < interval '2 seconds', 'performance guard: one run over 200 ingredients (15 days x 5 consumption rows each) and 40 recipes below their minimum finishes in under 2 seconds');
select is((select count(*)::int from public.alert a where a.tenant_id = '44444444-4444-4444-8444-444444444444' and a.kind = 'prep_due'), 40, 'the 40 recipes below their minimum each raised a prep_due');
select is((select count(*)::int from public.alert a where a.tenant_id = '44444444-4444-4444-8444-444444444444' and a.kind = 'purchase_due'), 0, 'and with 500 kg on hand no purchase alert');

select * from finish();
rollback;
