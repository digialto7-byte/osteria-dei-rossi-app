-- P2-1 A4 (docs/plans/2026-11-12-p2-1-totp.md section 3.3, 5 A4; founder decision Q-T1 = V1 of 2026-11-12): the read-only status of the other accounts,
-- the enforcement mode (service role only) and the break-glass twins DigiAlto's reset script calls. No reset exists for an authenticated user.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('ae000000-0000-4000-8000-0000000000ae', 'admin-riserva-a@example.test'),
  ('af000000-0000-4000-8000-0000000000af', 'admin-former-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'admin-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, is_active, deactivated_at) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email', true, null),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo', 'email', true, null),
  ('ae100000-0000-4000-8000-0000000000ae', '11111111-1111-4111-8111-111111111111', 'ae000000-0000-4000-8000-0000000000ae', 'admin', 'Admin Riserva Demo', 'email', true, null),
  ('af100000-0000-4000-8000-0000000000af', '11111111-1111-4111-8111-111111111111', 'af000000-0000-4000-8000-0000000000af', 'admin', 'Admin Ex Demo', 'email', false, now()),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo', 'email', true, null),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'admin', 'Admin B Demo', 'email', true, null);

create function pg_temp.claims(p_auth uuid, p_role text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', p_role, 'aal', p_aal)::text, true) $$;
create function pg_temp.mode(p text) returns void language sql as $$ update public.tenant set mfa_enforcement = p where id = '11111111-1111-4111-8111-111111111111' $$;
create function pg_temp.factor(p_auth uuid, p_n int, p_name text) returns void language sql as $$
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (('f0000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid, p_auth, p_name, 'totp', 'verified', now(), now(), 'fake-secret-value') $$;
create function pg_temp.no_factors() returns void language sql as $$ delete from auth.mfa_factors $$;
-- Outcome of a statement under a role: 'ok' or "SQLSTATE message".
create function pg_temp.out(p_role text, stmt text) returns text language plpgsql as $$
declare state text; msg text;
begin
  execute format('set local role %I', p_role);
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end $$;
create function pg_temp.j(p_role text, stmt text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute format('set local role %I', p_role);
  execute stmt into r;
  reset role;
  return r;
end $$;
create function pg_temp.starts(a text, b text, d text) returns text language sql as $$ select is(left(a, length(b)), b, d) $$;

-- 1. mfa_accounts: the other active owner and admin accounts, counts only.
select pg_temp.mode('enrolled'); select pg_temp.no_factors();
select pg_temp.factor('a0000000-0000-4000-8000-00000000000a', 1, 'Principale');
select pg_temp.factor('a0000000-0000-4000-8000-00000000000a', 2, 'Riserva');
select pg_temp.claims('ad000000-0000-4000-8000-0000000000ad', 'admin', 'aal1');
select is(pg_temp.j('authenticated', 'select public.mfa_accounts()'),
          '[{"id": "ae100000-0000-4000-8000-0000000000ae", "displayName": "Admin Riserva Demo", "role": "admin", "factorCount": 0},
            {"id": "a1000000-0000-4000-8000-00000000000a", "displayName": "Titolare Demo", "role": "owner", "factorCount": 2}]'::jsonb,
          'as Admin Demo: Admin Riserva Demo and Titolare Demo with their factor counts; not self, not the chef, not the deactivated admin, not tenant B');
select is(pg_temp.j('authenticated', 'select public.mfa_accounts()') #>> '{0,factorCount}', '0', 'an admin without a factor shows a count of 0 (the status the other account sees)');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.j('authenticated', 'select public.mfa_accounts() -> 0')) k), array['displayName', 'factorCount', 'id', 'role'], 'only id, displayName, role and factorCount');
select pg_temp.claims('c0000000-0000-4000-8000-00000000000c', 'chef', 'aal1');
select pg_temp.starts(pg_temp.out('authenticated', 'select public.mfa_accounts()'), '42501', 'mfa_accounts: chef is refused');
select pg_temp.mode('required'); select pg_temp.claims('ad000000-0000-4000-8000-0000000000ad', 'admin', 'aal1');
select pg_temp.starts(pg_temp.out('authenticated', 'select public.mfa_accounts()'), '42501', 'mfa_accounts: a gated admin (required, no factor, aal1) is refused');
select pg_temp.mode('enrolled');
select ok(not has_function_privilege('anon', 'public.mfa_accounts()', 'EXECUTE') and has_function_privilege('authenticated', 'public.mfa_accounts()', 'EXECUTE'), 'mfa_accounts: authenticated only');

-- 2. set_mfa_enforcement (service role only).
select pg_temp.no_factors();
select is(pg_temp.out('service_role', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'required', 'ad100000-0000-4000-8000-0000000000ad')$$), 'P0001 admins_not_enrolled', 'required is refused while an admin has no verified factor');
create function pg_temp.detail_of(stmt text) returns text language plpgsql as $$
declare d text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $$;
select is(pg_temp.detail_of($$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'required', 'ad100000-0000-4000-8000-0000000000ad')$$), '{"count": 2}', 'the refusal carries the number of admins without a factor (Admin Demo and Admin Riserva Demo)');
select is((select mfa_enforcement from public.tenant where id = '11111111-1111-4111-8111-111111111111'), 'enrolled', 'nothing changed');
select is((select count(*)::int from public.audit_event where action = 'tenant.mfa_enforcement_changed'), 0, 'and no audit row was written');
select pg_temp.factor('ad000000-0000-4000-8000-0000000000ad', 3, 'Principale');
select is(pg_temp.out('service_role', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'required', 'ad100000-0000-4000-8000-0000000000ad')$$), 'P0001 admins_not_enrolled', 'one of two admins enrolled is still refused');
select pg_temp.factor('ae000000-0000-4000-8000-0000000000ae', 4, 'Principale');
select is(pg_temp.j('service_role', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'required', 'ad100000-0000-4000-8000-0000000000ad')$$), '{"changed": true, "mode": "required"}'::jsonb, 'with every active admin enrolled, required is accepted (the deactivated admin does not count)');
select is((select mfa_enforcement from public.tenant where id = '11111111-1111-4111-8111-111111111111'), 'required', 'the mode is saved');
select is((select jsonb_build_object('type', entity_type, 'id', entity_id, 'tenant', tenant_id, 'by', created_by, 'before', before, 'after', after) from public.audit_event where action = 'tenant.mfa_enforcement_changed'),
          '{"type": "tenant", "id": "11111111-1111-4111-8111-111111111111", "tenant": "11111111-1111-4111-8111-111111111111", "by": "ad100000-0000-4000-8000-0000000000ad", "before": {"mode": "enrolled"}, "after": {"mode": "required"}}'::jsonb,
          'one audit row: tenant, before and after mode, the actor');
select is(pg_temp.j('service_role', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'required', 'ad100000-0000-4000-8000-0000000000ad')$$), '{"changed": false, "mode": "required"}'::jsonb, 'the same mode again: changed false');
select is((select count(*)::int from public.audit_event where action = 'tenant.mfa_enforcement_changed'), 1, 'and no second row');
select pg_temp.no_factors();
select is(pg_temp.j('service_role', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'off', 'ad100000-0000-4000-8000-0000000000ad')$$), '{"changed": true, "mode": "off"}'::jsonb, 'off is allowed even with unenrolled admins');
select is((select count(*)::int from public.audit_event where action = 'tenant.mfa_enforcement_changed' and before ->> 'mode' = 'required' and after ->> 'mode' = 'off'), 1, 'and is audited');
select is((select count(*)::int from public.audit_event where action = 'tenant.mfa_enforcement_changed'), 2, 'two rows now');
select is(pg_temp.out('service_role', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'enrolled', 'c1000000-0000-4000-8000-00000000000c')$$), 'P0001 actor_invalid', 'a chef is not a valid actor');
select is(pg_temp.out('service_role', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'enrolled', 'b1000000-0000-4000-8000-00000000000b')$$), 'P0001 actor_invalid', 'another tenant''s admin is not a valid actor');
select is(pg_temp.out('service_role', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'enrolled', 'af100000-0000-4000-8000-0000000000af')$$), 'P0001 actor_invalid', 'a deactivated admin is not a valid actor');
select is(pg_temp.out('service_role', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'enrolled', 'a1000000-0000-4000-8000-00000000000a')$$), 'P0001 actor_invalid', 'an owner is not a valid actor (an admin is required)');
select pg_temp.starts(pg_temp.out('service_role', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'on', 'ad100000-0000-4000-8000-0000000000ad')$$), '22023', 'the mode on is 22023');
select pg_temp.starts(pg_temp.out('authenticated', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'off', 'ad100000-0000-4000-8000-0000000000ad')$$), '42501', 'authenticated may not call it');
select pg_temp.starts(pg_temp.out('anon', $$select public.set_mfa_enforcement('11111111-1111-4111-8111-111111111111', 'off', 'ad100000-0000-4000-8000-0000000000ad')$$), '42501', 'anon may not call it');

-- 3. The break-glass twins (DigiAlto's script, service role). The tenant comes from the target.
-- Two sessions (each with a refresh token) for the reserve admin, one for Admin Demo, who is the actor and must stay signed in.
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('5e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-0000000000ae', now(), now(), 'aal1'),
  ('5e000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-0000000000ae', now(), now(), 'aal2'),
  ('5e000000-0000-4000-8000-000000000003', 'ad000000-0000-4000-8000-0000000000ad', now(), now(), 'aal1');
insert into auth.refresh_tokens (token, user_id, revoked, session_id) values
  ('fake-token-1', 'ae000000-0000-4000-8000-0000000000ae', false, '5e000000-0000-4000-8000-000000000001'),
  ('fake-token-2', 'ae000000-0000-4000-8000-0000000000ae', false, '5e000000-0000-4000-8000-000000000002'),
  ('fake-token-3', 'ad000000-0000-4000-8000-0000000000ad', false, '5e000000-0000-4000-8000-000000000003');
select is(pg_temp.j('service_role', $$select public.mfa_reset_service_begin('ae100000-0000-4000-8000-0000000000ae', 'ad100000-0000-4000-8000-0000000000ad')$$), '{"authId": "ae000000-0000-4000-8000-0000000000ae"}'::jsonb, 'begin on an admin: the auth id, nothing else');
select is((select jsonb_build_object('type', entity_type, 'id', entity_id, 'tenant', tenant_id, 'by', created_by) from public.audit_event where action = 'app_user.mfa_reset'),
          '{"type": "app_user", "id": "ae100000-0000-4000-8000-0000000000ae", "tenant": "11111111-1111-4111-8111-111111111111", "by": "ad100000-0000-4000-8000-0000000000ad"}'::jsonb, 'one mfa_reset row: the target, the target''s tenant, the actor');
select is(pg_temp.j('service_role', $$select public.mfa_reset_service_begin('a1000000-0000-4000-8000-00000000000a', 'ad100000-0000-4000-8000-0000000000ad')$$) ->> 'authId', 'a0000000-0000-4000-8000-00000000000a', 'an owner may be reset too');
select is(pg_temp.out('service_role', $$select public.mfa_reset_service_begin('c1000000-0000-4000-8000-00000000000c', 'ad100000-0000-4000-8000-0000000000ad')$$), 'P0001 mfa_reset_target_invalid', 'a chef is not a valid target');
select is(pg_temp.out('service_role', $$select public.mfa_reset_service_begin('af100000-0000-4000-8000-0000000000af', 'ad100000-0000-4000-8000-0000000000ad')$$), 'P0001 mfa_reset_target_invalid', 'a deactivated account is not a valid target');
select is(pg_temp.out('service_role', $$select public.mfa_reset_service_begin('b1000000-0000-4000-8000-00000000000b', 'ad100000-0000-4000-8000-0000000000ad')$$), 'P0001 actor_invalid', 'an actor of another tenant than the target''s is refused');
select is(pg_temp.out('service_role', $$select public.mfa_reset_service_begin('ae100000-0000-4000-8000-0000000000ae', 'c1000000-0000-4000-8000-00000000000c')$$), 'P0001 actor_invalid', 'a chef is not a valid actor');
select pg_temp.starts(pg_temp.out('service_role', $$select public.mfa_reset_service_begin(gen_random_uuid(), 'ad100000-0000-4000-8000-0000000000ad')$$), 'P0002', 'an unknown target is P0002');
select is((select count(*)::int from public.audit_event where action = 'app_user.mfa_reset'), 2, 'only the two valid begins wrote a row');
-- Sign-out (T-8): begin deletes the target's Auth sessions (their refresh tokens go with them) and nothing else in auth; the audit row counts them, no ids.
select is((select count(*)::int from auth.sessions where user_id = 'ae000000-0000-4000-8000-0000000000ae'), 0, 'begin deleted both sessions of the target');
select is((select count(*)::int from auth.refresh_tokens where user_id = 'ae000000-0000-4000-8000-0000000000ae' or session_id in ('5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000002')), 0, 'and their refresh tokens');
select is((select array_agg(id::text) from auth.sessions), array['5e000000-0000-4000-8000-000000000003'], 'the actor''s session is untouched');
select is((select count(*)::int from auth.refresh_tokens where session_id = '5e000000-0000-4000-8000-000000000003'), 1, 'and so is its refresh token');
select is((select count(*)::int from auth.users), 6, 'no auth user was deleted');
select is((select after from public.audit_event where action = 'app_user.mfa_reset' and entity_id = 'ae100000-0000-4000-8000-0000000000ae'), '{"sessions_revoked": 2}'::jsonb, 'the mfa_reset row records sessions_revoked 2 and nothing else (no ids)');
select is((select after::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-' from public.audit_event where action = 'app_user.mfa_reset' and entity_id = 'ae100000-0000-4000-8000-0000000000ae'), true, 'the payload holds no uuid');
select is((select after from public.audit_event where action = 'app_user.mfa_reset' and entity_id = 'a1000000-0000-4000-8000-00000000000a'), '{"sessions_revoked": 0}'::jsonb, 'a target with no session: sessions_revoked 0');
select is((select before from public.audit_event where action = 'app_user.mfa_reset' and entity_id = 'ae100000-0000-4000-8000-0000000000ae'), null, 'before stays empty');

-- failed: only for a reset this actor began in the last five minutes.
select is(pg_temp.out('service_role', $$select public.mfa_reset_service_failed('ae100000-0000-4000-8000-0000000000ae', 'ad100000-0000-4000-8000-0000000000ad')$$), 'ok', 'failed after a begin by the same actor: recorded');
select is((select count(*)::int from public.audit_event where action = 'app_user.mfa_reset_failed' and entity_id = 'ae100000-0000-4000-8000-0000000000ae' and created_by = 'ad100000-0000-4000-8000-0000000000ad'), 1, 'one mfa_reset_failed row for the target by the actor');
select is(pg_temp.out('service_role', $$select public.mfa_reset_service_failed('ae100000-0000-4000-8000-0000000000ae', 'a1000000-0000-4000-8000-00000000000a')$$), 'P0001 actor_invalid', 'an owner is not a valid actor for failed either');
select is(pg_temp.out('service_role', $$select public.mfa_reset_service_failed('ad100000-0000-4000-8000-0000000000ad', 'ae100000-0000-4000-8000-0000000000ae')$$), 'P0001 mfa_reset_not_pending', 'no begin for that target: not pending');
select is(pg_temp.out('service_role', $$select public.mfa_reset_service_failed('a1000000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-0000000000ae')$$), 'P0001 mfa_reset_not_pending', 'a begin by another actor does not count');
insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'app_user', 'ad100000-0000-4000-8000-0000000000ad', 'app_user.mfa_reset', now() - interval '6 minutes', 'ae100000-0000-4000-8000-0000000000ae');
select is(pg_temp.out('service_role', $$select public.mfa_reset_service_failed('ad100000-0000-4000-8000-0000000000ad', 'ae100000-0000-4000-8000-0000000000ae')$$), 'P0001 mfa_reset_not_pending', 'a begin six minutes old is no longer pending');
select pg_temp.starts(pg_temp.out('authenticated', $$select public.mfa_reset_service_begin('ae100000-0000-4000-8000-0000000000ae', 'ad100000-0000-4000-8000-0000000000ad')$$), '42501', 'begin: authenticated may not call it');
select pg_temp.starts(pg_temp.out('authenticated', $$select public.mfa_reset_service_failed('ae100000-0000-4000-8000-0000000000ae', 'ad100000-0000-4000-8000-0000000000ad')$$), '42501', 'failed: authenticated may not call it');
select ok(not has_function_privilege('anon', 'public.mfa_reset_service_begin(uuid, uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public.mfa_reset_service_failed(uuid, uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.mfa_reset_service_begin(uuid, uuid)', 'EXECUTE') and has_function_privilege('service_role', 'public.mfa_reset_service_failed(uuid, uuid)', 'EXECUTE'), 'the twins are executable by the service role only');
select ok((select bool_and(p.prosecdef and p.proconfig = array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('mfa_accounts', 'set_mfa_enforcement', 'mfa_reset_service_begin', 'mfa_reset_service_failed')), 'the four are definers with an empty search_path');
select is(app.mfa_reset_pending_minutes(), 5, 'constant: a reset stays pending for 5 minutes');

select * from finish();
rollback;
