-- SP3 step 11 (docs/plans/2026-11-15-sp3-console.md §3.3.3, §3.4.2; AT3, AT4, AT5): the console's metadata reads, called as the platform_staff role with a console token.
-- Exactly the keys of the API shapes and nothing else; members without DigiAlto's own admin row; the reads refuse an owner (AT4) and an aal1 console token (AT3).
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

insert into auth.users (id, email) values
  ('a8000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('a8000000-0000-4000-8000-000000000002', 'legacy-admin@example.test'),
  ('a8000000-0000-4000-8000-000000000003', 'owner-a@example.test'),
  ('a8000000-0000-4000-8000-000000000004', 'chef-a@example.test'),
  ('a8000000-0000-4000-8000-000000000005', 'old-chef-a@example.test'),
  ('a8000000-0000-4000-8000-000000000006', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number, timezone) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', 'Europe/Rome'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000000', 'America/New_York'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT11111111115', 'Europe/Rome');
insert into platform.staff (auth_id, role) values ('a8000000-0000-4000-8000-000000000001', 'platform_admin');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values ('f8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'Principale', 'totp', 'verified', now(), now(), 'fake-secret-value');
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a8000000-0000-4000-8000-000000000001', 'admin', 'DigiAlto'),
  ('11111111-1111-4111-8111-111111111111', 'a8000000-0000-4000-8000-000000000002', 'admin', 'Admin storico'),
  ('11111111-1111-4111-8111-111111111111', 'a8000000-0000-4000-8000-000000000003', 'owner', 'Titolare A'),
  ('11111111-1111-4111-8111-111111111111', 'a8000000-0000-4000-8000-000000000004', 'chef', 'Cuoco A'),
  ('22222222-2222-4222-8222-222222222222', 'a8000000-0000-4000-8000-000000000006', 'owner', 'Titolare B');
insert into public.app_user (tenant_id, auth_id, role, display_name, is_active, deactivated_at) values
  ('11111111-1111-4111-8111-111111111111', 'a8000000-0000-4000-8000-000000000005', 'chef', 'Cuoco uscito', false, now()),
  ('22222222-2222-4222-8222-222222222222', 'a8000000-0000-4000-8000-000000000001', 'admin', 'DigiAlto', false, now());
-- Venue activity: A's newest row is 2026-11-21 in Rome (23:30 UTC the day before); B's is 2026-11-20 in New York (03:00 UTC the next day). C has none.
insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_at, created_by)
  select v.t::uuid, 'invoice', gen_random_uuid(), 'invoice.approved', v.at::timestamptz, (select m.id from public.app_user m where m.tenant_id = v.t::uuid and m.role = 'owner')
    from (values ('11111111-1111-4111-8111-111111111111', '2026-11-20 23:30:00+00'), ('11111111-1111-4111-8111-111111111111', '2026-11-01 10:00:00+00'),
                 ('22222222-2222-4222-8222-222222222222', '2026-11-21 03:00:00+00')) v(t, at);
insert into public.reservation_settings (tenant_id, public_slug) values ('11111111-1111-4111-8111-111111111111', 'osteria-demo-a');
-- Platform audit: 12 rows for A, 50 platform-wide rows, one for a tenant id that no longer exists.
insert into platform.audit_event (origin, action, tenant_id, detail)
  select 'script', 'script.set_mfa_enforcement', '11111111-1111-4111-8111-111111111111', jsonb_build_object('mode', 'required', 'version', g) from generate_series(1, 12) g;
insert into platform.audit_event (origin, action, detail) select 'console', 'console.entered', '{}' from generate_series(1, 50);
insert into platform.audit_event (origin, action, tenant_id, detail) values ('script', 'script.create_tenant', '99999999-9999-4999-8999-999999999999', '{"outcome": "ok"}');

create function pg_temp.token(p_auth uuid, p_role text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_auth, 'role', p_role, 'aal', p_aal)::text, true)
$$;
-- Today in Rome (the audit's days are Europe/Rome days).
create function pg_temp.today() returns date language sql stable as $$ select (now() at time zone 'Europe/Rome')::date $$;
create function pg_temp.out(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
create function pg_temp.j(p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute p_sql into r;
  return r;
end $$;
-- Every key of a JSON value, at any depth.
create function pg_temp.keys(p jsonb) returns setof text language sql immutable as $$
  with recursive walk(v) as (
    select p
    union all
    select c.v from walk w, lateral (
      select e.value as v from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}' end) e
      union all
      select a.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]' end) a) c)
  select e.key from walk w, jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}' end) e
$$;
-- Every string value of a JSON value, at any depth.
create function pg_temp.strings(p jsonb) returns setof text language sql immutable as $$
  select x #>> '{}' from jsonb_path_query(p, 'strict $.**') x where jsonb_typeof(x) = 'string'
$$;
create temp table allowed_key (k text primary key);
insert into allowed_key select unnest(array[
  'id', 'name', 'organisation', 'tenantCount', 'createdAt', 'members', 'owner', 'admin', 'chef', 'waiter', 'digialtoAttached', 'lastActivityDate',
  'timeZone', 'bookingSlug', 'tenant', 'activity', 'at', 'tenantId', 'tenantName', 'action', 'origin', 'detail', 'rows', 'nextBefore', 'attached']);
insert into allowed_key select unnest(platform.audit_detail_keys()) on conflict do nothing;
create temp table answer (fn text primary key, body jsonb);
grant all on allowed_key, answer to public;
-- pgTAP lives in schema extensions; inside this rolled-back test only, the role may reach it to report.
grant usage on schema extensions to platform_staff;

-- 1. The console admin's reads, as platform_staff ------------------------------------------------------------------------------------------------------------------------
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'platform_staff', 'aal2');
set local role platform_staff;
insert into answer values
  ('tenants', public.platform_tenants()),
  ('tenant', public.platform_tenant('11111111-1111-4111-8111-111111111111')),
  ('audit', public.platform_audit((now() at time zone 'Europe/Rome')::date, (now() at time zone 'Europe/Rome')::date, null, null, null)),
  ('open', public.platform_open_tenant('11111111-1111-4111-8111-111111111111')),
  ('open_c', public.platform_open_tenant('33333333-3333-4333-8333-333333333333'));
reset role;

select is((select array_agg(k order by k) from (select distinct pg_temp.keys(e) k from jsonb_array_elements((select body from answer where fn = 'tenants')) e) x),
  array['admin', 'chef', 'createdAt', 'digialtoAttached', 'id', 'lastActivityDate', 'members', 'name', 'organisation', 'owner', 'tenantCount', 'waiter'],
  'platform_tenants() as the console-mode platform admin returns one object per tenant with exactly the TenantSummary keys, recursively');
select is((select jsonb_array_length(body) from answer where fn = 'tenants'), 3, 'one object per tenant');
select is((select string_agg(e ->> 'name', ',' order by o) from answer, jsonb_array_elements(body) with ordinality x(e, o) where fn = 'tenants'),
  'Osteria Demo A,Osteria Demo B,Osteria Demo C', 'ordered by lastActivityDate, newest first, a tenant with no activity last');
select is((select string_agg(k, ',' order by k) from answer, pg_temp.keys(body) k where fn <> 'open_c' and not exists (select 1 from allowed_key a where a.k = k)), null,
  'AT5: every key returned by platform_tenants, platform_tenant, platform_audit and platform_open_tenant is in the whitelist');
select is((select string_agg(distinct k, ',') from answer, pg_temp.keys(body) k
            where k ~* 'cost|price|amount|total|margin|vat|iban|email|mail|phone|address|first|last|display|person|staff|guest|contact|invoice|order|recipe|reservation|supplier|ingredient|stock|batch|note'
              and k <> 'lastActivityDate'), null,
  'no key names a cost, price, VAT number, address, person, invoice, order, recipe or reservation (lastActivityDate is the one key with "last", a day)');
select is((select count(*)::int from answer, pg_temp.strings(body) s where s like '%@%'), 0, 'no string value anywhere holds an @');
select is((select count(*)::int from answer, pg_temp.strings(body) s where s in ('IT00000000000', 'IT11111111115', 'Titolare A', 'Cuoco A', 'Admin storico', 'DigiAlto', 'osteria')), 0,
  'no VAT number, member name or DigiAlto label appears as a value');

create temp view tenant_row as select e from answer, jsonb_array_elements(body) e where fn = 'tenants';
select is((select e -> 'members' from tenant_row where e ->> 'id' = '11111111-1111-4111-8111-111111111111'), '{"owner": 1, "admin": 1, "chef": 1, "waiter": 0}'::jsonb,
  'members of A exclude the platform admin''s own admin row and the inactive chef, and count the second (legacy) admin row');
select is((select e ->> 'digialtoAttached' from tenant_row where e ->> 'id' = '11111111-1111-4111-8111-111111111111'), 'true', 'digialtoAttached for A (an active admin row)');
select is((select e ->> 'digialtoAttached' from tenant_row where e ->> 'id' = '22222222-2222-4222-8222-222222222222'), 'false', 'not for B (its admin row is inactive)');
select is((select e -> 'members' from tenant_row where e ->> 'id' = '22222222-2222-4222-8222-222222222222'), '{"owner": 1, "admin": 0, "chef": 0, "waiter": 0}'::jsonb, 'B counts its owner only');
select is((select e ->> 'lastActivityDate' from tenant_row where e ->> 'id' = '11111111-1111-4111-8111-111111111111'), '2026-11-21', 'lastActivityDate of A is its newest row''s day in Rome');
select is((select e ->> 'lastActivityDate' from tenant_row where e ->> 'id' = '22222222-2222-4222-8222-222222222222'), '2026-11-20', 'and of B its day in New York (the tenant''s zone)');
select is((select e -> 'lastActivityDate' from tenant_row where e ->> 'id' = '33333333-3333-4333-8333-333333333333'), 'null'::jsonb, 'null for C, with no activity');
select is((select string_agg((e -> 'organisation' ->> 'tenantCount'), ',' order by e ->> 'name') from tenant_row), '2,2,1', 'tenantCount is 2 for two tenants with one VAT number, 1 for C');
select is((select count(distinct e -> 'organisation' ->> 'id')::int from tenant_row where e ->> 'name' in ('Osteria Demo A', 'Osteria Demo B')), 1, 'and A and B share their organisation');
select ok((select bool_and(e ->> 'createdAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') from tenant_row), 'createdAt is an ISO instant in UTC with Z');

-- 2. platform_tenant ---------------------------------------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k) from jsonb_object_keys((select body -> 'tenant' from answer where fn = 'tenant')) k),
  array['bookingSlug', 'createdAt', 'digialtoAttached', 'id', 'lastActivityDate', 'members', 'name', 'organisation', 'timeZone'], 'platform_tenant returns the TenantDetail keys');
select is((select body -> 'tenant' ->> 'timeZone' from answer where fn = 'tenant'), 'Europe/Rome', 'with the time zone');
select is((select body -> 'tenant' ->> 'bookingSlug' from answer where fn = 'tenant'), 'osteria-demo-a', 'and the booking page slug');
select is((select jsonb_array_length(body -> 'activity') from answer where fn = 'tenant'), 10, 'activity holds at most 10 rows');
select is((select array_agg(k order by k) from jsonb_object_keys((select body -> 'activity' -> 0 from answer where fn = 'tenant')) k),
  array['action', 'at', 'detail', 'id', 'origin', 'tenantId', 'tenantName'], 'each with the AuditRow shape');
select is((select (body -> 'activity' -> 0 -> 'detail' ->> 'version')::int from answer where fn = 'tenant'), 12, 'newest first');
select is((select body -> 'activity' -> 0 ->> 'tenantName' from answer where fn = 'tenant'), 'Osteria Demo A', 'with the tenant''s name');
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'platform_staff', 'aal2');
set local role platform_staff;
select is(pg_temp.out($$select public.platform_tenant('44444444-4444-4444-8444-444444444444')$$), 'P0002 tenant_not_found', 'an unknown id is P0002 tenant_not_found');
select is(pg_temp.j($$select public.platform_tenant('33333333-3333-4333-8333-333333333333')$$) -> 'tenant' -> 'bookingSlug', 'null'::jsonb, 'a tenant without a booking page: bookingSlug null');
select is(pg_temp.j($$select public.platform_tenant('33333333-3333-4333-8333-333333333333')$$) -> 'activity', '[]'::jsonb, 'and no platform activity: an empty list');

-- 3. platform_audit ----------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.out($$select public.platform_audit(null, pg_temp.today(), null, null, null)$$), '22023 audit_range_required', 'platform_audit requires the first day');
select is(pg_temp.out($$select public.platform_audit(pg_temp.today(), null, null, null, null)$$), '22023 audit_range_required', 'and the last');
select is(pg_temp.out($$select public.platform_audit(pg_temp.today(), pg_temp.today() - 1, null, null, null)$$), '22023 audit_range_invalid', 'refuses a last day before the first');
select is(pg_temp.out($$select public.platform_audit(pg_temp.today() - 367, pg_temp.today(), null, null, null)$$), '22023 audit_range_invalid', 'and more than 366 days');
select is(pg_temp.out($$select public.platform_audit(pg_temp.today() - 366, pg_temp.today(), null, null, null)$$), 'ok', '366 days are allowed');
select is(pg_temp.out($$select public.platform_audit(pg_temp.today(), pg_temp.today(), null, 'invoice.approved', null)$$), '22023 audit_action_unknown', 'an unknown action is 22023');
reset role;
select is((select jsonb_array_length(body -> 'rows') from answer where fn = 'audit'), 50, 'a page holds exactly 50 rows');
select is((select (body ->> 'nextBefore')::bigint from answer where fn = 'audit'), (select (body -> 'rows' -> 49 ->> 'id')::bigint from answer where fn = 'audit'),
  'nextBefore is the id of the last row of a full page');
select ok((select bool_and((a.e ->> 'id')::bigint > (b.e ->> 'id')::bigint) from answer,
             jsonb_array_elements(body -> 'rows') with ordinality a(e, i), jsonb_array_elements(body -> 'rows') with ordinality b(e, j) where fn = 'audit' and j = i + 1),
  'newest first');
set local role platform_staff;
select is(jsonb_array_length(pg_temp.j(format($$select public.platform_audit(pg_temp.today(), pg_temp.today(), null, null, %s)$$,
            (select body ->> 'nextBefore' from answer where fn = 'audit'))) -> 'rows'), 13 /* 12 + 51 + 1 rows written before the reads, 50 on page one */,
  'the next page, by p_before, holds the rest');
select is(pg_temp.j(format($$select public.platform_audit(pg_temp.today(), pg_temp.today(), null, null, %s)$$, (select body ->> 'nextBefore' from answer where fn = 'audit'))) -> 'nextBefore',
  'null'::jsonb, 'and ends the paging with nextBefore null');
select is(jsonb_array_length(pg_temp.j($$select public.platform_audit(pg_temp.today(), pg_temp.today(), '11111111-1111-4111-8111-111111111111', null, null)$$) -> 'rows'), 13,
  'a tenant filter: its 12 rows and the console.tenant_opened row');
select is(jsonb_array_length(pg_temp.j($$select public.platform_audit(pg_temp.today(), pg_temp.today(), null, 'console.tenant_opened', null)$$) -> 'rows'), 1, 'an action filter');
select is(jsonb_array_length(pg_temp.j($$select public.platform_audit(pg_temp.today() - 30, pg_temp.today() - 1, null, null, null)$$) -> 'rows'), 0, 'days before today hold nothing here');
select is(pg_temp.j($$select public.platform_audit(pg_temp.today(), pg_temp.today(), null, 'script.create_tenant', null)$$) -> 'rows' -> 0 -> 'tenantName', 'null'::jsonb,
  'tenantName is null for a tenant that no longer exists');
select is(pg_temp.j($$select public.platform_audit(pg_temp.today(), pg_temp.today(), null, 'console.entered', null)$$) -> 'rows' -> 0 -> 'tenantName', 'null'::jsonb, 'and for a platform-wide row');
reset role;

-- 4. platform_open_tenant ----------------------------------------------------------------------------------------------------------------------------------------------------
select is((select body from answer where fn = 'open'), '{"tenantId": "11111111-1111-4111-8111-111111111111", "attached": true}'::jsonb, 'platform_open_tenant of A: attached');
select is((select count(*)::int from platform.audit_event where action = 'console.tenant_opened' and tenant_id = '11111111-1111-4111-8111-111111111111'
             and origin = 'console' and actor_auth_id = 'a8000000-0000-4000-8000-000000000001' and detail = '{"tenantId": "11111111-1111-4111-8111-111111111111"}'), 1,
  'it writes one console.tenant_opened row');
select is((select body from answer where fn = 'open_c'), '{"tenantId": "33333333-3333-4333-8333-333333333333", "attached": false}'::jsonb, 'of C: not attached');
select is((select count(*)::int from platform.audit_event where action = 'console.tenant_opened' and tenant_id = '33333333-3333-4333-8333-333333333333'), 0,
  'and then nothing is written (the console does not open it)');

-- 5. AT4 and AT3: refused for an owner and at aal1 -----------------------------------------------------------------------------------------------------------------------
select pg_temp.token('a8000000-0000-4000-8000-000000000003', 'authenticated', 'aal2');
set local role authenticated;
select is((select string_agg(left(pg_temp.out(q), 5), ',') from unnest(array['select public.platform_tenants()', $$select public.platform_tenant('11111111-1111-4111-8111-111111111111')$$,
            'select public.platform_audit(pg_temp.today(), pg_temp.today(), null, null, null)', $$select public.platform_open_tenant('11111111-1111-4111-8111-111111111111')$$]) q),
  '42501,42501,42501,42501', 'AT4: an owner token cannot execute any of the four (42501)');
reset role;
select pg_temp.token('a8000000-0000-4000-8000-000000000003', 'platform_staff', 'aal2');
set local role platform_staff;
select is(pg_temp.out('select public.platform_tenants()'), '42501 console_required', 'nor with a forged platform_staff role claim');
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'platform_staff', 'aal1');
select is((select string_agg(pg_temp.out(q), ',') from unnest(array['select public.platform_tenants()', $$select public.platform_tenant('11111111-1111-4111-8111-111111111111')$$,
            'select public.platform_audit(pg_temp.today(), pg_temp.today(), null, null, null)', $$select public.platform_open_tenant('11111111-1111-4111-8111-111111111111')$$]) q),
  'P0001 mfa_required,P0001 mfa_required,P0001 mfa_required,P0001 mfa_required', 'AT3: each at aal1 is mfa_required');
reset role;

-- 6. Grants and definitions ----------------------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(n.nspname || '.' || p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app', 'platform') and has_function_privilege('platform_staff', p.oid, 'execute')),
  'public.platform_audit,public.platform_open_tenant,public.platform_tenant,public.platform_tenants', 'platform_staff now executes exactly these four');
select is((select count(*)::int from pg_proc p where p.oid in ('public.platform_tenants()'::regprocedure, 'public.platform_tenant(uuid)'::regprocedure,
            'public.platform_audit(date, date, uuid, text, bigint)'::regprocedure, 'public.platform_open_tenant(uuid)'::regprocedure)
            and p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole and p.prosrc ~ '^\s*(declare[\s\S]*?)?begin\s+perform app\.require_console\(\);'), 4,
  'each is a security definer with search_path = "", owned by postgres, whose first statement is app.require_console()');
select is((select count(*)::int from unnest(array['public', 'anon', 'authenticated', 'service_role']) r,
             unnest(array['public.platform_tenants()', 'public.platform_tenant(uuid)', 'public.platform_audit(date, date, uuid, text, bigint)', 'public.platform_open_tenant(uuid)']) f
            where case when r = 'public' then (select coalesce(p.proacl::text ~ '[{,]=X/', true) from pg_proc p where p.oid = f::regprocedure)
                       else has_function_privilege(r, f, 'execute') end), 0,
  'none is executable by PUBLIC, anon, authenticated or service_role (has_function_privilege)');
select is((select count(*)::int from pg_proc p where p.oid in ('platform.tenant_json(uuid)'::regprocedure, 'platform.audit_row_json(bigint)'::regprocedure)
            and not p.prosecdef and p.proconfig = array['search_path=""']), 2, 'the two platform helpers are invoker functions with search_path = "" (closed by 436''s platform checks)');

select * from finish();
rollback;
