-- SP3 step 15 (docs/plans/2026-11-15-sp3-console.md §3.3.5, FD31; lead decision 2026-11-28, option A): my_memberships() needs aal2 from the active platform admin,
-- and only from it. Every other caller, a legacy admin row included, lists as SP2's function does (pgTAP 432 unchanged): venue routes gate admin at aal2 through the
-- MFA gate already, and the list holds no sensitive data. Same signature, grants, definer and search_path as SP2's. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('ab000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('ab000000-0000-4000-8000-000000000003', 'old-admin@example.test'),
  ('ab000000-0000-4000-8000-000000000004', 'owner-ab@example.test'),
  ('ab000000-0000-4000-8000-000000000005', 'legacy-admin@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into platform.staff (auth_id, role) values ('ab000000-0000-4000-8000-000000000001', 'platform_admin');
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'ab000000-0000-4000-8000-000000000001', 'admin', 'DigiAlto'),
  ('22222222-2222-4222-8222-222222222222', 'ab000000-0000-4000-8000-000000000001', 'admin', 'DigiAlto'),
  ('11111111-1111-4111-8111-111111111111', 'ab000000-0000-4000-8000-000000000004', 'owner', 'Titolare A'),
  ('22222222-2222-4222-8222-222222222222', 'ab000000-0000-4000-8000-000000000004', 'owner', 'Titolare B'),
  ('11111111-1111-4111-8111-111111111111', 'ab000000-0000-4000-8000-000000000005', 'admin', 'Admin storico'),
  ('22222222-2222-4222-8222-222222222222', 'ab000000-0000-4000-8000-000000000005', 'owner', 'Titolare B2');

create function pg_temp.act(p_user uuid, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal,
    'session_id', 'cb000000-0000-4000-8000-000000000001'))::text, true)
$$;
create function pg_temp.out(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function pg_temp.act(uuid, text), pg_temp.out(text) to authenticated;

set local role authenticated;
-- 1. The first test of step 15 ---------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.act('ab000000-0000-4000-8000-000000000001', 'aal1');
select is(pg_temp.out($$select public.my_memberships()$$), 'P0001 mfa_required', 'my_memberships() by the platform admin at aal1 raises mfa_required');
select pg_temp.act('ab000000-0000-4000-8000-000000000001', null);
select is(pg_temp.out($$select public.my_memberships()$$), 'P0001 mfa_required', 'and so without an aal claim (counts as aal1)');
select pg_temp.act('ab000000-0000-4000-8000-000000000001', 'aal2');
select is(public.my_memberships(), '[{"tenantId": "11111111-1111-4111-8111-111111111111", "name": "Osteria Demo A", "role": "admin"},
  {"tenantId": "22222222-2222-4222-8222-222222222222", "name": "Osteria Demo B", "role": "admin"}]'::jsonb, 'at aal2 it lists both venues, as SP2''s');

-- 2. Every other caller is unchanged (option A) ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.act('ab000000-0000-4000-8000-000000000004', 'aal1');
select is(jsonb_array_length(public.my_memberships()), 2, 'an owner at aal1 still lists');
select pg_temp.act('ab000000-0000-4000-8000-000000000005', 'aal1');
select is(public.my_memberships(), '[{"tenantId": "11111111-1111-4111-8111-111111111111", "name": "Osteria Demo A", "role": "admin"},
  {"tenantId": "22222222-2222-4222-8222-222222222222", "name": "Osteria Demo B", "role": "owner"}]'::jsonb,
  'a holder of a legacy admin row who is not the platform admin still lists at aal1 (the lead''s option A)');
reset role;
update platform.staff set is_active = false where auth_id = 'ab000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('ab000000-0000-4000-8000-000000000001', 'aal1');
select is(jsonb_array_length(public.my_memberships()), 2, 'once the platform admin row is inactive, that login lists at aal1 like any admin');
reset role;
update platform.staff set is_active = true where auth_id = 'ab000000-0000-4000-8000-000000000001';

-- 3. Shape and grants ---------------------------------------------------------------------------------------------------------------------------------------------------
select is((select p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole and p.provolatile = 's' from pg_proc p
            where p.oid = 'public.my_memberships()'::regprocedure), true, 'my_memberships() is a stable definer with search_path = "", owned by postgres');
select is(pg_get_function_result('public.my_memberships()'::regprocedure), 'jsonb', 'it still returns jsonb');
select is((select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated', 'service_role', 'platform_staff']) r
            where has_function_privilege(r, 'public.my_memberships()', 'execute')), 'authenticated', 'executable by authenticated only');
select is((select count(*)::int from pg_proc p where p.oid = 'public.my_memberships()'::regprocedure and p.proacl::text ~ '[{,]=X/'), 0, 'not by PUBLIC');
select is((select count(*)::int from pg_proc where proname = 'my_memberships'), 1, 'one definition');
select is((select count(*)::int from pg_proc where oid = 'public.my_memberships()'::regprocedure and prosrc ~* 'membership_ungated'), 0,
  'it does not read app.membership_ungated (341''s exempt_session stays exactly two)');

select * from finish();
rollback;
