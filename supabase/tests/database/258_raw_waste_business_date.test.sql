-- Founder decision A5, extended by the lead to RAW waste (docs/plans/2026-11-02-a5-business-date-discards.md): a raw waste counts on the BUSINESS day (cut-off 02:00 by default), so
-- public.waste_costs never mixes calendar-dated raw rows with business-dated batch rows. Option (b) as for the batch side: public.raw_waste_costs derives the business day from
-- stock_movement.created_at over [app.business_day_start(from), app.kpi_cutoff_end(to)), on waste rows only, with no UPDATE and no backfill. Every fixture row carries the CALENDAR
-- effective_on that app.post_stock_outflow writes (the day AFTER the business day between 00:00 and the cut-off). Cases: Sunday night into Monday (winter), both DST nights, a tenant
-- with a 04:00 cut-off, unvaluedCount (with reversals inside and outside the range), the dashboard tile at Monday 01:45, the KPI report, a real post_waste, and an approve_invoice receipt
-- that keeps its invoice date. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
-- Tenant B closes at 04:00.
insert into public.tenant (id, name, vat_number, settings) values
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"business_day_cutoff": "04:00"}'::jsonb);
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo (demo)', 'kg', true),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Sedano (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-00000000001e', '22222222-2222-4222-8222-222222222222', 'Pollo B (demo)', 'kg', true);

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
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- A raw waste of p_qty kg of tenant A's Manzo (default; p_ing overrides) or tenant B's Pollo at p_at, dated the way app.post_stock_outflow dates it: effective_on is the CALENDAR date of
-- p_at in Rome (p_eff overrides it), created_at is p_at. The unit cost is 1.00 per kg, so the EUR value of a day equals its kilos; p_cost null makes it an unvalued waste.
create function pg_temp.rw(p_tenant text, p_qty numeric, p_at timestamptz, p_eff date default null, p_cost numeric default 1.00, p_ing uuid default null, p_ref uuid default null)
  returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.stock_movement (id, tenant_id, ingredient_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
  select v_id, t.id,
         coalesce(p_ing, case when t.id = '11111111-1111-4111-8111-111111111111' then '1a000000-0000-4000-8000-00000000001a'::uuid else '1e000000-0000-4000-8000-00000000001e'::uuid end),
         case when t.id = '11111111-1111-4111-8111-111111111111' then '10000000-0000-4000-8000-0000000000a1'::uuid else '10000000-0000-4000-8000-0000000000b1'::uuid end,
         'waste', -p_qty, p_cost, 'spoilage', 'manual', coalesce(p_ref, gen_random_uuid()), coalesce(p_eff, (p_at at time zone 'Europe/Rome')::date), p_at,
         case when t.id = '11111111-1111-4111-8111-111111111111' then 'a1000000-0000-4000-8000-00000000000a'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end
    from public.tenant t where t.id = p_tenant::uuid;
  return v_id;
end
$$;
-- The reversal of a raw waste, posted at p_at (a reversal mirrors its original and is dated when it is posted).
create function pg_temp.rev(p_id uuid, p_at timestamptz) returns void language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, reverses_id, effective_on, created_at, created_by)
  select o.tenant_id, o.ingredient_id, o.location_id, o.type, -o.qty, o.unit_cost, o.reason_code, 'reversal', gen_random_uuid(), o.id, (p_at at time zone 'Europe/Rome')::date, p_at, o.created_by
    from public.stock_movement o where o.id = p_id
$$;
create function pg_temp.raw(p_from date, p_to date) returns numeric language sql as $$ select (public.raw_waste_costs(p_from, p_to) ->> 'valueEur')::numeric $$;
create function pg_temp.wc(p_from date, p_to date, p_key text) returns numeric language sql as $$ select (public.waste_costs(p_from, p_to) ->> p_key)::numeric $$;

-- Winter: Sunday night into Monday (A: 02:00) ---------------------------------------------------------------------------------------------------------------
-- Sun 23:59 CET (1), Mon 01:30 (2), Mon 01:45 whose stored effective_on is ALREADY the business date Sunday (16), Mon 02:00 sharp (4), Mon 02:30 (8).
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 1, '1998-11-08T22:59Z');
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 2, '1998-11-09T00:30Z');
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 16, '1998-11-09T00:45Z', '1998-11-08');
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 4, '1998-11-09T01:00Z');
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 8, '1998-11-09T01:30Z');
select is((select effective_on from public.stock_movement where created_at = '1998-11-09T00:30Z'), '1998-11-09'::date, 'the 01:30 row is stored with the calendar date Monday (as post_stock_outflow writes it)');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.raw('1998-11-08', '1998-11-08'), 19::numeric, 'raw_waste_costs, Sunday: 1 + 2 (01:30 Monday) + 16');
select is(pg_temp.raw('1998-11-09', '1998-11-09'), 12::numeric, 'raw_waste_costs, Monday: 4 (02:00 sharp) + 8 (02:30)');
select is(pg_temp.wc('1998-11-08', '1998-11-08', 'rawValueEur'), 19::numeric, 'waste_costs, Sunday: rawValueEur 19');
select is(pg_temp.wc('1998-11-09', '1998-11-09', 'valueEur'), 12::numeric, 'waste_costs, Monday: valueEur 12');
select is(pg_temp.wc('1998-11-02', '1998-11-08', 'rawValueEur'), 19::numeric, 'waste_costs, the ISO week that ends Sunday: 19');
select is(pg_temp.wc('1998-11-09', '1998-11-15', 'rawValueEur'), 12::numeric, 'waste_costs, the next week: 12');
select is((public.waste_costs('1998-11-08', '1998-11-08') -> 'reasons' -> 0 -> 'lines' -> 0 ->> 'qty')::numeric, 19::numeric, 'the line quantity follows the same range');
select is((app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-08', null, null, '1998-11-12T09:00Z') -> 'current' -> 'waste' ->> 'valueEur')::numeric, 19::numeric, 'KPI report, day 1998-11-08: waste 19');
select is((app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-09', null, null, '1998-11-12T09:00Z') -> 'current' -> 'waste' ->> 'valueEur')::numeric, 12::numeric, 'KPI report, day 1998-11-09: waste 12');
-- The dashboard tile: at Monday 01:45 CET it is still Sunday's week, so the Sunday-night raw waste is in it; from 02:30 on it is Monday's week.
select is((app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-09T00:45Z') -> 'waste' ->> 'rawValueEur')::numeric, 19::numeric, 'dashboard tile at Monday 01:45 CET: the week of Sunday 11-08 holds raw waste 19');
select is((app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-09T00:45Z') -> 'waste' ->> 'from'), '1998-11-02', 'and the tile says so: from 11-02');
select is((app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-12T09:00Z') -> 'waste' ->> 'rawValueEur')::numeric, 12::numeric, 'dashboard tile, the week of 1998-11-12: raw waste 12');

-- unvaluedCount ----------------------------------------------------------------------------------------------------------------------------------------------
-- Sedano, no cost: U1 Mon 01:30 (business Sunday), unreversed. U2 Sun 21:00, reversed Mon 01:50 (business Sunday: inside the Sunday range). U3 Sun 20:00, reversed Mon 02:30 (business
-- Monday: after the Sunday range, so Sunday still counts it). Value stays 19: an unvalued row is never valued at 0.
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 0.5, '1998-11-09T00:30Z', null, null, '1b000000-0000-4000-8000-00000000001b');
select pg_temp.rev(pg_temp.rw('11111111-1111-4111-8111-111111111111', 0.5, '1998-11-08T20:00Z', null, null, '1b000000-0000-4000-8000-00000000001b'), '1998-11-09T00:50Z');
select pg_temp.rev(pg_temp.rw('11111111-1111-4111-8111-111111111111', 0.5, '1998-11-08T19:00Z', null, null, '1b000000-0000-4000-8000-00000000001b'), '1998-11-09T01:30Z');
select is((public.raw_waste_costs('1998-11-08', '1998-11-08') ->> 'unvaluedCount')::int, 2, 'raw unvaluedCount, Sunday: U1 (01:30 Monday) and U3 (reversed after the range); U2 reversed inside it is out');
select is((public.raw_waste_costs('1998-11-09', '1998-11-09') ->> 'unvaluedCount')::int, 0, 'raw unvaluedCount, Monday: none (a reversal row is not an unvalued operation)');
select is((public.waste_costs('1998-11-08', '1998-11-08') ->> 'unvaluedCount')::int, 2, 'waste_costs unvaluedCount, Sunday: the same 2');
select is((app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-09T00:45Z') -> 'waste' ->> 'unvaluedCount')::int, 2, 'dashboard tile at Monday 01:45 CET: unvaluedCount 2');
select is(pg_temp.raw('1998-11-08', '1998-11-08'), 19::numeric, 'and the value of Sunday is still 19');

-- Spring night 1999-03-28 (02:00 does not exist; the cut-off is the jump instant 03:00 CEST = 01:00Z) --------------------------------------------------------
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 1, '1999-03-27T22:59Z');
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 2, '1999-03-28T00:30Z');
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 4, '1999-03-28T01:00Z');
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 8, '1999-03-28T01:30Z');
select is(pg_temp.raw('1999-03-27', '1999-03-27'), 3::numeric, 'spring night: Saturday 23:59 and Sunday 01:30 CET count on Saturday 03-27');
select is(pg_temp.raw('1999-03-28', '1999-03-28'), 12::numeric, 'spring night: 03:00 CEST sharp and 03:30 count on Sunday 03-28');
select is(pg_temp.wc('1999-03-22', '1999-03-28', 'rawValueEur'), 15::numeric, 'spring night: the week 03-22..28 holds all four (15)');

-- Autumn night 1998-10-25 (02:00 happens twice; the cut-off is the first, 02:00 CEST = 00:00Z) -------------------------------------------------------------------
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 1, '1998-10-24T23:30Z');
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 2, '1998-10-25T00:30Z');
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 4, '1998-10-26T00:30Z');
select pg_temp.rw('11111111-1111-4111-8111-111111111111', 8, '1998-10-26T01:00Z');
select is(pg_temp.raw('1998-10-24', '1998-10-24'), 1::numeric, 'autumn night: 01:30 CEST on the 25th is the 24th''s business day');
select is(pg_temp.raw('1998-10-25', '1998-10-25'), 6::numeric, 'autumn night: 02:30 CEST and Monday 01:30 CET (the day is 25 hours) are the 25th');
select is(pg_temp.raw('1998-10-26', '1998-10-26'), 8::numeric, 'autumn night: Monday 02:00 CET sharp is the 26th');
select is((app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '1998-10-26T00:30Z') -> 'waste' ->> 'from') || '/' || (app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '1998-10-26T00:30Z') -> 'waste' ->> 'rawValueEur'),
          '1998-10-19/7.0000', 'autumn night: the tile at Monday 01:30 CET is still the week of 10-19, with 1 + 2 + 4');

-- Tenant B (04:00) and isolation ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.rw('22222222-2222-4222-8222-222222222222', 32, '1998-11-09T02:30Z');
select pg_temp.rw('22222222-2222-4222-8222-222222222222', 64, '1998-11-09T03:30Z');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.raw('1998-11-08', '1998-11-08'), 32::numeric, 'tenant B (04:00): Monday 03:30 CET is Sunday''s business day');
select is(pg_temp.raw('1998-11-09', '1998-11-09'), 64::numeric, 'tenant B: Monday 04:30 CET is Monday');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.raw('1998-11-08', '1998-11-08'), 19::numeric, 'and tenant A''s Sunday did not move');

-- The real writer: post_waste writes created_at = now() and the reader finds the row on the business day of now() ------------------------------------------------
select public.post_waste('1a000000-0000-4000-8000-00000000001a', 3, 'kg', 'breakage');
select is((select created_at = now() from public.stock_movement where reason_code = 'breakage'), true, 'post_waste stamps created_at with the event instant (no client time, no date parameter)');
select is((select (public.waste_costs(app.business_date('11111111-1111-4111-8111-111111111111', now()), app.business_date('11111111-1111-4111-8111-111111111111', now())) -> 'reasons') @> '[{"reasonCode": "breakage"}]'), true,
          'and waste_costs finds it on the business day of now()');

-- Receipts keep the invoice date (founder M5 Q1): approve_invoice is not changed ---------------------------------------------------------------------------------
reset role;
insert into public.supplier (id, tenant_id, name, vat_number, payment_terms_days) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903', 30);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, invoice_unit) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 1, 'kg', 'kg');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total, gross_total, supplier_id) values
  ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000001.pdf', 'application/pdf', 100, 'review',
   'IT12345678903', 'Fornitore Demo Srl', 'FT 1', '1998-09-29', '1998-10-31', 10, 1, 11, '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, sub_position, raw_description, qty, line_amount, vat_rate, unit, ingredient_id, supplier_item_id, mapping_source, is_stock, credit_qty, field_confidence, extracted) values
  ('a2000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000001', 1, 0, 'Manzo', 2, 10, 10, 'kg',
   '1a000000-0000-4000-8000-00000000001a', '51000000-0000-4000-8000-000000000051', 'manual', true, 0, '{}', '{}');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err($$select public.approve_invoice('00000000-0000-4000-8000-000000000001')$$), 'ok', 'approve_invoice of the invoice dated 1998-09-29 succeeds');
select is((select effective_on from public.stock_movement where type::text = 'receipt'), '1998-09-29'::date, 'its receipt keeps the invoice date as effective_on');
select is((select created_at::date from public.stock_movement where type::text = 'receipt'), (now())::date, 'while created_at is the posting moment (so a created_at reader would date it wrongly: receipts are not read that way)');
select is((select count(*)::int from public.stock_movement where type::text = 'receipt' and effective_on = '1998-09-29'), 1, 'one receipt on the invoice date');
select is(pg_temp.raw('1998-09-29', '1998-09-29'), 0::numeric, 'and a receipt is no waste, whatever day is read');
select is((select md5(prosrc) from pg_proc where proname = 'approve_invoice' and pronamespace = 'public'::regnamespace), 'ee093461349c9ee3574d560b5b4b7859', 'public.approve_invoice: unchanged (md5)');

-- Roles, grants, shape of the replaced function ---------------------------------------------------------------------------------------------------------------------
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.raw_waste_costs(date,date)', 'execute')), array['authenticated'],
          'only authenticated executes raw_waste_costs');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.raw_waste_costs(date,date)'::regprocedure), true, 'still a definer with an empty search_path');
select is(left(pg_temp.err($$select public.raw_waste_costs('1998-11-09', '1998-11-08')$$), 20), 'P0001 range_invalid', 'the range rules are unchanged: from after to is range_invalid');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$select public.raw_waste_costs('1998-11-08', '1998-11-08')$$), 6), '42501 ', 'the waiter is refused the raw waste report');

select * from finish();
rollback;
