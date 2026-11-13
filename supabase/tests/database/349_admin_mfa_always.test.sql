-- FD31 (founder decision, docs/plans/2026-11-12-p2-1-totp.md T-2 note): the admin role always needs a second factor, in every tenant
-- mode (off, enrolled, required). The owner is unchanged (off: never; enrolled: only with a verified factor; required: never forced). Chef, waiter and
-- PIN sessions are never gated. An admin can never remove their last verified factor, in any mode; the owner can. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo', 'email'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo', 'email'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo', 'pin');

create function pg_temp.claims(p_auth uuid, p_role text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111',
                                                             'app_role', p_role, 'aal', p_aal)::text, true) $$;
create function pg_temp.auth_of(p_role text) returns uuid language sql immutable as $$
  select case p_role when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'ad000000-0000-4000-8000-0000000000ad'
                     when 'chef' then 'c0000000-0000-4000-8000-00000000000c' else 'd0000000-0000-4000-8000-00000000000d' end::uuid $$;
-- The tenant's mode and the user's factors: 'none', 'one' (one verified), 'two' (two verified).
create function pg_temp.state(p_role text, p_mode text, p_factors text) returns void language plpgsql as $$
begin
  update public.tenant set mfa_enforcement = p_mode where id = '11111111-1111-4111-8111-111111111111';
  delete from auth.mfa_factors where user_id in (select id from auth.users); -- the factor ids are fixed, so one user's state replaces everyone's
  if p_factors in ('one', 'two') then
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
      values ('f0000000-0000-4000-8000-000000000001', pg_temp.auth_of(p_role), 'Principale', 'totp', 'verified', now(), now(), 'fake-secret-value');
  end if;
  if p_factors = 'two' then
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
      values ('f0000000-0000-4000-8000-000000000002', pg_temp.auth_of(p_role), 'Riserva', 'totp', 'verified', now(), now(), 'fake-secret-value');
  end if;
end $$;
create function pg_temp.probe() returns text language plpgsql as $$
declare r text;
begin
  set local role authenticated;
  select coalesce(app.tenant_id()::text, 'null') || '/' || coalesce(app.role()::text, 'null') || '/' || coalesce(app.app_user_id()::text, 'null') into r;
  reset role;
  return r;
end $$;
-- Outcome of a statement as the authenticated role: 'ok' or "SQLSTATE message".
create function pg_temp.out(stmt text) returns text language plpgsql as $$
declare s text; msg text;
begin
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics s = returned_sqlstate, msg = message_text;
  return s || ' ' || msg;
end $$;
create function pg_temp.gate() returns text language plpgsql as $$
declare r text;
begin
  set local role authenticated;
  select public.mfa_gate() into r;
  reset role;
  return r;
end $$;

-- 1. The admin, in every mode: gated without an aal2 token, whatever the factor state; in at aal2.
select pg_temp.state('admin', 'off', 'none');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal1');
select is(pg_temp.probe(), 'null/null/null', 'admin, off, no factor, aal1: nothing');
select is(pg_temp.gate(), 'enrol', 'admin, off, no factor: the gate answers enrol');
select is((select app.mfa_needs_aal2('admin', '11111111-1111-4111-8111-111111111111', pg_temp.auth_of('admin'))), true, 'app.mfa_needs_aal2 is true for an admin in mode off');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal2');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/admin/ad100000-0000-4000-8000-0000000000ad', 'admin, off, no factor, aal2: the values');
select pg_temp.state('admin', 'off', 'one');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal1');
select is(pg_temp.probe(), 'null/null/null', 'admin, off, a factor, aal1: nothing');
select is(pg_temp.gate(), 'challenge', 'admin, off, a factor, aal1: the gate answers challenge');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal2');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/admin/ad100000-0000-4000-8000-0000000000ad', 'admin, off, a factor, aal2: the values');
select is(pg_temp.gate(), 'ok', 'admin, off, a factor, aal2: ok');

select pg_temp.state('admin', 'enrolled', 'none');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal1');
select is(pg_temp.probe(), 'null/null/null', 'admin, enrolled, no factor, aal1: nothing (was: the values)');
select is(pg_temp.gate(), 'enrol', 'admin, enrolled, no factor: the gate answers enrol');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal2');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/admin/ad100000-0000-4000-8000-0000000000ad', 'admin, enrolled, no factor, aal2: the values');
select pg_temp.state('admin', 'enrolled', 'one');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal1');
select is(pg_temp.probe(), 'null/null/null', 'admin, enrolled, a factor, aal1: nothing');
select is(pg_temp.gate(), 'challenge', 'admin, enrolled, a factor, aal1: challenge');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal2');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/admin/ad100000-0000-4000-8000-0000000000ad', 'admin, enrolled, a factor, aal2: the values');

select pg_temp.state('admin', 'required', 'none');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal1');
select is(pg_temp.probe(), 'null/null/null', 'admin, required, no factor, aal1: nothing (unchanged)');
select is(pg_temp.gate(), 'enrol', 'admin, required, no factor: the gate answers enrol (unchanged)');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal2');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/admin/ad100000-0000-4000-8000-0000000000ad', 'admin, required, no factor, aal2: the values');
select pg_temp.state('admin', 'required', 'one');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal1');
select is(pg_temp.probe(), 'null/null/null', 'admin, required, a factor, aal1: nothing');
select is(pg_temp.gate(), 'challenge', 'admin, required, a factor, aal1: challenge');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal2');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/admin/ad100000-0000-4000-8000-0000000000ad', 'admin, required, a factor, aal2: the values');

-- The admin's gate (mfa_status) agrees with mfa_gate in every mode.
select pg_temp.state('admin', 'off', 'none');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal1');
select is((select pg_temp.out($$select public.mfa_status()$$)), 'ok', 'an admin at aal1 can still ask mfa_status');
create function pg_temp.status_gate() returns text language plpgsql as $$
declare r text;
begin
  set local role authenticated;
  select public.mfa_status() ->> 'gate' into r;
  reset role;
  return r;
end $$;
select is(pg_temp.status_gate(), 'enrol', 'mfa_status for an admin without a factor in off: gate enrol');
select pg_temp.state('admin', 'enrolled', 'none');
select is(pg_temp.status_gate(), 'enrol', 'mfa_status for an admin without a factor in enrolled: gate enrol');
select pg_temp.state('admin', 'required', 'none');
select is(pg_temp.status_gate(), 'enrol', 'mfa_status for an admin without a factor in required: gate enrol');

-- 2. The owner is unchanged: off never; enrolled only with a verified factor; required never forced.
select pg_temp.state('owner', 'off', 'none');
select pg_temp.claims(pg_temp.auth_of('owner'), 'owner', 'aal1');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/owner/a1000000-0000-4000-8000-00000000000a', 'owner, off, no factor, aal1: the values');
select pg_temp.state('owner', 'off', 'one');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/owner/a1000000-0000-4000-8000-00000000000a', 'owner, off, a factor, aal1: the values (kill switch)');
select pg_temp.state('owner', 'enrolled', 'none');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/owner/a1000000-0000-4000-8000-00000000000a', 'owner, enrolled, no factor, aal1: the values');
select pg_temp.state('owner', 'enrolled', 'one');
select is(pg_temp.probe(), 'null/null/null', 'owner, enrolled, a factor, aal1: nothing');
select pg_temp.claims(pg_temp.auth_of('owner'), 'owner', 'aal2');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/owner/a1000000-0000-4000-8000-00000000000a', 'owner, enrolled, a factor, aal2: the values');
select pg_temp.state('owner', 'required', 'none');
select pg_temp.claims(pg_temp.auth_of('owner'), 'owner', 'aal1');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/owner/a1000000-0000-4000-8000-00000000000a', 'owner, required, no factor, aal1: the values (owners are never forced)');
select is(pg_temp.gate(), 'ok', 'owner, required, no factor: ok');
select pg_temp.state('owner', 'required', 'one');
select is(pg_temp.probe(), 'null/null/null', 'owner, required, a factor, aal1: nothing');
select is(pg_temp.gate(), 'challenge', 'owner, required, a factor, aal1: challenge');
select pg_temp.claims(pg_temp.auth_of('owner'), 'owner', 'aal2');
select is(pg_temp.probe(), '11111111-1111-4111-8111-111111111111/owner/a1000000-0000-4000-8000-00000000000a', 'owner, required, a factor, aal2: the values');

-- 3. Chef and waiter: never gated, in any mode, with or without a fixture factor.
create temp table staff_result (role text, mode text, factors text, got text);
do $$
declare r text; m text; f text;
begin
  foreach r in array array['chef', 'waiter'] loop
    foreach m in array array['off', 'enrolled', 'required'] loop
      foreach f in array array['none', 'one'] loop
        perform pg_temp.state(r, m, f);
        perform pg_temp.claims(pg_temp.auth_of(r), r, 'aal1');
        insert into staff_result values (r, m, f, case when pg_temp.probe() like '11111111-1111-4111-8111-111111111111/' || r || '/%' then 'values' else 'gated' end);
      end loop;
    end loop;
  end loop;
end $$;
select is((select count(*)::int from staff_result), 12, 'chef and waiter: 2 roles x 3 modes x 2 factor states');
select is((select count(*)::int from staff_result where got <> 'values'), 0, 'neither is ever gated at aal1');
select pg_temp.claims(pg_temp.auth_of('waiter'), 'waiter', 'aal1');
select is(pg_temp.gate(), 'ok', 'mfa_gate answers ok for a waiter');

-- 4. Removing a factor (mfa_unenrol_check, at aal2): an admin never loses the last verified one; an owner may.
create function pg_temp.f1() returns text language sql as $$ select 'select public.mfa_unenrol_check(''f0000000-0000-4000-8000-000000000001'')' $$;
create temp table unenrol_result (role text, mode text, kind text, got text);
do $$
declare m text;
begin
  foreach m in array array['off', 'enrolled', 'required'] loop
    perform pg_temp.state('admin', m, 'one');
    perform pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal2');
    insert into unenrol_result values ('admin', m, 'last', pg_temp.out(pg_temp.f1()));
    perform pg_temp.state('admin', m, 'two');
    insert into unenrol_result values ('admin', m, 'two', pg_temp.out(pg_temp.f1()));
    perform pg_temp.state('owner', m, 'one');
    perform pg_temp.claims(pg_temp.auth_of('owner'), 'owner', 'aal2');
    insert into unenrol_result values ('owner', m, 'last', pg_temp.out(pg_temp.f1()));
  end loop;
end $$;
select is((select count(*)::int from unenrol_result), 9, 'nine removals were tried: admin last and admin with two, owner last, in three modes');
select is((select string_agg(mode || ':' || got, ', ' order by mode) from unenrol_result where role = 'admin' and kind = 'last'),
          'enrolled:P0001 mfa_last_factor, off:P0001 mfa_last_factor, required:P0001 mfa_last_factor', 'an admin may not remove the last verified factor in any mode');
select is((select string_agg(mode || ':' || got, ', ' order by mode) from unenrol_result where role = 'admin' and kind = 'two'),
          'enrolled:ok, off:ok, required:ok', 'an admin with two verified factors may remove one, in any mode');
select is((select string_agg(mode || ':' || got, ', ' order by mode) from unenrol_result where role = 'owner' and kind = 'last'),
          'enrolled:ok, off:ok, required:ok', 'an owner may remove their only factor, in any mode (unchanged)');
-- The refusal leaves the factor where it was.
select pg_temp.state('admin', 'off', 'one');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal2');
select is(pg_temp.out(pg_temp.f1()), 'P0001 mfa_last_factor', 'the refusal in off is repeatable');
select is((select count(*)::int from auth.mfa_factors where user_id = pg_temp.auth_of('admin') and status = 'verified'), 1, 'and the verified factor is still there');
-- An unverified (abandoned) factor of an admin may still be dropped, in any mode.
select pg_temp.state('admin', 'off', 'none');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values ('f0000000-0000-4000-8000-000000000001', pg_temp.auth_of('admin'), 'Principale', 'totp', 'unverified', now(), now(), 'fake-secret-value');
select pg_temp.claims(pg_temp.auth_of('admin'), 'admin', 'aal1');
select is(pg_temp.out(pg_temp.f1()), 'ok', 'an admin may drop an unverified factor at aal1 in off');

select * from finish();
rollback;
