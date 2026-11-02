-- Founder decision A5 (docs/plans/2026-11-02-a5-business-date-discards.md): batch movements count on the BUSINESS day (cut-off 02:00 by default), not on the calendar day.
-- Option (b): the readers (public.waste_costs batch side, app.discards_vs_push_json and everything that calls them: the KPI report, the dashboard tiles, the M24 exports) group by the
-- business day of created_at, so rows written before the fix (stored with the calendar effective_on, which is the day AFTER the business day between 00:00 and the cut-off) count the
-- same as new ones, with no UPDATE. Every fixture row here has the calendar effective_on, as discard_batch writes it. Cases: Sunday night into Monday (winter), both DST nights, a
-- tenant with a 04:00 cut-off, a row whose stored effective_on is already the business date, tenant isolation, roles and grants. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
-- Tenant B closes at 04:00.
insert into public.tenant (id, name, vat_number, settings) values
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"business_day_cutoff": "04:00"}'::jsonb);
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000eb', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'stufato b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01', 'Spezzatino', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000db', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 1, '2026-10-01', 'Stufato B (demo)', 2, 'kg', 10, 48, 'b1000000-0000-4000-8000-00000000000b');

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
-- One big batch per tenant (1000 portions, cost 1.00 per portion, so the EUR value of a day equals its discarded portions).
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
    portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by) values
  ('b0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1, '261001-LOT-1', '2026-10-01', 'LOT', 1,
   '2026-10-01T10:00Z', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 1000, 1000, 48, '2026-10-03T10:00Z', 'fresh', '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a'),
  ('b0000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 'ed000000-0000-4000-8000-0000000000db', 1, '261001-STB-1', '2026-10-01', 'STB', 1,
   '2026-10-01T10:00Z', 'b1000000-0000-4000-8000-00000000000b', 2, 'kg', 1000, 1000, 48, '2026-10-03T10:00Z', 'fresh', '10000000-0000-4000-8000-0000000000b1', 'b1000000-0000-4000-8000-00000000000b');
insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by) values
  ('b0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 1000, 1.00, false, '{}', '2026-10-01T10:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('b0000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 1000, 1.00, false, '{}', '2026-10-01T10:00Z', 'b1000000-0000-4000-8000-00000000000b');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'b0000000-0000-4000-8000-0000000000a1', 'produce', 1000, 'batch', 'b0000000-0000-4000-8000-0000000000a1', '2026-10-01', '2026-10-01T10:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-0000000000b1', 'produce', 1000, 'batch', 'b0000000-0000-4000-8000-0000000000b1', '2026-10-01', '2026-10-01T10:00Z', 'b1000000-0000-4000-8000-00000000000b');
-- A discard of tenant A (default) or B at p_at, dated the way discard_batch dated it before A5: the CALENDAR date of p_at in Rome. p_eff overrides it.
create function pg_temp.disc(p_tenant text, p_portions numeric, p_at timestamptz, p_eff date default null) returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
  select t.id, case when t.id = '11111111-1111-4111-8111-111111111111' then 'b0000000-0000-4000-8000-0000000000a1'::uuid else 'b0000000-0000-4000-8000-0000000000b1'::uuid end,
         'waste', -p_portions, 'expired', 'batch_discard', gen_random_uuid(), coalesce(p_eff, (p_at at time zone 'Europe/Rome')::date), p_at,
         case when t.id = '11111111-1111-4111-8111-111111111111' then 'a1000000-0000-4000-8000-00000000000a'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end
    from public.tenant t where t.id = p_tenant::uuid
$$;
-- The batch value of the waste report (owner of A) for a range, and the discards report of tenant A for the week of p_week.
create function pg_temp.wv(p_from date, p_to date) returns numeric language sql as $$ select (public.waste_costs(p_from, p_to) ->> 'batchValueEur')::numeric $$;
create function pg_temp.dvp(p_tenant text, p_week date, p_now timestamptz) returns numeric language sql as $$
  select coalesce((app.discards_vs_push_json(p_tenant::uuid, p_week, p_now) -> 'totals' ->> 'portionsDiscarded')::numeric, 0) $$;
create function pg_temp.wv_b(p_from date, p_to date) returns numeric language sql as $$ select (public.waste_costs(p_from, p_to) ->> 'batchValueEur')::numeric $$;

-- The helpers ----------------------------------------------------------------------------------------------------------------------------------------------
select is(app.business_date('11111111-1111-4111-8111-111111111111', '2026-11-09T00:30Z'), '2026-11-08'::date, 'business_date: Monday 01:30 CET is still Sunday''s business day');
select is(app.business_date('11111111-1111-4111-8111-111111111111', '2026-11-09T01:00Z'), '2026-11-09'::date, 'business_date: exactly the 02:00 cut-off is Monday');
select is(app.business_date('11111111-1111-4111-8111-111111111111', '2026-11-09T01:30Z'), '2026-11-09'::date, 'business_date: Monday 02:30 CET is Monday');
select is(app.business_date('22222222-2222-4222-8222-222222222222', '2026-11-09T02:30Z'), '2026-11-08'::date, 'business_date: with a 04:00 cut-off Monday 03:30 CET is still Sunday');
select is(app.business_day_start('11111111-1111-4111-8111-111111111111', '2026-11-09'), '2026-11-09T01:00Z'::timestamptz, 'business_day_start: Monday starts at 02:00 CET');
select is(app.business_day_start('11111111-1111-4111-8111-111111111111', '2027-03-28'), '2027-03-28T01:00Z'::timestamptz, 'business_day_start: on the spring night the day starts at the jump instant 03:00 CEST');
select is(app.business_day_start('11111111-1111-4111-8111-111111111111', '2026-10-25'), '2026-10-25T00:00Z'::timestamptz, 'business_day_start: on the autumn night the day starts at the first 02:00 (CEST)');
select is(app.business_day_start('11111111-1111-4111-8111-111111111111', '2026-10-26'), '2026-10-26T01:00Z'::timestamptz, 'business_day_start: the 25 hours of 2026-10-25 end at 02:00 CET');
select is(pg_temp.err($$ select app.business_day_start('99999999-9999-4999-8999-999999999999', '2026-11-09') $$), 'P0002 tenant_not_found', 'business_day_start: unknown tenant');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
                unnest(array['app.business_day_start(uuid,date)']) f(name)
           where has_function_privilege(r.role, f.name, 'execute')), 0, 'no API role executes the new helper');
select is((select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
            where oid = 'app.business_day_start(uuid,date)'::regprocedure), true, 'a definer with an empty search_path');
select has_index('public', 'batch_movement', 'batch_movement_created_idx', 'the readers'' index exists');
select matches(pg_get_indexdef('public.batch_movement_created_idx'::regclass), '^CREATE INDEX batch_movement_created_idx ON public\.batch_movement USING btree \(tenant_id, created_at\)$', 'on (tenant_id, created_at)');

-- Winter: Sunday night into Monday (A: 02:00) ---------------------------------------------------------------------------------------------------------------
-- Sun 23:59 CET (1), Mon 01:30 (2), Mon 01:45 whose stored effective_on is ALREADY the business date Sunday (16), Mon 02:00 sharp (4), Mon 02:30 (8).
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 1, '2026-11-08T22:59Z');
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 2, '2026-11-09T00:30Z');
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 16, '2026-11-09T00:45Z', '2026-11-08');
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 4, '2026-11-09T01:00Z');
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 8, '2026-11-09T01:30Z');
select is((select effective_on from public.batch_movement where created_at = '2026-11-09T00:30Z'), '2026-11-09'::date, 'the 01:30 row is stored with the calendar date Monday (a row written before the fix)');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.wv('2026-11-08', '2026-11-08'), 19::numeric, 'waste report, Sunday: 1 + 2 (01:30 Monday) + 16');
select is(pg_temp.wv('2026-11-09', '2026-11-09'), 12::numeric, 'waste report, Monday: 4 (02:00 sharp) + 8 (02:30)');
select is(pg_temp.wv('2026-11-02', '2026-11-08'), 19::numeric, 'waste report, the ISO week that ends Sunday: 19');
select is(pg_temp.wv('2026-11-09', '2026-11-15'), 12::numeric, 'waste report, the next week: 12');
select is((public.waste_costs('2026-11-08', '2026-11-08') ->> 'unvaluedCount')::int, 0, 'unvaluedCount follows the same range');
select is(pg_temp.dvp('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-12T09:00Z'), 19::numeric, 'discards vs push, Sunday''s ISO week: 19 portions');
select is(pg_temp.dvp('11111111-1111-4111-8111-111111111111', '2026-11-10', '2026-11-12T09:00Z'), 12::numeric, 'discards vs push, the next week: 12 portions');
select is((app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '2026-11-08', null, null, '2026-11-12T09:00Z') -> 'current' -> 'waste' ->> 'valueEur')::numeric, 19::numeric, 'KPI report, day 2026-11-08: waste 19');
select is((app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '2026-11-09', null, null, '2026-11-12T09:00Z') -> 'current' -> 'waste' ->> 'valueEur')::numeric, 12::numeric, 'KPI report, day 2026-11-09: waste 12');
select is((app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '2026-11-12T09:00Z') -> 'waste' ->> 'batchValueEur')::numeric, 12::numeric, 'dashboard tile, the week of 2026-11-12: batch waste 12');
select is((app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '2026-11-10T09:00Z') -> 'waste' ->> 'batchValueEur')::numeric, 12::numeric, 'dashboard tile, Tuesday 11-10: the week of Monday 11-09 holds the 02:00 and 02:30 discards');

-- Spring night 2027-03-28 (02:00 does not exist; the cut-off is the jump instant 03:00 CEST = 01:00Z) --------------------------------------------------------
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 1, '2027-03-27T22:59Z');
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 2, '2027-03-28T00:30Z');
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 4, '2027-03-28T01:00Z');
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 8, '2027-03-28T01:30Z');
select is(pg_temp.wv('2027-03-27', '2027-03-27'), 3::numeric, 'spring night: Saturday 23:59 and Sunday 01:30 CET count on Saturday 03-27');
select is(pg_temp.wv('2027-03-28', '2027-03-28'), 12::numeric, 'spring night: 03:00 CEST sharp and 03:30 count on Sunday 03-28');
select is(pg_temp.dvp('11111111-1111-4111-8111-111111111111', '2027-03-24', '2027-04-05T09:00Z'), 15::numeric, 'spring night: the ISO week 03-22..28 holds all four (15)');

-- Autumn night 2026-10-25 (02:00 happens twice; the cut-off is the first, 02:00 CEST = 00:00Z) -------------------------------------------------------------------
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 1, '2026-10-24T23:30Z');
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 2, '2026-10-25T00:30Z');
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 4, '2026-10-26T00:30Z');
select pg_temp.disc('11111111-1111-4111-8111-111111111111', 8, '2026-10-26T01:00Z');
select is(pg_temp.wv('2026-10-24', '2026-10-24'), 1::numeric, 'autumn night: 01:30 CEST on the 25th is the 24th''s business day');
select is(pg_temp.wv('2026-10-25', '2026-10-25'), 6::numeric, 'autumn night: 02:30 CEST and Monday 01:30 CET (the day is 25 hours) are the 25th');
select is(pg_temp.wv('2026-10-26', '2026-10-26'), 8::numeric, 'autumn night: Monday 02:00 CET sharp is the 26th');
select is(pg_temp.dvp('11111111-1111-4111-8111-111111111111', '2026-10-20', '2026-10-30T09:00Z'), 7::numeric, 'autumn night: the ISO week 10-19..25 holds 1 + 2 + 4 (Monday 01:30 CET is still Sunday)');
select is(pg_temp.dvp('11111111-1111-4111-8111-111111111111', '2026-10-27', '2026-10-30T09:00Z'), 8::numeric, 'autumn night: the next week holds the 02:00 CET discard');

-- Tenant B (04:00) and isolation ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.disc('22222222-2222-4222-8222-222222222222', 32, '2026-11-09T02:30Z');
select pg_temp.disc('22222222-2222-4222-8222-222222222222', 64, '2026-11-09T03:30Z');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.wv_b('2026-11-08', '2026-11-08'), 32::numeric, 'tenant B (04:00): Monday 03:30 CET is Sunday''s business day');
select is(pg_temp.wv_b('2026-11-09', '2026-11-09'), 64::numeric, 'tenant B: Monday 04:30 CET is Monday');
select is(pg_temp.dvp('22222222-2222-4222-8222-222222222222', '2026-11-04', '2026-11-12T09:00Z'), 32::numeric, 'tenant B: discards vs push for Sunday''s week sees only its own 32');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.wv('2026-11-08', '2026-11-08'), 19::numeric, 'and tenant A''s Sunday did not move');

-- Roles and grants unchanged -------------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err($$select public.waste_costs('2026-11-08', '2026-11-08')$$), 6), '42501 ', 'the chef is refused the waste report');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$select public.waste_costs('2026-11-08', '2026-11-08')$$), 6), '42501 ', 'the waiter is refused the waste report');
select is(left(pg_temp.err($$select public.discards_vs_push(null)$$), 6), '42501 ', 'and the discards report');
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.waste_costs(date,date)', 'execute')), array['authenticated'], 'only authenticated executes waste_costs');

select * from finish();
rollback;
