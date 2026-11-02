-- M25c step 2 (docs/plans/2026-11-01-m25c-services.md §3.1.2, §3.2, §5 step 2; ADR-031): the assignment of a table session to a service, from its opening time, the
-- tenant's cut-off and the schedule version in force at that instant, with append-only overrides. Every instant is a fixed UTC instant (Europe/Rome: CET +01 in
-- winter, CEST +02 in summer). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'owner-c@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'owner-d@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'owner-e@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{}'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{}'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220', '{"business_day_cutoff": "00:30"}'),
  ('44444444-4444-4444-8444-444444444444', 'Osteria Demo D', 'IT33333333335', '{}'),
  ('55555555-5555-4555-8555-555555555555', 'Osteria Demo E', 'IT44444444440', '{}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-00000000000c', 'owner', 'Titolare C Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '44444444-4444-4444-8444-444444444444', 'd0000000-0000-4000-8000-00000000000d', 'owner', 'Titolare D Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '55555555-5555-4555-8555-555555555555', 'e0000000-0000-4000-8000-00000000000e', 'owner', 'Titolare E Demo');

-- A closed session of the tenant opened at p_opened (its table is made with it). The id is deterministic.
create function pg_temp.sid(p_tenant uuid, p_n int) returns uuid language sql as $$ select md5(p_tenant::text || ':' || p_n)::uuid $$;
create function pg_temp.mk(p_tenant uuid, p_n int, p_opened timestamptz) returns uuid language plpgsql as $$
declare
  v_user uuid := (select id from public.app_user where tenant_id = p_tenant limit 1);
  v_table uuid := md5('table:' || p_tenant::text || ':' || p_n)::uuid;
begin
  insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
    values (v_table, p_tenant, 'Tavolo ' || p_n || ' (demo)', p_n, v_user, v_user);
  insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, closed_at, closed_by,
                                    closed_business_date, receipt_type, payment_type, total, created_by, updated_by)
    values (pg_temp.sid(p_tenant, p_n), p_tenant, v_table, 'Tavolo ' || p_n || ' (demo)', 2, p_opened, v_user, ((p_opened at time zone 'Europe/Rome') - interval '2 hours')::date,
            p_opened + interval '1 hour', v_user, ((p_opened at time zone 'Europe/Rome') - interval '1 hour')::date, 'scontrino', 'card', 10.00, v_user, v_user);
  return pg_temp.sid(p_tenant, p_n);
end
$$;
create function pg_temp.svc(p_tenant uuid, p_n int) returns text language sql as $$
  select service_key from app.session_service_one(p_tenant, pg_temp.sid(p_tenant, p_n))
$$;

-- Tenant B: its own one-period schedule and an override (they must never change A's results).
insert into public.service_schedule (tenant_id, periods, created_at, created_by)
  values ('22222222-2222-4222-8222-222222222222', '[{"key":"cena","name":"Cena","startsAt":"00:00"}]', '2026-10-01T00:00Z', 'b1000000-0000-4000-8000-00000000000b');
select pg_temp.mk('22222222-2222-4222-8222-222222222222', 1, '2026-11-04 10:00+00');
insert into public.service_override (tenant_id, table_session_id, service_key, created_at, created_by)
  values ('22222222-2222-4222-8222-222222222222', pg_temp.sid('22222222-2222-4222-8222-222222222222', 1), 'cena', '2026-11-04T12:00Z', 'b1000000-0000-4000-8000-00000000000b');

-- The minute on the business clock ------------------------------------------------------------------------------------------------
select is(app.service_minute('02:00', '02:00'), 0, 'the cut-off is minute 0');
select is(app.service_minute('01:59', '02:00'), 1439, 'one minute before the cut-off is the last minute of the day');
select is(app.service_minute('11:00', '02:00'), 540, '11:00 is minute 540 after a 02:00 cut-off');
select is(app.service_minute('00:15', '00:30'), 1425, '00:15 is minute 1425 after a 00:30 cut-off');
select is(app.service_minute('00:45', '00:30'), 15, 'and 00:45 is minute 15');

-- The windows ------------------------------------------------------------------------------------------------------------------------
select is(app.service_windows(app.default_service_periods(), '02:00'),
          '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00","position":1,"endsAt":"16:00"},{"key":"cena","name":"Cena","startsAt":"16:00","position":2,"endsAt":"02:00"}]'::jsonb,
          'the default windows: Pranzo 11:00-16:00, Cena 16:00-02:00');
select is(app.service_windows('[{"key":"cena","name":"Cena","startsAt":"19:30"},{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"s_0123456789","name":"Aperitivo","startsAt":"18:00"}]', '02:00'),
          '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00","position":1,"endsAt":"18:00"},{"key":"s_0123456789","name":"Aperitivo","startsAt":"18:00","position":2,"endsAt":"19:30"},{"key":"cena","name":"Cena","startsAt":"19:30","position":3,"endsAt":"02:00"}]'::jsonb,
          'three services, given out of order: sorted, ends 18:00, 19:30 and 02:00');
select is((select w ->> 'endsAt' from jsonb_array_elements(app.service_windows(app.default_service_periods(), '00:30')) w where w ->> 'key' = 'cena'), '00:30', 'the last window ends at the tenant''s cut-off');
select is((select jsonb_agg(w ->> 'key' order by (w ->> 'position')::int) from jsonb_array_elements(app.service_windows('[{"key":"late","name":"Tardi","startsAt":"01:00"},{"key":"cena","name":"Cena","startsAt":"16:00"}]', '02:00')) w),
          '["cena","late"]'::jsonb, 'a start before the cut-off belongs to the end of the business day (01:00 sorts after 16:00)');

-- The key for a local time -------------------------------------------------------------------------------------------------------------
select is(app.service_key_for(app.default_service_periods(), '10:59', '02:00'), 'pranzo', 'before the first start: the first service (10:59)');
select is(app.service_key_for(app.default_service_periods(), '11:00', '02:00'), 'pranzo', 'at the first start: Pranzo');
select is(app.service_key_for(app.default_service_periods(), '15:59', '02:00'), 'pranzo', '15:59 is Pranzo');
select is(app.service_key_for(app.default_service_periods(), '16:00', '02:00'), 'cena', '16:00 is Cena');
select is(app.service_key_for(app.default_service_periods(), '02:00', '02:00'), 'pranzo', 'at the cut-off a new business day starts in Pranzo');
select is(app.service_key_for(app.default_service_periods(), '01:59', '02:00'), 'cena', 'one minute before the cut-off is still Cena');

-- Tenant A, default schedule, Europe/Rome, cut-off 02:00 ---------------------------------------------------------------------------
create temp table cases (tenant uuid, n int, opened timestamptz, expected text, label text);
insert into cases values
  ('11111111-1111-4111-8111-111111111111',  1, '2026-11-04 01:00:00+00', 'pranzo', '02:00 CET is Pranzo (a new day starts at the cut-off)'),
  ('11111111-1111-4111-8111-111111111111',  2, '2026-11-04 09:59:00+00', 'pranzo', '10:59 is before the first start: Pranzo'),
  ('11111111-1111-4111-8111-111111111111',  3, '2026-11-04 14:59:59+00', 'pranzo', '15:59:59 is Pranzo'),
  ('11111111-1111-4111-8111-111111111111',  4, '2026-11-04 15:00:00+00', 'cena',   '16:00 is Cena'),
  ('11111111-1111-4111-8111-111111111111',  5, '2026-11-04 22:50:00+00', 'cena',   '23:50 is Cena'),
  ('11111111-1111-4111-8111-111111111111',  6, '2026-11-05 00:59:00+00', 'cena',   '01:59 the next calendar day is still Cena'),
  ('11111111-1111-4111-8111-111111111111',  7, '2026-07-15 14:30:00+00', 'cena',   'time zone: 14:30Z is 16:30 CEST, Cena (UTC would say Pranzo)'),
  ('11111111-1111-4111-8111-111111111111',  8, '2026-10-25 00:30:00+00', 'pranzo', 'autumn night, first 02:30 (CEST): Pranzo'),
  ('11111111-1111-4111-8111-111111111111',  9, '2026-10-25 01:30:00+00', 'pranzo', 'autumn night, second 02:30 (CET): Pranzo'),
  ('11111111-1111-4111-8111-111111111111', 10, '2026-10-24 23:30:00+00', 'cena',   'autumn night, 01:30 CEST: Cena'),
  ('11111111-1111-4111-8111-111111111111', 11, '2027-03-28 00:30:00+00', 'cena',   'spring night, 01:30 CET: Cena'),
  ('11111111-1111-4111-8111-111111111111', 12, '2027-03-28 01:30:00+00', 'pranzo', 'spring night, 03:30 CEST: Pranzo'),
  -- Tenant C: cut-off 00:30
  ('33333333-3333-4333-8333-333333333333',  1, '2026-11-04 23:45:00+00', 'pranzo', 'cut-off 00:30: 00:45 local is the start of a new day, Pranzo'),
  ('33333333-3333-4333-8333-333333333333',  2, '2026-11-04 23:15:00+00', 'cena',   'cut-off 00:30: 00:15 local is the end of the old day, Cena'),
  -- Tenant D: three services, in November (CET)
  ('44444444-4444-4444-8444-444444444444',  1, '2026-11-04 16:59:00+00', 'pranzo',      'three services: 17:59 is Pranzo'),
  ('44444444-4444-4444-8444-444444444444',  2, '2026-11-04 17:30:00+00', 's_0123456789', 'three services: 18:30 is Aperitivo'),
  ('44444444-4444-4444-8444-444444444444',  3, '2026-11-04 18:30:00+00', 'cena',        'three services: 19:30 is Cena');
insert into public.service_schedule (tenant_id, periods, created_at, created_by)
  values ('44444444-4444-4444-8444-444444444444',
          '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"s_0123456789","name":"Aperitivo","startsAt":"18:00"},{"key":"cena","name":"Cena","startsAt":"19:30"}]',
          '2026-11-01T00:00Z', 'd1000000-0000-4000-8000-00000000000d');
select pg_temp.mk(tenant, n, opened) from cases order by tenant, n;
select is(pg_temp.svc(tenant, n), expected, label) from cases order by tenant, n;

-- The two reads agree for every session ------------------------------------------------------------------------------------------
select is((select count(*)::int from app.session_services('11111111-1111-4111-8111-111111111111', '2000-01-01', '2100-01-01') a
            join lateral app.session_service_one('11111111-1111-4111-8111-111111111111', a.session_id) b on true
           where a.service_key is distinct from b.service_key or a.auto_key is distinct from b.auto_key), 0, 'session_services and session_service_one agree for every session of A');
select is((select count(*)::int from app.session_services('11111111-1111-4111-8111-111111111111', '2000-01-01', '2100-01-01')), 12, 'session_services lists A''s 12 closed sessions and none of B''s');
select is((select count(*)::int from app.session_services('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-04')), 5, 'and it filters on the business date of the close (the range is closed_business_date)');

-- Windows and choices of a session ------------------------------------------------------------------------------------------------
select is(app.service_windows(app.service_periods_at('44444444-4444-4444-8444-444444444444', '2026-11-04 12:00+00'), '02:00') -> 0 ->> 'endsAt', '18:00', 'tenant D: Pranzo ends at 18:00');
select is((select choices from app.session_service_one('44444444-4444-4444-8444-444444444444', pg_temp.sid('44444444-4444-4444-8444-444444444444', 2))), array['pranzo', 's_0123456789', 'cena'], 'choices = the keys of the version in force, in window order');
select is((select count(*)::int from app.session_service_one('11111111-1111-4111-8111-111111111111', pg_temp.sid('22222222-2222-4222-8222-222222222222', 1))), 0, 'another tenant''s session id gives no row');
select is((select choices from app.session_service_one('11111111-1111-4111-8111-111111111111', pg_temp.sid('11111111-1111-4111-8111-111111111111', 1))), array['pranzo', 'cena'], 'a tenant with no schedule gets the default keys');

-- Versions (tenant A has none; tenant E carries the version cases) --------------------------------------------------------------------
create temp table vcases (n int, opened timestamptz, expected text, label text);
insert into vcases values
  (1, '2026-11-03 15:30:00+00', 'cena',   'before V2: the default is in force (16:30 CET is Cena)'),
  (2, '2026-11-04 15:29:59+00', 'cena',   'one second before V2: still the default'),
  (3, '2026-11-04 15:30:00+00', 'pranzo', 'exactly at V2''s created_at: V2 applies (Cena starts at 17:00)'),
  (4, '2026-11-04 16:30:00+00', 'cena',   'after V2: 17:30 is Cena'),
  (5, '2026-11-06 14:30:00+00', 'pranzo', 'two versions with the same created_at: the higher seq (V3, Cena from 18:00) wins');
insert into public.service_schedule (tenant_id, periods, created_at, created_by) values
  ('55555555-5555-4555-8555-555555555555', '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"17:00"}]', '2026-11-04T15:30:00Z', 'e1000000-0000-4000-8000-00000000000e'),
  ('55555555-5555-4555-8555-555555555555', '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"15:00"}]', '2026-11-06T12:00:00Z', 'e1000000-0000-4000-8000-00000000000e'),
  ('55555555-5555-4555-8555-555555555555', '[{"key":"brunch","name":"Brunch","startsAt":"09:00"},{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"18:00"}]', '2026-11-06T12:00:00Z', 'e1000000-0000-4000-8000-00000000000e');
select pg_temp.mk('55555555-5555-4555-8555-555555555555', n, opened) from vcases order by n;
select is(pg_temp.svc('55555555-5555-4555-8555-555555555555', n), expected, label) from vcases order by n;
select is(app.service_periods_at('55555555-5555-4555-8555-555555555555', '2026-11-06 12:00+00') -> 0 ->> 'key', 'brunch', 'service_periods_at: the higher seq of two versions with the same created_at');
select is(app.service_periods_at('55555555-5555-4555-8555-555555555555', '2026-11-04 15:29:59+00'), app.default_service_periods(), 'service_periods_at before the first version is the default');
select is((select choices from app.session_service_one('55555555-5555-4555-8555-555555555555', pg_temp.sid('55555555-5555-4555-8555-555555555555', 5))), array['brunch', 'pranzo', 'cena'], 'choices of a session under V3');

-- Overrides ---------------------------------------------------------------------------------------------------------------------------
-- Tenant D, session 3 (auto cena): pranzo, then aperitivo.
insert into public.service_override (tenant_id, table_session_id, service_key, created_at, created_by) values
  ('44444444-4444-4444-8444-444444444444', pg_temp.sid('44444444-4444-4444-8444-444444444444', 3), 'pranzo', '2026-11-04T20:00:00Z', 'd1000000-0000-4000-8000-00000000000d'),
  ('44444444-4444-4444-8444-444444444444', pg_temp.sid('44444444-4444-4444-8444-444444444444', 3), 's_0123456789', '2026-11-04T20:05:00Z', 'd1000000-0000-4000-8000-00000000000d');
select is((select service_key || ',' || auto_key || ',' || override_key || ',' || overridden::text from app.session_service_one('44444444-4444-4444-8444-444444444444', pg_temp.sid('44444444-4444-4444-8444-444444444444', 3))),
          's_0123456789,cena,s_0123456789,true', 'two overrides: the later wins, the auto key is kept');
select is((select service_key || ',' || auto_key || ',' || overridden::text from app.session_services('44444444-4444-4444-8444-444444444444', '2000-01-01', '2100-01-01') where session_id = pg_temp.sid('44444444-4444-4444-8444-444444444444', 3)),
          's_0123456789,cena,true', 'session_services says the same');
insert into public.service_override (tenant_id, table_session_id, service_key, created_at, created_by) values
  ('44444444-4444-4444-8444-444444444444', pg_temp.sid('44444444-4444-4444-8444-444444444444', 3), null, '2026-11-04T20:10:00Z', 'd1000000-0000-4000-8000-00000000000d');
select is((select service_key || ',' || overridden::text || ',' || coalesce(override_key, '-') from app.session_service_one('44444444-4444-4444-8444-444444444444', pg_temp.sid('44444444-4444-4444-8444-444444444444', 3))),
          'cena,false,-', 'a later null puts the session back to automatic');
select is((select service_key from app.session_services('44444444-4444-4444-8444-444444444444', '2000-01-01', '2100-01-01') where session_id = pg_temp.sid('44444444-4444-4444-8444-444444444444', 3)), 'cena', 'session_services agrees');
select is(pg_temp.svc('11111111-1111-4111-8111-111111111111', 4), 'cena', 'tenant B''s schedule and override do not change A''s results');
select is((select service_key from app.session_services('22222222-2222-4222-8222-222222222222', '2000-01-01', '2100-01-01')), 'cena', 'and B has its own result');

-- Labels -------------------------------------------------------------------------------------------------------------------------------
select is(app.service_labels('11111111-1111-4111-8111-111111111111', '2026-11-05 09:00+00'),
          '{"pranzo":{"name":"Pranzo","position":1},"cena":{"name":"Cena","position":2}}'::jsonb, 'a tenant with no schedule: the default names and positions');
select is(app.service_labels('55555555-5555-4555-8555-555555555555', '2026-11-07 09:00+00'),
          '{"brunch":{"name":"Brunch","position":1},"pranzo":{"name":"Pranzo","position":2},"cena":{"name":"Cena","position":3}}'::jsonb, 'tenant E now: the current version');
select is(app.service_labels('22222222-2222-4222-8222-222222222222', '2026-11-05 09:00+00'),
          '{"cena":{"name":"Cena","position":1},"pranzo":{"name":"Pranzo","position":null}}'::jsonb, 'a key of the default that the saved schedule dropped is kept, with position null');
insert into public.service_schedule (tenant_id, periods, created_at, created_by)
  values ('44444444-4444-4444-8444-444444444444', '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena serale","startsAt":"16:00"}]', '2026-11-10T00:00Z', 'd1000000-0000-4000-8000-00000000000d');
select is(app.service_labels('44444444-4444-4444-8444-444444444444', '2026-11-11 09:00+00'),
          '{"pranzo":{"name":"Pranzo","position":1},"cena":{"name":"Cena serale","position":2},"s_0123456789":{"name":"Aperitivo","position":null}}'::jsonb,
          'a renamed key shows its latest name; a removed key keeps its last name with position null');
select is(app.service_labels('44444444-4444-4444-8444-444444444444', '2026-11-05 09:00+00') -> 's_0123456789' ->> 'position', '2', 'at an earlier instant the older version is the current one');

-- Definer rules ------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('service_minute', 'service_windows', 'service_key_for', 'service_periods_at', 'session_services', 'session_service_one', 'service_labels')), 7, 'the seven assignment functions exist');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('service_minute', 'service_windows', 'service_key_for', 'service_periods_at', 'session_services', 'session_service_one', 'service_labels')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 7, 'each is a definer with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('service_minute', 'service_windows', 'service_key_for', 'service_periods_at', 'session_services', 'session_service_one', 'service_labels')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'and no API role can execute any of them');

select * from finish();
rollback;
