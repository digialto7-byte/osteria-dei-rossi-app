-- SP2 S4 (docs/plans/2026-11-26-sp02-memberships.md §3.2 and §5 S4; pgTAP 372 on #131): one login with owner rows in A and B never sees the other
-- tenant. AT1 (a catalogue loop over every public table with tenant_id), AT4 (two sessions of one login in A and B at once) and AT6 (#79: an
-- owner with a verified factor at aal1 gets no tenant in A or B). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-ab@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare in A'),
  ('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare in B');
insert into app.session_tenant (session_id, auth_id, tenant_id) values
  ('5e550000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111'),
  ('5e550000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222');

-- The token the hook issues for a session (its claims become request.jwt.claims, as PostgREST does).
create function pg_temp.token(p_session text, p_aal text default 'aal1') returns text language sql as $$
  select (app.custom_access_token_hook(jsonb_build_object(
    'user_id', 'a0000000-0000-4000-8000-00000000000a', 'authentication_method', 'password',
    'claims', jsonb_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated', 'session_id', p_session, 'aal', p_aal)
  )) -> 'claims')::text
$$;

-- Rows of the other tenant visible to the caller, over every public table with a tenant_id column.
create function pg_temp.foreign_rows(p_own uuid) returns integer language plpgsql as $$
declare
  t record;
  n integer;
  total integer := 0;
begin
  for t in select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v') and a.attname = 'tenant_id' and not a.attisdropped
              and has_table_privilege('authenticated', c.oid, 'select') loop
    execute format('select count(*)::int from public.%I where tenant_id is distinct from $1', t.relname) into n using p_own;
    total := total + n;
  end loop;
  return total;
end
$$;
grant execute on function pg_temp.foreign_rows(uuid) to authenticated;

select cmp_ok((select count(*)::int from public.tenant_vat_rate where tenant_id = '22222222-2222-4222-8222-222222222222')
              + (select count(*)::int from public.app_user where tenant_id = '22222222-2222-4222-8222-222222222222'), '>', 1,
  'the loop is not vacuous: B holds rows (its seeded settings and its membership)');

-- AT1: after selecting A, A only; after switching, B only.
select set_config('request.jwt.claims', pg_temp.token('5e550000-0000-4000-8000-0000000000a1'), true);
set local role authenticated;
select is(app.tenant_id(), '11111111-1111-4111-8111-111111111111'::uuid, 'session in A: app.tenant_id() is A');
select is(pg_temp.foreign_rows('11111111-1111-4111-8111-111111111111'), 0, 'and no public table shows a row of B');
select is((select count(*)::int from public.app_user), 1, 'the login sees its own A row only');
reset role;
update app.session_tenant set tenant_id = '22222222-2222-4222-8222-222222222222' where session_id = '5e550000-0000-4000-8000-0000000000a1';
select set_config('request.jwt.claims', pg_temp.token('5e550000-0000-4000-8000-0000000000a1'), true);
set local role authenticated;
select is(app.tenant_id(), '22222222-2222-4222-8222-222222222222'::uuid, 'after switching the session to B: app.tenant_id() is B');
select is(pg_temp.foreign_rows('22222222-2222-4222-8222-222222222222'), 0, 'and no public table shows a row of A');
reset role;
update app.session_tenant set tenant_id = '11111111-1111-4111-8111-111111111111' where session_id = '5e550000-0000-4000-8000-0000000000a1';

-- AT4: two sessions of the same login, one in A and one in B, at the same time.
select set_config('sp2.tok_a', pg_temp.token('5e550000-0000-4000-8000-0000000000a1'), true),
       set_config('sp2.tok_b', pg_temp.token('5e550000-0000-4000-8000-0000000000b1'), true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('sp2.tok_a'), true);
select is(app.tenant_id(), '11111111-1111-4111-8111-111111111111'::uuid, 'two sessions: the first is in A');
select set_config('request.jwt.claims', current_setting('sp2.tok_b'), true);
select is(app.tenant_id(), '22222222-2222-4222-8222-222222222222'::uuid, 'the second, at the same time, in B');
select is(pg_temp.foreign_rows('22222222-2222-4222-8222-222222222222'), 0, 'and it sees nothing of A');
reset role;

-- AT6 (#79 gate): with a verified factor, an aal1 token gets no tenant from the gate in A or in B; aal2 does.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), 'a0000000-0000-4000-8000-00000000000a', 'Principale', 'totp', 'verified', now(), now(), 'fake-secret-value');
select set_config('sp2.tok_a1', pg_temp.token('5e550000-0000-4000-8000-0000000000a1', 'aal1'), true),
       set_config('sp2.tok_b1', pg_temp.token('5e550000-0000-4000-8000-0000000000b1', 'aal1'), true),
       set_config('sp2.tok_b2', pg_temp.token('5e550000-0000-4000-8000-0000000000b1', 'aal2'), true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('sp2.tok_a1'), true);
select is(app.tenant_id(), null, 'a verified factor at aal1: no tenant in A');
select set_config('request.jwt.claims', current_setting('sp2.tok_b1'), true);
select is(app.tenant_id(), null, 'nor in B');
select set_config('request.jwt.claims', current_setting('sp2.tok_b2'), true);
select is(app.tenant_id(), '22222222-2222-4222-8222-222222222222'::uuid, 'at aal2 the gate opens B');
reset role;

select * from finish();
rollback;
