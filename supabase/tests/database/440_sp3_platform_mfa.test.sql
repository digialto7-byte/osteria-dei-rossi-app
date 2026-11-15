-- SP3 step 9 (docs/plans/2026-11-15-sp3-console.md §3.3.5, §3.1.7; flags 3 and 4; Q-P5 as changed): the account-level second factor for platform staff. A staff member
-- with no venue membership can enrol and be challenged: mfa_enrol_check has one new branch for an active platform.staff row, and three platform_mfa_* functions keep the lock
-- and the audit. The lead's required proof is that a non-staff account without a membership is STILL refused with 42501, and that owners and gated admins get exactly the
-- answers pgTAP 342 and 349 pin. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

insert into auth.users (id, email) values
  ('a6000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('a6000000-0000-4000-8000-000000000002', 'platform-support@example.test'),
  ('a6000000-0000-4000-8000-000000000003', 'nobody@example.test'),
  ('a6000000-0000-4000-8000-000000000004', 'owner@example.test'),
  ('a6000000-0000-4000-8000-000000000005', 'inactive-staff@example.test'),
  ('a6000000-0000-4000-8000-000000000006', 'chef@example.test'),
  ('a6000000-0000-4000-8000-000000000007', 'gated-admin@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('b6000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'a6000000-0000-4000-8000-000000000004', 'owner', 'Titolare Demo', 'email'),
  ('b6000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'a6000000-0000-4000-8000-000000000006', 'chef', 'Chef Demo', 'email'),
  ('b6000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'a6000000-0000-4000-8000-000000000007', 'admin', 'Admin Demo', 'email');
insert into platform.staff (auth_id, role) values ('a6000000-0000-4000-8000-000000000001', 'platform_admin');
insert into platform.staff (auth_id, role) values ('a6000000-0000-4000-8000-000000000002', 'platform_support');
insert into platform.staff (auth_id, role, is_active) values ('a6000000-0000-4000-8000-000000000005', 'platform_support', false);

-- A token of an account with no tenant claim (the account-level path) or with one.
create function pg_temp.token(p_auth text, p_aal text, p_tenant text default null, p_role text default null) returns void language sql as $$
  select set_config('request.jwt.claims', (jsonb_build_object('sub', p_auth, 'role', 'authenticated', 'aal', p_aal)
    || case when p_tenant is null then '{}'::jsonb else jsonb_build_object('tenant_id', p_tenant, 'app_role', p_role) end)::text, true) $$;
create function pg_temp.staff(p_aal text) returns void language sql as $$ select pg_temp.token('a6000000-0000-4000-8000-000000000001', p_aal) $$;
create function pg_temp.factors(p_auth uuid, variadic p_rows text[] default '{}') returns void language plpgsql as $$
declare i int;
begin
  delete from auth.mfa_factors where user_id = p_auth;
  for i in 1 .. coalesce(array_length(p_rows, 1), 0) by 3 loop
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
      values (p_rows[i]::uuid, p_auth, p_rows[i + 1], 'totp', p_rows[i + 2]::auth.factor_status, now(), now(), 'fake-secret-value');
  end loop;
end $$;
create function pg_temp.f(n int) returns text language sql immutable as $$ select ('f6000000-0000-4000-8000-' || lpad(n::text, 12, '0')) $$;
-- Outcome of a statement as the authenticated role: 'ok' or "SQLSTATE message".
create function pg_temp.out(stmt text) returns text language plpgsql as $$
declare state text; msg text;
begin
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end $$;
create function pg_temp.j(stmt text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role authenticated;
  execute stmt into r;
  reset role;
  return r;
end $$;

-- 1. The first test -----------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.staff('aal1');
select is(pg_temp.j($$select public.mfa_enrol_check('principale')$$), '{"issuer": "Costì", "friendlyName": "Principale"}'::jsonb,
  'mfa_enrol_check(principale) by an active staff member with no membership returns {issuer: Costì, friendlyName: Principale}');
select is(pg_temp.j($$select public.mfa_enrol_check('riserva')$$), '{"issuer": "Costì", "friendlyName": "Riserva"}'::jsonb, 'and the second slot');
select is(pg_temp.out($$select public.mfa_enrol_check('altro')$$), '22023 invalid_slot', 'a slot other than principale or riserva is 22023, as for a member');
select pg_temp.token('a6000000-0000-4000-8000-000000000002', 'aal1');
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), 'ok', 'a platform_support staff member passes as well');

-- 2. The lead's required proof: everyone else without a membership is still refused ---------------------------------------------------------------------------------
select pg_temp.token('a6000000-0000-4000-8000-000000000003', 'aal1');
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), '42501 insufficient_privilege', 'a non-staff account without a membership is STILL refused with 42501');
select pg_temp.token('a6000000-0000-4000-8000-000000000005', 'aal1');
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), '42501 insufficient_privilege', 'an inactive staff row is refused with 42501');
select pg_temp.token('a6000000-0000-4000-8000-000000000006', 'aal1', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), '42501 insufficient_privilege', 'a chef is refused with 42501');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), '42501 insufficient_privilege', 'a caller with no claims is refused with 42501');
select pg_temp.token('a6000000-0000-4000-8000-000000000004', 'aal1');
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), '42501 insufficient_privilege', 'an owner with no tenant claim (not staff) is refused with 42501, as before');

-- 3. A staff member with a verified factor: aal2 is needed to add another ------------------------------------------------------------------------------------------
select pg_temp.factors('a6000000-0000-4000-8000-000000000001', pg_temp.f(1), 'Principale', 'verified'); select pg_temp.staff('aal1');
select is(pg_temp.out($$select public.mfa_enrol_check('riserva')$$), 'P0001 mfa_required', 'a staff member with a verified factor at aal1 gets mfa_required');
select pg_temp.staff('aal2');
select is(pg_temp.out($$select public.mfa_enrol_check('riserva')$$), 'ok', 'at aal2 the free slot passes');
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), 'P0001 mfa_slot_taken', 'a slot with a verified factor is taken, as for a member');
select pg_temp.factors('a6000000-0000-4000-8000-000000000001', pg_temp.f(1), 'Principale', 'verified', pg_temp.f(2), 'Riserva', 'verified');
select is(pg_temp.out($$select public.mfa_enrol_check('riserva')$$), 'P0001 mfa_factor_limit', 'two verified factors: the limit');
select pg_temp.factors('a6000000-0000-4000-8000-000000000001', pg_temp.f(1), 'Principale', 'unverified'); select pg_temp.staff('aal1');
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), 'ok', 'an unverified factor does not block a new enrolment, and needs no aal2');

-- 4. Owners and gated admins: exactly the answers of 342 and 349 (those files stay green unchanged; the same cases here) ----------------------------------------------
select pg_temp.token('a6000000-0000-4000-8000-000000000004', 'aal1', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.j($$select public.mfa_enrol_check('principale')$$), '{"issuer": "Osteria Demo A", "friendlyName": "Principale"}'::jsonb, 'an owner still gets the tenant name as issuer');
select pg_temp.token('a6000000-0000-4000-8000-000000000007', 'aal1', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.j($$select public.mfa_enrol_check('riserva')$$), '{"issuer": "Osteria Demo A", "friendlyName": "Riserva"}'::jsonb, 'and so does an admin');
select pg_temp.factors('a6000000-0000-4000-8000-000000000007', pg_temp.f(7), 'Principale', 'verified');
select is(pg_temp.out($$select public.mfa_enrol_check('riserva')$$), 'P0001 mfa_required', 'a gated admin with a verified factor at aal1 still gets mfa_required (via the gate)');
select pg_temp.token('a6000000-0000-4000-8000-000000000007', 'aal2', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.out($$select public.mfa_enrol_check('riserva')$$), 'ok', 'at aal2 it passes');
select pg_temp.token('a6000000-0000-4000-8000-000000000007', 'aal2', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), 'P0001 mfa_slot_taken', 'and a taken slot is still taken');

-- 5. The lock: platform_mfa_attempt_allowed and platform_mfa_record_failure ----------------------------------------------------------------------------------------
select pg_temp.staff('aal1');
select is(pg_temp.j($$select public.platform_mfa_attempt_allowed()$$), '{"allowed": true, "retryAfterSeconds": 0}'::jsonb, 'with no tenant claim and no failure, an attempt is allowed');
select is(pg_temp.out($$select public.platform_mfa_record_failure('login')$$), 'ok', 'a wrong code is recorded');
select is((select to_jsonb(f) - 'id' - 'at' from platform.mfa_failure f), '{"auth_id": "a6000000-0000-4000-8000-000000000001", "stage": "login"}'::jsonb, 'the row holds the auth id and the stage (and the time), nothing else');
select is(pg_temp.out($$select public.platform_mfa_record_failure('enrol')$$), 'ok', 'an enrolment failure is recorded as well');
select is(pg_temp.out($$select public.platform_mfa_record_failure('other')$$), '22023 invalid_stage', 'a stage other than login or enrol is 22023');
select is(pg_temp.out($$select public.platform_mfa_record_failure(null)$$), '22023 invalid_stage', 'and so is null');
select is((select count(*)::int from platform.audit_event where action like '%mfa%' or action like '%locked%'), 0, 'a wrong code writes no audit row');
delete from platform.mfa_failure;
insert into platform.mfa_failure (auth_id, stage) select 'a6000000-0000-4000-8000-000000000001', 'login' from generate_series(1, app.mfa_lock_failures() - 1);
select is(pg_temp.j($$select public.platform_mfa_attempt_allowed()$$) ->> 'allowed', 'true', 'one failure short of the limit is still allowed');
select is(pg_temp.out($$select public.platform_mfa_record_failure('login')$$), 'ok', 'the failure that reaches the limit is recorded');
select is(pg_temp.j($$select public.platform_mfa_attempt_allowed()$$) ->> 'allowed', 'false', 'then the next attempt is locked after mfa_lock_failures() failures');
select ok((pg_temp.j($$select public.platform_mfa_attempt_allowed()$$) ->> 'retryAfterSeconds')::int between 1 and app.mfa_lock_minutes() * 60, 'with a retry time inside the lock window');
update platform.mfa_failure set at = now() - make_interval(mins => app.mfa_lock_minutes() + 1);
select is(pg_temp.j($$select public.platform_mfa_attempt_allowed()$$) ->> 'allowed', 'true', 'failures older than the window no longer count');
select pg_temp.token('a6000000-0000-4000-8000-000000000002', 'aal1');
select is(pg_temp.j($$select public.platform_mfa_attempt_allowed()$$) ->> 'allowed', 'true', 'the lock is per account: another staff member is not locked');

-- 6. platform_mfa_record_enrolled: one platform_admin.factor_enrolled row per factor ---------------------------------------------------------------------------------
select pg_temp.factors('a6000000-0000-4000-8000-000000000001', pg_temp.f(1), 'Principale', 'unverified'); select pg_temp.staff('aal2');
select is(pg_temp.out($$select public.platform_mfa_record_enrolled('f6000000-0000-4000-8000-000000000001')$$), 'P0001 mfa_factor_not_verified', 'an unverified factor cannot be recorded as enrolled');
select pg_temp.factors('a6000000-0000-4000-8000-000000000001', pg_temp.f(1), 'Principale', 'verified'); select pg_temp.staff('aal2');
select is(pg_temp.j($$select to_jsonb(public.platform_mfa_record_enrolled('f6000000-0000-4000-8000-000000000001'))$$), 'true'::jsonb, 'a verified factor is recorded: true the first time');
select is(pg_temp.j($$select to_jsonb(public.platform_mfa_record_enrolled('f6000000-0000-4000-8000-000000000001'))$$), 'false'::jsonb, 'false the second time');
select is((select count(*)::int from platform.audit_event where action = 'platform_admin.factor_enrolled'), 1, 'one platform_admin.factor_enrolled row for that factor');
select is((select origin || ' ' || detail::text || ' ' || coalesce(actor_auth_id::text, '-') from platform.audit_event where action = 'platform_admin.factor_enrolled'),
  'console {"slot": "principale", "authId": "a6000000-0000-4000-8000-000000000001", "factorId": "f6000000-0000-4000-8000-000000000001"} a6000000-0000-4000-8000-000000000001', 'with the slot, the ids and the actor, and no address');
select pg_temp.factors('a6000000-0000-4000-8000-000000000001', pg_temp.f(1), 'Principale', 'verified', pg_temp.f(2), 'Riserva', 'verified'); select pg_temp.staff('aal2');
select is(pg_temp.j($$select to_jsonb(public.platform_mfa_record_enrolled('f6000000-0000-4000-8000-000000000002'))$$), 'true'::jsonb, 'a second factor gets its own row');
select is((select count(*)::int from platform.audit_event where action = 'platform_admin.factor_enrolled'), 2, 'two rows for two factors');
select is(pg_temp.out($$select public.platform_mfa_record_enrolled('f6000000-0000-4000-8000-000000000009')$$), 'P0001 mfa_factor_not_verified', 'a factor that does not exist is refused');
select pg_temp.token('a6000000-0000-4000-8000-000000000002', 'aal2');
select is(pg_temp.out($$select public.platform_mfa_record_enrolled('f6000000-0000-4000-8000-000000000001')$$), 'P0001 mfa_factor_not_verified', 'another account''s factor is refused (it is not theirs)');

-- 7. Who may call the three: active staff only ---------------------------------------------------------------------------------------------------------------------
select pg_temp.token('a6000000-0000-4000-8000-000000000004', 'aal2', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.out($$select public.platform_mfa_attempt_allowed()$$), '42501 insufficient_privilege', 'an owner calling platform_mfa_attempt_allowed gets 42501');
select is(pg_temp.out($$select public.platform_mfa_record_failure('login')$$), '42501 insufficient_privilege', 'platform_mfa_record_failure');
select is(pg_temp.out($$select public.platform_mfa_record_enrolled('f6000000-0000-4000-8000-000000000001')$$), '42501 insufficient_privilege', 'and platform_mfa_record_enrolled');
select pg_temp.token('a6000000-0000-4000-8000-000000000005', 'aal2');
select is(pg_temp.out($$select public.platform_mfa_attempt_allowed()$$), '42501 insufficient_privilege', 'an inactive staff row is refused by the three as well');
select pg_temp.token('a6000000-0000-4000-8000-000000000003', 'aal2');
select is(pg_temp.out($$select public.platform_mfa_record_failure('login')$$), '42501 insufficient_privilege', 'and a non-staff account without a membership');

-- 8. The new table and the grants ----------------------------------------------------------------------------------------------------------------------------------
select ok((select c.relrowsecurity from pg_class c where c.oid = 'platform.mfa_failure'::regclass), 'platform.mfa_failure has row level security');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_table_privilege(r, 'platform.mfa_failure', 'select,insert,update,delete,truncate,references,trigger')), 0,
  'and no privilege for an API role');
select is((select count(*)::int from pg_proc p where p.proname in ('platform_mfa_attempt_allowed', 'platform_mfa_record_failure', 'platform_mfa_record_enrolled') and p.pronamespace = 'public'::regnamespace
            and p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole), 3, 'the three functions exist, are definers with search_path = "" and are owned by postgres');
select is((select count(*)::int from pg_proc p where p.proname in ('platform_mfa_attempt_allowed', 'platform_mfa_record_failure', 'platform_mfa_record_enrolled') and p.pronamespace = 'public'::regnamespace
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')
            and not (p.proacl::text ~ '[{,]=X/')), 3, 'executable by authenticated only: not by anon, service_role or PUBLIC');

select * from finish();
rollback;
