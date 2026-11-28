-- SP3 step 12 (docs/plans/2026-11-15-sp3-console.md §3.1.6, §3.3.3, §3.3.4; AT5, AT9): platform notices and platform_me. A notice is added by the notice-add job
-- (service role), lists every tenant as pending, and moves a tenant to notified when the console marks it; the notice table is append-only. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (id, email) values
  ('a9000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('a9000000-0000-4000-8000-000000000003', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into platform.staff (auth_id, role) values ('a9000000-0000-4000-8000-000000000001', 'platform_admin');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values ('f9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'Principale', 'totp', 'verified', now(), now(), 'fake-secret-value');
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a9000000-0000-4000-8000-000000000003', 'owner', 'Titolare A');

create function pg_temp.token(p_auth uuid, p_role text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', p_auth, 'role', p_role, 'aal', p_aal))::text, true)
$$;
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
create temp table kept (k text primary key, v jsonb);
grant all on kept to public;
-- pgTAP lives in schema extensions; inside this rolled-back test only, the API roles may reach it to report.
grant usage on schema extensions to platform_staff;

-- 1. The first test: a new notice lists every tenant as pending ------------------------------------------------------------------------------------------------------------
select pg_temp.token(null, 'service_role', null);
set local role service_role;
insert into kept values ('added', public.platform_add_notice('subprocessor', 1));
reset role;
select pg_temp.token('a9000000-0000-4000-8000-000000000001', 'platform_staff', 'aal2');
set local role platform_staff;
insert into kept values ('list', public.platform_notices());
reset role;
select is((select v -> 0 -> 'pending' from kept where k = 'list'),
  '[{"id": "11111111-1111-4111-8111-111111111111", "name": "Osteria Demo A"}, {"id": "22222222-2222-4222-8222-222222222222", "name": "Osteria Demo B"}]'::jsonb,
  'a notice added with platform_add_notice(''subprocessor'', 1) lists every tenant under pending');
select is((select v -> 0 -> 'notified' from kept where k = 'list'), '[]'::jsonb, 'and none under notified');
select is((select (v -> 0 ->> 'id')::uuid from kept where k = 'list'), (select (v ->> 'noticeId')::uuid from kept where k = 'added'), 'platform_add_notice returned its id');
select is((select array_agg(x order by x) from jsonb_object_keys((select v -> 0 from kept where k = 'list')) x),
  array['createdAt', 'id', 'kind', 'notified', 'pending', 'version'], 'a notice has exactly the Notice keys');
select is((select v -> 0 ->> 'kind' from kept where k = 'list') || ' ' || (select v -> 0 ->> 'version' from kept where k = 'list'), 'subprocessor 1', 'with its kind and version');
select is((select count(*)::int from platform.audit_event where action = 'notice.created' and origin = 'script' and actor_auth_id is null
             and detail = jsonb_build_object('noticeId', (select v ->> 'noticeId' from kept where k = 'added'), 'kind', 'subprocessor', 'version', 1)), 1,
  'platform_add_notice writes one notice.created row (origin script)');

-- 2. Marking -----------------------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.token('a9000000-0000-4000-8000-000000000001', 'platform_staff', 'aal2');
set local role platform_staff;
insert into kept values ('mark1', public.platform_notice_mark((select (v ->> 'noticeId')::uuid from kept where k = 'added'), '11111111-1111-4111-8111-111111111111'));
insert into kept values ('mark2', public.platform_notice_mark((select (v ->> 'noticeId')::uuid from kept where k = 'added'), '11111111-1111-4111-8111-111111111111'));
insert into kept values ('list2', public.platform_notices());
insert into kept values ('me', public.platform_me());
select is(pg_temp.out(format($$select public.platform_notice_mark(%L, '11111111-1111-4111-8111-111111111111')$$, gen_random_uuid())), 'P0002 notice_not_found', 'an unknown notice is P0002 notice_not_found');
select is(pg_temp.out(format($$select public.platform_notice_mark(%L, '44444444-4444-4444-8444-444444444444')$$, (select v ->> 'noticeId' from kept where k = 'added'))),
  'P0002 tenant_not_found', 'an unknown tenant is P0002 tenant_not_found');
reset role;
select is((select v ->> 'changed' from kept where k = 'mark1'), 'true', 'platform_notice_mark moves the tenant to notified: changed true');
select ok((select v ->> 'notifiedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' from kept where k = 'mark1'), 'with notifiedAt as an ISO instant');
select is((select count(*)::int from platform.audit_event where action = 'notice.tenant_notified' and tenant_id = '11111111-1111-4111-8111-111111111111'
             and origin = 'console' and actor_auth_id = 'a9000000-0000-4000-8000-000000000001'
             and detail = jsonb_build_object('noticeId', (select v ->> 'noticeId' from kept where k = 'added'), 'tenantId', '11111111-1111-4111-8111-111111111111')), 1,
  'and writes one notice.tenant_notified row');
select is((select v ->> 'changed' from kept where k = 'mark2'), 'false', 'a second mark: changed false');
select is((select v ->> 'notifiedAt' from kept where k = 'mark2'), (select v ->> 'notifiedAt' from kept where k = 'mark1'), 'with the first notifiedAt');
select is((select count(*)::int from platform.audit_event where action = 'notice.tenant_notified'), 1, 'and no second row');
select is((select v -> 0 -> 'pending' from kept where k = 'list2'), '[{"id": "22222222-2222-4222-8222-222222222222", "name": "Osteria Demo B"}]'::jsonb, 'B is still pending');
select is((select jsonb_agg(e - 'notifiedAt') from kept, jsonb_array_elements(v -> 0 -> 'notified') e where k = 'list2'),
  '[{"id": "11111111-1111-4111-8111-111111111111", "name": "Osteria Demo A"}]'::jsonb, 'A is notified');
select is((select v -> 0 -> 'notified' -> 0 ->> 'notifiedAt' from kept where k = 'list2'), (select v ->> 'notifiedAt' from kept where k = 'mark1'), 'at the instant of the mark');
select is((select v from kept where k = 'me'), '{"displayName": "DigiAlto", "unreadNotices": 1}'::jsonb, 'platform_me returns the display name and the count of notices with a pending tenant');

-- 3. The whitelist (AT5) and no address ----------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(distinct x, ',') from kept, pg_temp.keys(v) x where k in ('list', 'list2', 'mark1', 'me')
            and x not in ('id', 'kind', 'version', 'createdAt', 'pending', 'notified', 'name', 'notifiedAt', 'changed', 'displayName', 'unreadNotices')), null,
  'every key of platform_notices, platform_notice_mark and platform_me is in the whitelist');
select is((select count(*)::int from kept, jsonb_path_query(v, 'strict $.**') s where jsonb_typeof(s) = 'string' and s #>> '{}' like '%@%'), 0, 'no value holds an @');

-- 4. Duplicates, kinds, append-only ----------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.token(null, 'service_role', null);
set local role service_role;
select is(left(pg_temp.out($$select public.platform_add_notice('subprocessor', 1)$$), 5), '23505', 'a duplicate (kind, version) is 23505');
select is(left(pg_temp.out($$select public.platform_add_notice('marketing', 1)$$), 5), '23514', 'an unknown kind is 23514');
select is(left(pg_temp.out($$select public.platform_add_notice('subprocessor', 0)$$), 5), '23514', 'a version below 1 is 23514');
select is(pg_temp.out($$select public.platform_add_notice('subprocessor', 2)$$), 'ok', 'version 2 is a new notice');
select is(left(pg_temp.out($$select * from platform.notice$$), 5), '42501', 'service_role cannot read the notice table itself');
reset role;
select pg_temp.token('a9000000-0000-4000-8000-000000000001', 'platform_staff', 'aal2');
select is((select string_agg((e ->> 'version'), ',' order by o) from jsonb_array_elements(pg_temp.j('select public.platform_notices()')) with ordinality x(e, o)), '2,1',
  'newest first');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.out($$select public.platform_add_notice('subprocessor', 3)$$), '42501 insufficient_privilege',
  'the migration owner without a service-role token is refused (the role is checked first)');
select throws_ok($$ update platform.notice set version = 9 $$, 'P0001', 'platform_notice_append_only', 'the notice table is append-only: UPDATE');
select throws_ok($$ delete from platform.notice $$, 'P0001', 'platform_notice_append_only', 'DELETE');
select throws_ok($$ truncate platform.notice $$, 'P0001', 'platform_notice_append_only', 'TRUNCATE');

-- 5. Refusals: owner, aal1, the other roles --------------------------------------------------------------------------------------------------------------------------------
select pg_temp.token('a9000000-0000-4000-8000-000000000003', 'authenticated', 'aal2');
set local role authenticated;
select is((select string_agg(left(pg_temp.out(q), 5), ',') from unnest(array['select public.platform_notices()', 'select public.platform_me()',
            $$select public.platform_notice_mark(gen_random_uuid(), '11111111-1111-4111-8111-111111111111')$$, $$select public.platform_add_notice('subprocessor', 5)$$]) q),
  '42501,42501,42501,42501', 'an owner token can execute none of the four (42501)');
reset role;
select pg_temp.token('a9000000-0000-4000-8000-000000000001', 'platform_staff', 'aal1');
set local role platform_staff;
select is((select string_agg(pg_temp.out(q), ',') from unnest(array['select public.platform_notices()', 'select public.platform_me()',
            $$select public.platform_notice_mark(gen_random_uuid(), '11111111-1111-4111-8111-111111111111')$$]) q),
  'P0001 mfa_required,P0001 mfa_required,P0001 mfa_required', 'AT3: each console function at aal1 is mfa_required');
select is(left(pg_temp.out($$select public.platform_add_notice('subprocessor', 5)$$), 5), '42501', 'platform_staff cannot add a notice');
reset role;

-- 6. Grants and definitions ----------------------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(n.nspname || '.' || p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app', 'platform') and has_function_privilege('platform_staff', p.oid, 'execute')),
  'public.platform_audit,public.platform_leave_console,public.platform_me,public.platform_notice_mark,public.platform_notices,public.platform_open_tenant,public.platform_tenant,public.platform_tenants'
  /* re-pinned on purpose by SP3 (step 13; was the seven without platform_leave_console) */,
  'platform_staff now executes exactly eight functions (step 13 adds platform_leave_console)');
select is((select count(*)::int from pg_proc p where p.oid in ('public.platform_notices()'::regprocedure, 'public.platform_notice_mark(uuid, uuid)'::regprocedure,
            'public.platform_me()'::regprocedure) and p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole
            and p.prosrc ~ '^\s*(declare[\s\S]*?)?begin\s+perform app\.require_console\(\);'), 3,
  'the three console functions are security definers with search_path = "", owned by postgres, whose first statement is app.require_console()');
select is((select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.platform_add_notice(text, integer)'::regprocedure), true,
  'platform_add_notice is a security definer with search_path = ""');
select is((select string_agg(r || ':' || f, ',' order by r, f) from unnest(array['anon', 'authenticated', 'service_role', 'platform_staff']) r,
             unnest(array['public.platform_notices()', 'public.platform_notice_mark(uuid, uuid)', 'public.platform_me()', 'public.platform_add_notice(text, integer)']) f
            where has_function_privilege(r, f, 'execute')),
  'platform_staff:public.platform_me(),platform_staff:public.platform_notice_mark(uuid, uuid),platform_staff:public.platform_notices(),service_role:public.platform_add_notice(text, integer)',
  'the exact grants (has_function_privilege): the three console functions to platform_staff, platform_add_notice to service_role');
select is((select count(*)::int from pg_proc p where p.oid in ('public.platform_notices()'::regprocedure, 'public.platform_notice_mark(uuid, uuid)'::regprocedure,
            'public.platform_me()'::regprocedure, 'public.platform_add_notice(text, integer)'::regprocedure) and coalesce(p.proacl::text ~ '[{,]=X/', true)), 0,
  'none is executable by PUBLIC');
select is((select string_agg(t.tgname::text, ',' order by t.tgname) from pg_trigger t where t.tgrelid = 'platform.notice'::regclass and not t.tgisinternal),
  'platform_notice_no_truncate,platform_notice_no_update_delete', 'the notice triggers carry the platform_ prefix');

select * from finish();
rollback;
