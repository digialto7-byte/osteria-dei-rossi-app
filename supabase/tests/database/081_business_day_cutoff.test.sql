-- M11 step 2 (migration 20261025100100_business_day_cutoff.sql): the business-day cut-off helpers.
-- Acceptance test 7 (DST vectors, Europe/Rome, cut-off 02:00): a staff session ends at the first instant at
-- which the venue clock reads the cut-off or later.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  return state;
end
$$;

-- next_cutoff -------------------------------------------------------------------------------------------------
select is(app.next_cutoff('2026-07-10T12:00Z', 'Europe/Rome', '02:00'), '2026-07-11T00:00Z'::timestamptz,
  'summer noon: the next 02:00 CEST is 00:00Z the next day');
select is(app.next_cutoff('2026-11-10T12:00Z', 'Europe/Rome', '02:00'), '2026-11-11T01:00Z'::timestamptz,
  'winter noon: the next 02:00 CET is 01:00Z the next day');
select is(app.next_cutoff('2026-10-24T23:30Z', 'Europe/Rome', '02:00'), '2026-10-25T00:00Z'::timestamptz,
  'autumn change: 01:30 CEST ends at the FIRST occurrence of the repeated 02:00');
select is(app.next_cutoff('2026-10-25T00:30Z', 'Europe/Rome', '02:00'), '2026-10-26T01:00Z'::timestamptz,
  'autumn change: 02:30 CEST is past the first 02:00, so the next day''s');
select is(app.next_cutoff('2027-03-27T23:30Z', 'Europe/Rome', '02:00'), '2027-03-28T01:00Z'::timestamptz,
  'spring change: 02:00 does not exist, so the session ends at the jump');
select is(app.next_cutoff('2027-03-28T01:00Z', 'Europe/Rome', '02:00'), '2027-03-29T00:00Z'::timestamptz,
  'exactly at the jump: the next day''s cut-off');
select is(app.next_cutoff('2026-07-11T00:00Z', 'Europe/Rome', '02:00'), '2026-07-12T00:00Z'::timestamptz,
  'exactly at a cut-off: the next day''s, never the same instant');
select is(app.next_cutoff('2026-07-10T21:59:59Z', 'Europe/Rome', '02:00'), '2026-07-11T00:00Z'::timestamptz,
  'one second before midnight local: the coming cut-off');
select is(app.next_cutoff('2026-07-10T12:00Z', 'Europe/Rome', '01:30'), '2026-07-10T23:30Z'::timestamptz,
  'a 01:30 cut-off');
select is(app.next_cutoff('2026-07-10T12:00Z', 'Europe/Rome', '00:00'), '2026-07-10T22:00Z'::timestamptz,
  'a midnight cut-off ends at local midnight');
select is(app.next_cutoff('2026-07-10T12:00Z', 'UTC', '02:00'), '2026-07-11T02:00Z'::timestamptz,
  'another zone');

-- local_instant -----------------------------------------------------------------------------------------------
select is(app.local_instant('2026-10-25', '02:00', 'Europe/Rome'), '2026-10-25T00:00Z'::timestamptz,
  'ambiguous wall time: the earlier occurrence');
select is(app.local_instant('2027-03-28', '02:00', 'Europe/Rome'), '2027-03-28T01:00Z'::timestamptz,
  'nonexistent wall time: the instant of the jump');
select is(app.local_instant('2027-03-28', '02:30', 'Europe/Rome'), '2027-03-28T01:00Z'::timestamptz,
  'any time inside the gap: the jump');
select is(app.local_instant('2027-03-28', '03:00', 'Europe/Rome'), '2027-03-28T01:00Z'::timestamptz,
  'the first valid time after the gap is the jump too');
select is(app.local_instant('2026-07-10', '12:00', 'Europe/Rome'), '2026-07-10T10:00Z'::timestamptz,
  'an ordinary summer time');

-- business_day_cutoff -----------------------------------------------------------------------------------------
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{}'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001', '{"business_day_cutoff": "01:30"}'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT00000000002', '{"business_day_cutoff": "25:00"}'),
  ('44444444-4444-4444-8444-444444444444', 'Osteria Demo D', 'IT00000000003', '{"business_day_cutoff": "2:00"}'),
  ('55555555-5555-4555-8555-555555555555', 'Osteria Demo E', 'IT00000000004', '{"business_day_cutoff": 2}');
select is(app.business_day_cutoff('11111111-1111-4111-8111-111111111111'), '02:00'::time, 'no key: 02:00');
select is(app.business_day_cutoff('22222222-2222-4222-8222-222222222222'), '01:30'::time, '01:30 is used');
select is(app.business_day_cutoff('33333333-3333-4333-8333-333333333333'), '02:00'::time, '25:00 falls back');
select is(app.business_day_cutoff('44444444-4444-4444-8444-444444444444'), '02:00'::time, '2:00 falls back');
select is(app.business_day_cutoff('55555555-5555-4555-8555-555555555555'), '02:00'::time, 'a number falls back');
select is(pg_temp.err($$ select app.business_day_cutoff('99999999-9999-4999-8999-999999999999') $$), 'P0002',
  'unknown tenant: tenant_not_found');

-- Grants ------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
                unnest(array['app.business_day_cutoff(uuid)', 'app.local_instant(date,time,text)',
                             'app.next_cutoff(timestamptz,text,time)']) f(name)
           where has_function_privilege(r.role, f.name, 'execute')), 0,
  'no API role can execute the helpers');
select * from finish();
rollback;
