-- P2-1 A3 (docs/plans/2026-11-12-p2-1-totp.md section 3.3, 5 A3; founder decision Q-T2 = V2 of 2026-11-12): the self-service MFA procedures,
-- the wrong-code table and its lock, and the six new audit actions. Wrong codes live in app.mfa_failure, not in audit_event.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'nobody@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo', 'email'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo', 'email'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo', 'email');

create function pg_temp.claims(p_auth uuid, p_tenant uuid, p_role text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role, 'aal', p_aal)::text, true) $$;
create function pg_temp.owner(p_aal text) returns void language sql as $$ select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', p_aal) $$;
create function pg_temp.admin(p_aal text) returns void language sql as $$ select pg_temp.claims('ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'admin', p_aal) $$;
create function pg_temp.chef() returns void language sql as $$ select pg_temp.claims('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', 'aal1') $$;
create function pg_temp.mode(p text) returns void language sql as $$ update public.tenant set mfa_enforcement = p where id = '11111111-1111-4111-8111-111111111111' $$;
-- Replaces a user's factors by the given ones: (id, name, status).
create function pg_temp.factors(p_auth uuid, variadic p_rows text[] default '{}') returns void language plpgsql as $$
declare i int;
begin
  delete from auth.mfa_factors where user_id = p_auth;
  for i in 1 .. coalesce(array_length(p_rows, 1), 0) by 3 loop
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
      values (p_rows[i]::uuid, p_auth, p_rows[i + 1], 'totp', p_rows[i + 2]::auth.factor_status, now(), now(), 'fake-secret-value');
  end loop;
end $$;
create function pg_temp.f(n int) returns text language sql immutable as $$ select ('f0000000-0000-4000-8000-' || lpad(n::text, 12, '0')) $$;
-- Outcome of a statement: 'ok' or "SQLSTATE message" of the error, as the authenticated role.
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
create function pg_temp.starts(a text, b text, d text) returns text language sql as $$ select is(left(a, length(b)), b, d) $$;
create function pg_temp.j(stmt text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role authenticated;
  execute stmt into r;
  reset role;
  return r;
end $$;

-- 1. The audit check: every earlier action stays, exactly six are added, and the wrong-code attempt is not an audit action (V2).
select is((select count(*)::int from regexp_matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'audit_event_action_check'), '''[a-z_]+\.[a-z_]+''', 'g')), 42, 'the audit action check lists 35 earlier plus 7 new actions');
select ok((select bool_and(pg_get_constraintdef(c.oid) like '%''' || a || '''%') from pg_constraint c, unnest(array['app_user.mfa_enrolled', 'app_user.mfa_unenrolled', 'app_user.mfa_reset', 'app_user.mfa_reset_failed', 'app_user.pin_set_failed', 'tenant.mfa_enforcement_changed', 'app_user.mfa_locked']) a
            where c.conname = 'audit_event_action_check'), 'the seven new audit actions are in the check');
select ok((select pg_get_constraintdef(oid) not like '%mfa_challenge_failed%' and pg_get_constraintdef(oid) like '%reservation_settings.changed%' and pg_get_constraintdef(oid) like '%invoice.approved%' from pg_constraint where conname = 'audit_event_action_check'),
          'no mfa_challenge_failed action, and the earliest and latest earlier actions are kept');

-- 2. mfa_gate: ok, challenge or enrol, from the same rule as the gate itself.
select pg_temp.mode('required'); select pg_temp.factors('ad000000-0000-4000-8000-0000000000ad'); select pg_temp.admin('aal1');
select is(pg_temp.j('select to_jsonb(public.mfa_gate())') #>> '{}', 'enrol', 'admin, required, no factor, aal1: enrol');
select pg_temp.mode('enrolled');
select is(pg_temp.j('select to_jsonb(public.mfa_gate())') #>> '{}', 'ok', 'admin, enrolled, no factor: ok');
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'verified'); select pg_temp.owner('aal1');
select is(pg_temp.j('select to_jsonb(public.mfa_gate())') #>> '{}', 'challenge', 'owner with a verified factor at aal1: challenge');
select pg_temp.owner('aal2');
select is(pg_temp.j('select to_jsonb(public.mfa_gate())') #>> '{}', 'ok', 'the same owner at aal2: ok');
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a'); select pg_temp.owner('aal1');
select is(pg_temp.j('select to_jsonb(public.mfa_gate())') #>> '{}', 'ok', 'owner without a factor: ok');
select pg_temp.chef();
select is(pg_temp.j('select to_jsonb(public.mfa_gate())') #>> '{}', 'ok', 'chef: ok');
select pg_temp.claims('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'owner', 'aal1');
select is(pg_temp.j('select to_jsonb(public.mfa_gate())') #>> '{}', 'ok', 'a caller with no membership: ok');

-- 3. mfa_status.
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'verified'); select pg_temp.owner('aal1');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.j('select public.mfa_status()')) k), array['gate', 'hasVerifiedFactor', 'issuer', 'mode', 'role'], 'mfa_status has exactly five keys');
select is(pg_temp.j('select public.mfa_status()') ->> 'issuer', 'Osteria Demo A', 'the issuer is the tenant name');
select is(pg_temp.j('select public.mfa_status()'), '{"role": "owner", "mode": "enrolled", "hasVerifiedFactor": true, "gate": "challenge", "issuer": "Osteria Demo A"}'::jsonb, 'mfa_status answers at aal1 while the account is gated');
select pg_temp.chef();
select pg_temp.starts(pg_temp.out('select public.mfa_status()'), '42501', 'mfa_status: chef is refused');

-- 4. The wrong-code table and the lock (T-9).
select ok((select relrowsecurity from pg_class where oid = 'app.mfa_failure'::regclass), 'mfa_failure has RLS on');
select ok(not has_table_privilege('authenticated', 'app.mfa_failure', 'SELECT') and not has_table_privilege('authenticated', 'app.mfa_failure', 'INSERT')
          and not has_table_privilege('authenticated', 'app.mfa_failure', 'DELETE') and not has_table_privilege('anon', 'app.mfa_failure', 'SELECT')
          and not has_table_privilege('service_role', 'app.mfa_failure', 'SELECT') and not has_table_privilege('service_role', 'app.mfa_failure', 'INSERT')
          and not has_table_privilege('service_role', 'app.mfa_failure', 'DELETE'), 'no API role has a privilege on mfa_failure');
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a'); select pg_temp.owner('aal1');
select is(pg_temp.j('select public.mfa_attempt_allowed()'), '{"allowed": true, "retryAfterSeconds": 0}'::jsonb, 'no failure: allowed');
select pg_temp.out($$select public.mfa_record_failure('login')$$) is null; select pg_temp.out($$select public.mfa_record_failure('login')$$) is null;
select pg_temp.out($$select public.mfa_record_failure('enrol')$$) is null; select pg_temp.out($$select public.mfa_record_failure('login')$$) is null;
select is(pg_temp.j('select public.mfa_attempt_allowed()') ->> 'allowed', 'true', 'four failures: still allowed');
select is(pg_temp.out($$select public.mfa_record_failure('login')$$), 'ok', 'the fifth failure is recorded');
select is(pg_temp.j('select public.mfa_attempt_allowed()'), '{"allowed": false, "retryAfterSeconds": 900}'::jsonb, 'five failures: locked for 900 seconds');
update app.mfa_failure set at = now() - interval '300 seconds' where id = (select id from app.mfa_failure order by id limit 1);
select is(pg_temp.j('select public.mfa_attempt_allowed()') ->> 'retryAfterSeconds', '600', 'retryAfterSeconds is 900 minus the age of the oldest failure');
update app.mfa_failure set at = now() - interval '16 minutes';
select is(pg_temp.j('select public.mfa_attempt_allowed()') ->> 'allowed', 'true', 'after 15 minutes the failures no longer count');
delete from app.mfa_failure;
-- Another user's failures and tenant B's do not count.
insert into app.mfa_failure (tenant_id, app_user_id, stage) select '11111111-1111-4111-8111-111111111111', 'ad100000-0000-4000-8000-0000000000ad', 'login' from generate_series(1, 6);
insert into app.mfa_failure (tenant_id, app_user_id, stage) select '22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', 'login' from generate_series(1, 6);
select is(pg_temp.j('select public.mfa_attempt_allowed()') ->> 'allowed', 'true', 'failures of another account and of another tenant do not count');
delete from app.mfa_failure;
select pg_temp.starts(pg_temp.out($$select public.mfa_record_failure('x')$$), '22023', 'a stage other than login or enrol is 22023');
select pg_temp.out($$select public.mfa_record_failure('enrol')$$) is null;
select is((select count(*)::int from app.mfa_failure), 1, 'one wrong code writes one row');
select is((select to_jsonb(f) - 'id' - 'at' from app.mfa_failure f), '{"tenant_id": "11111111-1111-4111-8111-111111111111", "app_user_id": "a1000000-0000-4000-8000-00000000000a", "stage": "enrol"}'::jsonb, 'the row has the tenant, the caller and the stage (and the time), nothing else');
select is((select count(*)::int from public.audit_event where action like '%mfa%' and action <> 'app_user.mfa_locked'), 0, 'a wrong code writes no audit row (the lock row of the fifth is tested in 348)');
select pg_temp.chef();
select pg_temp.starts(pg_temp.out($$select public.mfa_record_failure('login')$$), '42501', 'mfa_record_failure: chef is refused');
select pg_temp.starts(pg_temp.out($$select public.mfa_attempt_allowed()$$), '42501', 'mfa_attempt_allowed: chef is refused');
delete from app.mfa_failure;

-- 5. mfa_enrol_check.
select pg_temp.mode('enrolled'); select pg_temp.factors('a0000000-0000-4000-8000-00000000000a'); select pg_temp.owner('aal1');
select is(pg_temp.j($$select public.mfa_enrol_check('principale')$$), '{"issuer": "Osteria Demo A", "friendlyName": "Principale"}'::jsonb, 'no factor at aal1: the first slot is offered');
select is(pg_temp.j($$select public.mfa_enrol_check('riserva')$$) ->> 'friendlyName', 'Riserva', 'the second slot name');
select pg_temp.starts(pg_temp.out($$select public.mfa_enrol_check('altro')$$), '22023', 'a slot other than principale or riserva is 22023');
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'unverified');
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), 'ok', 'an unverified factor does not block a new enrolment');
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'verified'); select pg_temp.owner('aal1');
select is(pg_temp.out($$select public.mfa_enrol_check('riserva')$$), 'P0001 mfa_required', 'with a verified factor, enrolling needs aal2');
select pg_temp.owner('aal2');
select is(pg_temp.out($$select public.mfa_enrol_check('principale')$$), 'P0001 mfa_slot_taken', 'a slot with a verified factor is taken');
select is(pg_temp.out($$select public.mfa_enrol_check('riserva')$$), 'ok', 'the free slot passes at aal2');
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'verified', pg_temp.f(2), 'Riserva', 'verified');
select is(pg_temp.out($$select public.mfa_enrol_check('riserva')$$), 'P0001 mfa_factor_limit', 'two verified factors: the limit');
select pg_temp.chef();
select pg_temp.starts(pg_temp.out($$select public.mfa_enrol_check('principale')$$), '42501', 'mfa_enrol_check: chef is refused');

-- 6. mfa_record_enrolled.
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'unverified'); select pg_temp.owner('aal2');
select is(pg_temp.out($$select public.mfa_record_enrolled('f0000000-0000-4000-8000-000000000001')$$), 'P0001 mfa_factor_not_verified', 'an unverified factor is not recorded');
select pg_temp.factors('b0000000-0000-4000-8000-00000000000b', pg_temp.f(9), 'Principale', 'verified');
select is(pg_temp.out($$select public.mfa_record_enrolled('f0000000-0000-4000-8000-000000000009')$$), 'P0001 mfa_factor_not_verified', 'another user''s factor is not recorded');
select is(pg_temp.out($$select public.mfa_record_enrolled(gen_random_uuid())$$), 'P0001 mfa_factor_not_verified', 'an unknown factor is not recorded');
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'verified');
select is(pg_temp.j('select to_jsonb(public.mfa_record_enrolled(''f0000000-0000-4000-8000-000000000001''))') #>> '{}', 'true', 'a verified factor is recorded');
select is((select jsonb_build_object('type', entity_type, 'id', entity_id, 'action', action, 'tenant', tenant_id, 'by', created_by, 'after', after) from public.audit_event where action = 'app_user.mfa_enrolled'),
          '{"type": "app_user", "id": "a1000000-0000-4000-8000-00000000000a", "action": "app_user.mfa_enrolled", "tenant": "11111111-1111-4111-8111-111111111111", "by": "a1000000-0000-4000-8000-00000000000a", "after": {"factorId": "f0000000-0000-4000-8000-000000000001", "slot": "principale"}}'::jsonb,
          'the row names the account, the tenant, the factor and the slot');
select is(pg_temp.j('select to_jsonb(public.mfa_record_enrolled(''f0000000-0000-4000-8000-000000000001''))') #>> '{}', 'false', 'recording again is a no-op');
select is((select count(*)::int from public.audit_event where action = 'app_user.mfa_enrolled'), 1, 'and writes no second row');
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'verified', pg_temp.f(2), 'Riserva', 'verified');
select is(pg_temp.j('select to_jsonb(public.mfa_record_enrolled(''f0000000-0000-4000-8000-000000000002''))') #>> '{}', 'true', 'the backup factor is recorded');
select is((select after ->> 'slot' from public.audit_event where action = 'app_user.mfa_enrolled' and after ->> 'factorId' = pg_temp.f(2)), 'riserva', 'with the slot riserva');

-- 7. mfa_unenrol_check.
select pg_temp.mode('enrolled'); select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'verified'); select pg_temp.owner('aal1');
select is(pg_temp.out($$select public.mfa_unenrol_check('f0000000-0000-4000-8000-000000000009')$$), 'P0001 mfa_factor_not_found', 'another user''s factor: not found');
select is(pg_temp.out($$select public.mfa_unenrol_check('f0000000-0000-4000-8000-000000000001')$$), 'P0001 mfa_required', 'removing a verified factor needs aal2');
select pg_temp.owner('aal2');
select is(pg_temp.out($$select public.mfa_unenrol_check('f0000000-0000-4000-8000-000000000001')$$), 'ok', 'an owner at aal2 may remove their only factor');
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'unverified'); select pg_temp.owner('aal1');
select is(pg_temp.out($$select public.mfa_unenrol_check('f0000000-0000-4000-8000-000000000001')$$), 'ok', 'an unverified factor goes at aal1');
select pg_temp.mode('required'); select pg_temp.factors('ad000000-0000-4000-8000-0000000000ad', pg_temp.f(3), 'Principale', 'verified'); select pg_temp.admin('aal2');
select is(pg_temp.out($$select public.mfa_unenrol_check('f0000000-0000-4000-8000-000000000003')$$), 'P0001 mfa_last_factor', 'an admin under required may not remove the last verified factor');
select pg_temp.factors('ad000000-0000-4000-8000-0000000000ad', pg_temp.f(3), 'Principale', 'verified', pg_temp.f(4), 'Riserva', 'verified');
select is(pg_temp.out($$select public.mfa_unenrol_check('f0000000-0000-4000-8000-000000000003')$$), 'ok', 'with two verified factors one may go');
select pg_temp.mode('enrolled'); select pg_temp.factors('ad000000-0000-4000-8000-0000000000ad', pg_temp.f(3), 'Principale', 'verified');
select is(pg_temp.out($$select public.mfa_unenrol_check('f0000000-0000-4000-8000-000000000003')$$), 'ok', 'an admin outside required may remove the last factor');
select pg_temp.chef();
select pg_temp.starts(pg_temp.out($$select public.mfa_unenrol_check(gen_random_uuid())$$), '42501', 'mfa_unenrol_check: chef is refused');

-- 8. mfa_record_unenrolled.
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a', pg_temp.f(1), 'Principale', 'verified'); select pg_temp.owner('aal2');
select is(pg_temp.out($$select public.mfa_record_enrolled('f0000000-0000-4000-8000-000000000001')$$), 'ok', 'setup: the factor is recorded as enrolled');
select is(pg_temp.out($$select public.mfa_record_unenrolled('f0000000-0000-4000-8000-000000000001')$$), 'P0001 mfa_factor_still_present', 'while the factor exists nothing is recorded');
select pg_temp.factors('a0000000-0000-4000-8000-00000000000a');
select is(pg_temp.j('select to_jsonb(public.mfa_record_unenrolled(''f0000000-0000-4000-8000-000000000001''))') #>> '{}', 'true', 'after deletion the removal is recorded');
select is((select jsonb_build_object('type', entity_type, 'id', entity_id, 'by', created_by, 'after', after) from public.audit_event where action = 'app_user.mfa_unenrolled'),
          '{"type": "app_user", "id": "a1000000-0000-4000-8000-00000000000a", "by": "a1000000-0000-4000-8000-00000000000a", "after": {"factorId": "f0000000-0000-4000-8000-000000000001", "slot": "principale"}}'::jsonb, 'with the factor and the slot');
select is(pg_temp.j('select to_jsonb(public.mfa_record_unenrolled(''f0000000-0000-4000-8000-000000000001''))') #>> '{}', 'false', 'again: a no-op');
select is((select count(*)::int from public.audit_event where action = 'app_user.mfa_unenrolled'), 1, 'one row only');
select is(pg_temp.j('select to_jsonb(public.mfa_record_unenrolled(''f0000000-0000-4000-8000-0000000000aa''))') #>> '{}', 'false', 'an abandoned factor that was never enrolled is not audited');
select is((select count(*)::int from public.audit_event where action = 'app_user.mfa_unenrolled'), 1, 'and writes no row');

-- 9. Signatures and grants: no MFA function takes a code or a secret.
select is((select array_agg(distinct format_type(t, null) order by format_type(t, null)) from pg_proc p, unnest(p.proargtypes) t where p.pronamespace = 'public'::regnamespace and p.proname like 'mfa\_%'), array['text', 'uuid'], 'every parameter of a public mfa function is a uuid or text');
select is((select count(*)::int from pg_proc p, unnest(p.proargnames) n where p.pronamespace = 'public'::regnamespace and p.proname like 'mfa\_%'
              and n not in ('p_stage', 'p_slot', 'p_mode', 'p_factor', 'p_user', 'p_tenant', 'p_actor')), 0, 'and the only text parameters are p_stage, p_slot and p_mode');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('mfa_status', 'mfa_gate', 'mfa_attempt_allowed', 'mfa_record_failure', 'mfa_enrol_check', 'mfa_record_enrolled', 'mfa_unenrol_check', 'mfa_record_unenrolled')
              and p.prosecdef and p.proconfig = array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')), 8, 'the eight procedures are definers with an empty search_path, executable by authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('mfa_lock_failures', 'mfa_lock_minutes', 'mfa_max_factors')
              and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')), 3, 'the constants have no API grant');
select is(app.mfa_lock_failures() || '/' || app.mfa_lock_minutes() || '/' || app.mfa_max_factors(), '5/15/2', 'constants: 5 failures, 15 minutes, 2 factors');
select is(app.demo_purge_tables() @> array['mfa_failure'], false, 'mfa_failure is not in the demo purge list: the purge clears it through the foreign key to the users');

select * from finish();
rollback;
