-- P2-1 (docs/plans/2026-11-12-p2-1-totp.md Q-T2; lead decision of 2026-11-12): the permanent audit action app_user.mfa_locked. public.mfa_record_failure writes it exactly once,
-- when the wrong-code count of the account in the 15-minute window reaches the lock threshold (5). The 6th and later failures of the same lock do not write it again; a new
-- lock, after the window has expired, writes a new one. The payload holds the stage and the threshold only. The wrong-code rows (app.mfa_failure) are deleted after 30 days
-- by the retention job; the audit rows are not. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
-- Hold off pg_cron's own job_run inserts until this file rolls back (the retention run below writes the log).
lock table app.job_run in share row exclusive mode;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo', 'email');

create function pg_temp.as_user(p_auth uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', p_role, 'aal', 'aal1')::text, true) $$;
-- n wrong codes at the given stage, as the authenticated role.
create function pg_temp.fail(n int, p_stage text default 'login') returns void language plpgsql as $$
begin
  set local role authenticated;
  for i in 1 .. n loop
    perform public.mfa_record_failure(p_stage);
  end loop;
  reset role;
end $$;
create function pg_temp.locks(p_user uuid default 'a1000000-0000-4000-8000-00000000000a') returns integer language sql as $$
  select count(*)::int from public.audit_event where action = 'app_user.mfa_locked' and entity_id = p_user $$;

select ok((select pg_get_constraintdef(oid) like '%''app_user.mfa_locked''%' from pg_constraint where conname = 'audit_event_action_check'), 'app_user.mfa_locked is in the audit action check');

select pg_temp.as_user('a0000000-0000-4000-8000-00000000000a', 'owner');
select pg_temp.fail(4);
select is(pg_temp.locks(), 0, 'four wrong codes: no lock, no lock row');
select pg_temp.fail(1, 'enrol');
select is(pg_temp.locks(), 1, 'the fifth wrong code (any stage) writes one app_user.mfa_locked row');
select is((select jsonb_build_object('type', entity_type, 'tenant', tenant_id, 'by', created_by, 'after', after, 'before', before)
             from public.audit_event where action = 'app_user.mfa_locked'),
          '{"type": "app_user", "tenant": "11111111-1111-4111-8111-111111111111", "by": "a1000000-0000-4000-8000-00000000000a", "after": {"stage": "enrol", "failures": 5}, "before": null}'::jsonb,
          'the row names the account and the tenant, and holds the stage and the threshold only: no code, no factor id, no IP');
select pg_temp.fail(1);
select is(pg_temp.locks(), 1, 'the sixth wrong code in the same lock window writes nothing more');
select pg_temp.fail(3);
select is(pg_temp.locks(), 1, 'nor do the seventh to ninth');
select is((select count(*)::int from app.mfa_failure), 9, 'every wrong code is still recorded');

-- Another account's failures neither count for this one nor write its lock row.
select pg_temp.as_user('ad000000-0000-4000-8000-0000000000ad', 'admin');
select pg_temp.fail(4);
select is(pg_temp.locks('ad100000-0000-4000-8000-0000000000ad'), 0, 'four wrong codes of the admin: no lock row (the owner''s five do not count)');
select pg_temp.fail(1);
select is(pg_temp.locks('ad100000-0000-4000-8000-0000000000ad'), 1, 'the admin''s fifth writes the admin''s own row');
select is(pg_temp.locks(), 1, 'and the owner still has one');

-- The window expires: a new lock writes a new row.
update app.mfa_failure set at = now() - interval '16 minutes';
select pg_temp.as_user('a0000000-0000-4000-8000-00000000000a', 'owner');
select pg_temp.fail(4);
select is(pg_temp.locks(), 1, 'after the window, four new wrong codes: still the one old row');
select pg_temp.fail(1);
select is(pg_temp.locks(), 2, 'the fifth new wrong code writes a second row: a new lock');

-- Retention: the wrong-code rows go after 30 days, the lock rows stay.
update app.mfa_failure set at = now() - interval '31 days';
select is((select app.run_mfa_failure_retention(now())), 19, 'the retention run deletes the old wrong-code rows (9 + 5 + 5)');
select is((select count(*)::int from app.mfa_failure), 0, 'none are left');
select is((select count(*)::int from public.audit_event where action = 'app_user.mfa_locked'), 3, 'the three lock rows survive the retention run');
select is((select count(*)::int from public.audit_event where action = 'app_user.mfa_locked' and after ?| array['code', 'secret', 'factorId', 'ip']), 0, 'and none holds a code, a secret, a factor id or an IP');

select * from finish();
rollback;
