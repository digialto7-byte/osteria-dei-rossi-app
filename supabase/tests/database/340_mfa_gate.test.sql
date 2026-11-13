-- P2-1 A1 (docs/plans/2026-11-12-p2-1-totp.md section 3.2, 5 A1): the assurance-level gate in the three membership helpers.
-- app.tenant_id(), app.role() and app.app_user_id() answer null for an owner or admin who needs aal2 (T-2) and whose token is not aal2;
-- the matrix role x mode x factor x aal is compared with an independent restatement of T-2. Fake data only.
-- FD31: the admin is gated in every mode; the matrix restates T-2 with that rule (migration 20261202100000).
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo', 'email'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo', 'email'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo', 'pin'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo', 'email');

-- Existing tenants read 'enrolled' (the column default), the check refuses anything else.
select is((select mfa_enforcement from public.tenant where id = '11111111-1111-4111-8111-111111111111'), 'enrolled', 'a tenant created before the gate reads enrolled');
select throws_ok($$update public.tenant set mfa_enforcement = 'on' where id = '11111111-1111-4111-8111-111111111111'$$, '23514', null, 'the value on is refused by the check');
select ok(not has_column_privilege('authenticated', 'public.tenant', 'mfa_enforcement', 'UPDATE'), 'authenticated cannot update the mode');
select ok(not has_column_privilege('authenticated', 'public.tenant', 'mfa_enforcement', 'INSERT'), 'authenticated cannot insert the mode');
select ok(not has_column_privilege('anon', 'public.tenant', 'mfa_enforcement', 'SELECT'), 'anon cannot read the mode');

-- A claim set for a user; aal null leaves the claim out (a missing claim counts as aal1).
create function pg_temp.claims(p_auth uuid, p_tenant uuid, p_role text, p_aal text, p_login text default null) returns void language sql as $$
  select set_config('request.jwt.claims', (jsonb_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role)
    || case when p_aal is null then '{}'::jsonb else jsonb_build_object('aal', p_aal) end
    || case when p_login is null then '{}'::jsonb else jsonb_build_object('login', p_login) end)::text, true) $$;
-- The state of a user: the tenant's mode and exactly one factor row of the given kind (none, unverified, verified, phone).
create function pg_temp.set_state(p_auth uuid, p_tenant uuid, p_mode text, p_factor text) returns void language plpgsql as $$
begin
  update public.tenant set mfa_enforcement = p_mode where id = p_tenant;
  delete from auth.mfa_factors where user_id = p_auth;
  if p_factor in ('unverified', 'verified') then
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
      values (gen_random_uuid(), p_auth, 'Principale', 'totp', p_factor::auth.factor_status, now(), now(), 'fake-secret-value');
  elsif p_factor = 'phone' then
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, phone)
      values (gen_random_uuid(), p_auth, 'Telefono', 'phone', 'verified', now(), now(), '+390000000000');
  end if;
end $$;
-- What the three helpers answer as the authenticated role: tenant, role and app user id as one text.
create function pg_temp.probe() returns text language plpgsql as $$
declare r text;
begin
  set local role authenticated;
  select coalesce(app.tenant_id()::text, 'null') || '/' || coalesce(app.role()::text, 'null') || '/' || coalesce(app.app_user_id()::text, 'null') into r;
  reset role;
  return r;
end $$;
create function pg_temp.probe_null() returns text language plpgsql as $$
begin
  set local role authenticated;
  if app.tenant_id() is null and app.role() is null and app.app_user_id() is null then reset role; return 'all null'; end if;
  if app.tenant_id() is not null and app.role() is not null and app.app_user_id() is not null then reset role; return 'all set'; end if;
  reset role;
  return 'mixed';
end $$;

-- The matrix, with T-2 restated here independently of the implementation.
create temp table matrix_result (role text, mode text, factor text, aal text, expected text, got text);
grant all on matrix_result to public;
do $$
declare
  r text; m text; f text; a text; v_auth uuid; v_tenant constant uuid := '11111111-1111-4111-8111-111111111111'; v_needs boolean; v_expected text;
begin
  foreach r in array array['owner', 'admin', 'chef', 'waiter'] loop
    v_auth := case r when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'ad000000-0000-4000-8000-0000000000ad'
                     when 'chef' then 'c0000000-0000-4000-8000-00000000000c' else 'd0000000-0000-4000-8000-00000000000d' end;
    foreach m in array array['off', 'enrolled', 'required'] loop
      foreach f in array array['none', 'unverified', 'verified'] loop
        perform pg_temp.set_state(v_auth, v_tenant, m, f);
        foreach a in array array['missing', 'aal1', 'aal2'] loop
          v_needs := r = 'admin' or (r = 'owner' and m <> 'off' and f = 'verified'); -- FD31: an admin in every mode
          v_expected := case when v_needs and a <> 'aal2' then 'all null' else 'all set' end;
          perform pg_temp.claims(v_auth, v_tenant, r, case a when 'missing' then null else a end);
          insert into matrix_result values (r, m, f, a, v_expected, pg_temp.probe_null());
        end loop;
      end loop;
    end loop;
  end loop;
end $$;
select is((select count(*)::int from matrix_result), 108, 'the matrix has 4 roles x 3 modes x 3 factor states x 3 aal values');
select is((select count(*)::int from matrix_result where expected = 'all null'), 22, 'twenty-two cells are gated at a missing or aal1 token: the admin in every mode and factor state (18), the owner with a verified factor in enrolled and required (4)');
select is((select count(*)::int from matrix_result where expected <> got), 0, 'every cell answers exactly as T-2 says');

-- Named cases (the values, not only null or not).
select pg_temp.set_state('ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'required', 'none');
select pg_temp.claims('ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'admin', 'aal1');
select is(pg_temp.probe(), 'null/null/null', 'admin, required, no factor, aal1: nothing');
select pg_temp.set_state('ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'enrolled', 'none');
select is(pg_temp.probe(), 'null/null/null', 'admin, enrolled, no factor, aal1: nothing (FD31: an admin is gated in every mode; was the values)');
select pg_temp.set_state('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'enrolled', 'verified');
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'aal1');
select is(pg_temp.probe(), 'null/null/null', 'owner, enrolled, verified factor, aal1: nothing');
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', null);
select is(pg_temp.probe(), 'null/null/null', 'owner, verified factor, aal claim missing: nothing');
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'aal2');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/owner/a1000000-0000-4000-8000-00000000000a', 'owner, verified factor, aal2: the values');
select pg_temp.set_state('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'off', 'verified');
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'aal1');
select is(pg_temp.probe_null(), 'all set', 'owner, mode off, verified factor, aal1: the kill switch lets them in');

-- Another user's verified factor, and a phone factor, do not count.
select pg_temp.set_state('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'enrolled', 'none');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), 'b0000000-0000-4000-8000-00000000000b', 'Principale', 'totp', 'verified', now(), now(), 'fake-secret-value');
select is(pg_temp.probe_null(), 'all set', 'a verified factor of another user does not gate this owner');
select pg_temp.set_state('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'enrolled', 'phone');
select is(pg_temp.probe_null(), 'all set', 'a phone factor does not count');
select pg_temp.set_state('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'enrolled', 'unverified');
select is(pg_temp.probe_null(), 'all set', 'an unverified factor does not count');

-- A PIN waiter and a chef are never gated, even in required mode with a (fixture) verified factor.
select pg_temp.set_state('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'required', 'verified');
select pg_temp.claims('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', 'aal1', 'pin');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/waiter/d1000000-0000-4000-8000-00000000000d', 'a PIN waiter gets the values');
select pg_temp.set_state('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'required', 'verified');
select pg_temp.claims('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', 'aal1');
select is(pg_temp.probe_null(), 'all set', 'a chef is never gated');

-- A tenant claim of another tenant still resolves to nothing (the M0 rule is kept).
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222', 'owner', 'aal2');
select is(pg_temp.probe_null(), 'all null', 'a foreign tenant claim resolves to nothing, as before');

-- app.require_aal2(): raises P0001 mfa_required exactly in the gated cases.
select pg_temp.set_state('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'enrolled', 'verified');
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'aal1');
select throws_ok($$select app.require_aal2()$$, 'P0001', 'mfa_required', 'require_aal2 raises mfa_required for a verified-factor owner at aal1');
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'aal2');
select lives_ok($$select app.require_aal2()$$, 'require_aal2 passes at aal2');
select pg_temp.set_state('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'enrolled', 'none');
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'aal1');
select lives_ok($$select app.require_aal2()$$, 'require_aal2 passes for an owner without a factor');
select pg_temp.set_state('ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'required', 'none');
select pg_temp.claims('ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'admin', 'aal1');
select throws_ok($$select app.require_aal2()$$, 'P0001', 'mfa_required', 'require_aal2 raises for an admin under required without a factor');

-- An owner cannot switch the mode off, directly through the API role (no grant).
select pg_temp.set_state('ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'enrolled', 'none');
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'aal2');
set local role authenticated;
select throws_ok($$update public.tenant set mfa_enforcement = 'off' where id = '11111111-1111-4111-8111-111111111111'$$, '42501', null, 'an owner updating mfa_enforcement gets 42501');
reset role;

-- The gate runs for the authenticated role while auth.mfa_factors is not readable by it (the definer reads it).
select ok(not has_table_privilege('authenticated', 'auth.mfa_factors', 'SELECT'), 'authenticated has no grant on auth.mfa_factors');
select pg_temp.set_state('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'enrolled', 'verified');
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'aal1');
select is(pg_temp.probe_null(), 'all null', 'the definer helper reads auth.mfa_factors on behalf of the authenticated role');

-- Grants and shape of the new helpers.
select ok(not has_function_privilege('authenticated', 'app.jwt_aal()', 'EXECUTE') and not has_function_privilege('anon', 'app.jwt_aal()', 'EXECUTE'), 'app.jwt_aal has no API grant');
select ok(not has_function_privilege('authenticated', 'app.mfa_has_verified_factor(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'app.mfa_has_verified_factor(uuid)', 'EXECUTE'), 'app.mfa_has_verified_factor has no API grant');
select ok(not has_function_privilege('authenticated', 'app.mfa_needs_aal2(public.app_role, uuid, uuid)', 'EXECUTE') and not has_function_privilege('anon', 'app.mfa_needs_aal2(public.app_role, uuid, uuid)', 'EXECUTE'), 'app.mfa_needs_aal2 has no API grant');
select ok(not has_function_privilege('authenticated', 'app.membership_ungated()', 'EXECUTE') and not has_function_privilege('anon', 'app.membership_ungated()', 'EXECUTE'), 'app.membership_ungated has no API grant');
select ok(has_function_privilege('authenticated', 'app.tenant_id()', 'EXECUTE') and has_function_privilege('authenticated', 'app.role()', 'EXECUTE') and has_function_privilege('authenticated', 'app.app_user_id()', 'EXECUTE')
          and not has_function_privilege('anon', 'app.tenant_id()', 'EXECUTE') and not has_function_privilege('anon', 'app.role()', 'EXECUTE'), 'the three helpers keep their grants');
select ok((select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('mfa_has_verified_factor', 'mfa_needs_aal2', 'membership_ungated', 'tenant_id', 'role', 'app_user_id')), 'the definer helpers pin an empty search_path');

-- The access-token hook is unchanged: an aal claim passes through (and the tenant claims are still added).
select is(app.custom_access_token_hook(jsonb_build_object('user_id', 'a0000000-0000-4000-8000-00000000000a',
  'claims', jsonb_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated', 'aal', 'aal2'))) -> 'claims' ->> 'aal', 'aal2', 'the hook leaves aal2 alone');
select is(app.custom_access_token_hook(jsonb_build_object('user_id', 'a0000000-0000-4000-8000-00000000000a',
  'claims', jsonb_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated', 'aal', 'aal1'))) -> 'claims' ->> 'app_role', 'owner', 'the hook still adds the role beside aal1');

select * from finish();
rollback;
