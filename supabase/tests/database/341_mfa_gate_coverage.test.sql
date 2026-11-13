-- P2-1 A2 (docs/plans/2026-11-12-p2-1-totp.md section 5 A2, AT-T1): the gate covers everything. A catalogue scan over pg_proc and pg_policy,
-- then the behaviour of a gated admin (mode required, no factor, aal1) and a gated owner (verified factor, aal1) against real calls.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- 1. Catalogue: every public function executable by authenticated reaches a gated helper (transitive closure over prosrc), is a security
--    invoker function over RLS tables (the three named below), or is on the exempt list.
create temp table fn as
  select p.oid, n.nspname, p.proname, p.prosecdef, p.prosrc, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and p.prokind in ('f', 'p'); -- P2-1 review: procedures too, so the auth-write scan (4) cannot miss a CREATE PROCEDURE
create temp table reach as
  with recursive edges as (
    select a.oid as src, b.oid as dst from fn a join fn b on a.oid <> b.oid and a.prosrc ~* (b.nspname || '\.' || b.proname || '\s*\(')
  ), r (oid) as (
    select oid from fn where nspname = 'app' and proname in ('tenant_id', 'role', 'app_user_id')
    union
    select e.src from edges e join r on e.dst = r.oid
  )
  select oid from r;
grant select on fn, reach to public;

-- Exempt lists, matched by full signature (the ::regprocedure cast raises if a signature does not exist, so the lists cannot go stale, and a
-- new overload or a same-name function in another schema is never covered by an entry).
-- exempt_auth: the eight MFA procedures of T-4. They answer for the caller's own account, so they read app.membership_ungated.
-- staff_session_active is NOT exempt: it reaches app.app_user_id(), which is gated.
create temp table exempt_auth (sig text primary key, oid oid not null);
insert into exempt_auth (sig, oid)
  select s, s::regprocedure::oid from unnest(array[
    'public.mfa_status()', 'public.mfa_gate()', 'public.mfa_attempt_allowed()', 'public.mfa_enrol_check(text)',
    'public.mfa_record_enrolled(uuid)', 'public.mfa_unenrol_check(uuid)', 'public.mfa_record_unenrolled(uuid)', 'public.mfa_record_failure(text)'
  ]) as s;
-- exempt_anon: the five anonymous booking functions found on main; used only by the anon check, never by the authenticated one.
create temp table exempt_anon (sig text primary key, oid oid not null);
insert into exempt_anon (sig, oid)
  select s, s::regprocedure::oid from unnest(array[
    'public.cancel_reservation(text, bigint, text, uuid, bigint)', 'public.request_reservation(text, bigint, text, jsonb, text)',
    'public.reservation_cancel_view(text, bigint, text, uuid, bigint)', 'public.reservation_page(text, bigint, text)',
    'public.reservation_slots(text, bigint, text, date, integer)'
  ]) as s;
-- Security invoker functions: they read only RLS tables, so the gate reaches them through the policies (scan 3 below).
create temp table invoker_ok (proname text primary key);
insert into invoker_ok values ('extraction_quality'), ('recipe_allergen_summary'), ('set_preferred_supplier_item');

select is((select string_agg(f.proname || '(' || f.args || ')', ', ' order by f.proname) from fn f
            where f.nspname = 'public' and has_function_privilege('authenticated', f.oid, 'EXECUTE')
              and f.oid not in (select oid from reach)
              and f.oid not in (select oid from exempt_auth) and f.proname not in (select proname from invoker_ok)), null,
          'every public function executable by authenticated reaches a gated helper, or is one of the eight exempt MFA procedures, or is a named invoker function');
select is((select count(*)::int from exempt_auth), 8, 'the authenticated exempt list is exactly eight signatures');
select is((select count(*)::int from fn f where f.proname in (select proname from invoker_ok) and f.prosecdef), 0, 'the invoker-listed functions are security invoker');
select cmp_ok((select count(*)::int from fn f where f.nspname = 'public' and has_function_privilege('authenticated', f.oid, 'EXECUTE') and f.oid in (select oid from reach)), '>', 100,
              'the scan is not vacuous: over a hundred public functions reach the helpers');
select is((select count(*)::int from fn f where f.nspname = 'public' and has_function_privilege('anon', f.oid, 'EXECUTE') and f.oid not in (select oid from exempt_anon)), 0,
          'anon can execute no public function outside the exempt (booking) signatures');

-- 2. app.membership_ungated is referenced only by the exempt MFA procedures and app.require_aal2.
select is((select string_agg(f.nspname || '.' || f.proname, ', ' order by f.proname) from fn f
            where f.prosrc ~* 'membership_ungated' and f.proname <> 'membership_ungated'
              and f.oid not in (select oid from exempt_auth) and f.proname <> 'require_aal2'), null,
          'app.membership_ungated is referenced only by the exempt MFA procedures and require_aal2');
select is((select count(*)::int from pg_policy p where pg_get_expr(p.polqual, p.polrelid) ~* 'membership_ungated' or pg_get_expr(p.polwithcheck, p.polrelid) ~* 'membership_ungated'), 0,
          'no RLS policy uses app.membership_ungated');
select is((select count(*)::int from pg_attrdef d where pg_get_expr(d.adbin, d.adrelid) ~* 'membership_ungated'), 0, 'no column default uses app.membership_ungated');
select is((select count(*)::int from pg_views v where v.schemaname in ('app', 'public') and v.definition ~* 'membership_ungated'), 0, 'no view uses app.membership_ungated');

-- 3. Every RLS policy on a public table is tied to the gated helpers (tenant_id() or role()); the only exceptions are the four read policies
--    of the access-token hook role.
select is((select string_agg(c.relname || '.' || p.polname, ', ' order by c.relname, p.polname)
             from pg_policy p join pg_class c on c.oid = p.polrelid
            where c.relnamespace = 'public'::regnamespace
              and not (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'app\.(tenant_id|role)\(\)'
              and not (p.polroles = array[(select oid from pg_roles where rolname = 'supabase_auth_admin')]::oid[] and p.polname like '%\_read\_by\_auth\_hook')), null,
          'every RLS policy on a public table uses app.tenant_id() or app.role() (hook-role reads excepted)');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity), 0, 'every public table has RLS on');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and has_table_privilege('authenticated', c.oid, 'SELECT')
              and not coalesce('security_invoker=true' = any (c.reloptions), false)), 0, 'every public view readable by authenticated is security_invoker');
select is((select count(*)::int from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname like 'invoices%'
              and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'app\.(tenant_id|role)\(\)'), 2, 'both invoices bucket policies use the gated helpers');

-- Every policy on storage.objects (not only the invoices bucket) is tied to the gated helpers. The exempt list is empty on purpose: a policy
-- that does not use app.tenant_id() or app.role() must be added here by name, with a comment saying why it is safe.
create temp table storage_policy_exempt (polname text primary key);
select is((select string_agg(p.polname, ', ' order by p.polname) from pg_policy p
            where p.polrelid = 'storage.objects'::regclass
              and not (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'app\.(tenant_id|role)\(\)'
              and p.polname not in (select polname from storage_policy_exempt)), null,
          'every policy on storage.objects uses app.tenant_id() or app.role()');
-- Same for realtime.messages (broadcast and presence authorisation). Real Supabase has the table; the native shim does not, so there the check is
-- skipped (and only there: it runs whenever the table exists). The exempt list is empty on purpose, as above.
create temp table realtime_policy_exempt (polname text primary key);
select case when to_regclass('realtime.messages') is null
         then skip('realtime.messages does not exist here (native shim); CI on the Supabase stack runs this check', 1)
         else is((select string_agg(p.polname, ', ' order by p.polname) from pg_policy p
                   where p.polrelid = to_regclass('realtime.messages')
                     and not (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'app\.(tenant_id|role)\(\)'
                     and p.polname not in (select polname from realtime_policy_exempt)), null,
                 'every policy on realtime.messages uses app.tenant_id() or app.role()')
       end;

-- 4. Behaviour. Fixtures as the test owner.
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo', 'email'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo', 'email'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo', 'pin');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes) values
  ('91000000-0000-4000-8000-000000000091', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/91000000-0000-4000-8000-000000000091.pdf', 'application/pdf', 1000);
insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'app_user', 'c1000000-0000-4000-8000-00000000000c', 'app_user.created', 'a1000000-0000-4000-8000-00000000000a');
insert into storage.objects (bucket_id, name) values ('invoices', '11111111-1111-4111-8111-111111111111/2026/91000000-0000-4000-8000-000000000091.pdf');

create function pg_temp.claims(p_auth uuid, p_role text, p_aal text, p_login text default null) returns void language sql as $$
  select set_config('request.jwt.claims', (jsonb_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', p_role, 'aal', p_aal)
    || case when p_login is null then '{}'::jsonb else jsonb_build_object('login', p_login) end)::text, true) $$;
create function pg_temp.set_state(p_auth uuid, p_mode text, p_factor boolean) returns void language plpgsql as $$
begin
  update public.tenant set mfa_enforcement = p_mode where id = '11111111-1111-4111-8111-111111111111';
  delete from auth.mfa_factors where user_id = p_auth;
  if p_factor then
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
      values (gen_random_uuid(), p_auth, 'Principale', 'totp', 'verified', now(), now(), 'fake-secret-value');
  end if;
end $$;
-- Runs a statement as the authenticated role: 'ok' or the SQLSTATE.
create function pg_temp.out(stmt text) returns text language plpgsql as $$
declare state text;
begin
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate;
  return state;
end $$;
-- Row count of a table read as the authenticated role.
create function pg_temp.cnt(rel text) returns int language plpgsql as $$
declare n int;
begin
  set local role authenticated;
  execute 'select count(*)::int from ' || rel into n;
  reset role;
  return n;
end $$;

-- 4a. Admin under required, no factor, aal1: nothing readable, every call refused.
select pg_temp.set_state('ad000000-0000-4000-8000-0000000000ad', 'required', false);
select pg_temp.claims('ad000000-0000-4000-8000-0000000000ad', 'admin', 'aal1');
select is(pg_temp.cnt('public.invoice'), 0, 'gated admin: invoice reads 0 rows');
select is(pg_temp.cnt('public.audit_event'), 0, 'gated admin: audit_event reads 0 rows');
select is(pg_temp.cnt('public.order_line_cost'), 0, 'gated admin: order_line_cost reads 0 rows');
select is(pg_temp.cnt('public.app_user'), 0, 'gated admin: app_user reads 0 rows');
select is(pg_temp.cnt($$storage.objects where bucket_id = 'invoices'$$), 0, 'gated admin: the invoices bucket lists 0 objects');
select is(pg_temp.out($$select public.create_staff(null, gen_random_uuid(), 'Cameriere Nuovo Demo', 'waiter')$$), '42501', 'gated admin: create_staff is refused');
select is(pg_temp.out($$select public.set_sale_settings('{}'::jsonb)$$), '42501', 'gated admin: set_sale_settings is refused');
select is(pg_temp.out($$select public.menu_list()$$), '42501', 'gated admin: menu_list is refused');
select is(pg_temp.out($$select public.plate_costs(current_date)$$), '42501', 'gated admin: plate_costs is refused');
select is(pg_temp.out($$select public.kpi_items('day', current_date, null, null)$$), '42501', 'gated admin: the KPI items read behind the exports is refused');
-- The same admin at aal2 with a factor: everything answers.
select pg_temp.set_state('ad000000-0000-4000-8000-0000000000ad', 'required', true);
select pg_temp.claims('ad000000-0000-4000-8000-0000000000ad', 'admin', 'aal2');
select is(pg_temp.cnt('public.invoice'), 1, 'admin at aal2: the invoice is readable');
select is(pg_temp.cnt('public.audit_event'), 1, 'admin at aal2: the audit event is readable');
select is(pg_temp.cnt($$storage.objects where bucket_id = 'invoices'$$), 1, 'admin at aal2: the invoice object is listed');
select isnt(pg_temp.out($$select public.create_staff(null, gen_random_uuid(), 'Cameriere Nuovo Demo', 'waiter')$$), '42501', 'admin at aal2: create_staff passes the gate');
select is(pg_temp.out($$select public.menu_list()$$), 'ok', 'admin at aal2: menu_list answers');
select is(pg_temp.out($$select public.plate_costs(current_date)$$), 'ok', 'admin at aal2: plate_costs answers');
select is(pg_temp.out($$select public.kpi_items('day', current_date, null, null)$$), 'ok', 'admin at aal2: the KPI items answer');

-- 4b. Owner with a verified factor, mode enrolled, aal1: the same refusals.
select pg_temp.set_state('a0000000-0000-4000-8000-00000000000a', 'enrolled', true);
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', 'owner', 'aal1');
select is(pg_temp.cnt('public.invoice'), 0, 'gated owner: invoice reads 0 rows');
select is(pg_temp.out($$select public.menu_list()$$), '42501', 'gated owner: menu_list is refused');
select is(pg_temp.out($$select public.set_sale_settings('{}'::jsonb)$$), '42501', 'gated owner: set_sale_settings is refused');
select is(pg_temp.out($$select public.plate_costs(current_date)$$), '42501', 'gated owner: plate_costs is refused');
-- 4c. Owner without a factor: all succeed.
select pg_temp.set_state('a0000000-0000-4000-8000-00000000000a', 'enrolled', false);
select is(pg_temp.cnt('public.invoice'), 1, 'owner without a factor: the invoice is readable');
select is(pg_temp.out($$select public.menu_list()$$), 'ok', 'owner without a factor: menu_list answers');
select is(pg_temp.out($$select public.plate_costs(current_date)$$), 'ok', 'owner without a factor: plate_costs answers');
-- 4d. Chef and PIN waiter: their calls succeed, whatever the tenant mode.
select pg_temp.set_state('c0000000-0000-4000-8000-00000000000c', 'required', true);
select pg_temp.claims('c0000000-0000-4000-8000-00000000000c', 'chef', 'aal1');
select is(pg_temp.out($$select public.kitchen_tickets()$$), 'ok', 'chef with a verified fixture factor under required: the gate does not apply (kitchen_tickets answers)');
select pg_temp.set_state('d0000000-0000-4000-8000-00000000000d', 'required', true);
select pg_temp.claims('d0000000-0000-4000-8000-00000000000d', 'waiter', 'aal1', 'pin');
select is(pg_temp.out($$select public.menu_list()$$), 'ok', 'PIN waiter: menu_list answers under required');

-- 4. Auth writes (P2-1 reset sign-out, plan T-8). The only function of public or app that writes to an auth table is mfa_reset_service_begin (it deletes the
--    target's rows in auth.sessions), and the service role alone may run it. The scan is a text match over pg_proc.prosrc: insert into, update, delete from, truncate or
--    merge into followed by auth. (quoted or not, with any spacing, also inside dynamic SQL strings); it sees no write that a name built at run time would hide, which the
--    review of every new definer function covers.
select is((select string_agg(f.nspname || '.' || f.proname, ', ' order by f.nspname, f.proname) from fn f
            where f.prosrc ~* '\y(insert\s+into|update|delete\s+from|truncate(\s+table)?(\s+only)?|merge\s+into)\s+(only\s+)?"?auth"?\s*\.'),
          'public.mfa_reset_service_begin', 'no function in public or app writes to an auth table except mfa_reset_service_begin');
select is((select count(*)::int from fn f where f.proname = 'mfa_reset_service_begin' and f.prosrc ~* 'delete\s+from\s+auth\.sessions\y'
              and f.prosrc !~* '\y(insert\s+into|update|truncate|merge\s+into)\s+(only\s+)?"?auth"?\s*\.' and f.prosrc !~* 'delete\s+from\s+(only\s+)?"?auth"?\s*\.\s*(?!sessions\y)'),
          1, 'and what it writes in auth is a delete from auth.sessions, no other auth table');
select ok(has_function_privilege('service_role', 'public.mfa_reset_service_begin(uuid, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.mfa_reset_service_begin(uuid, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.mfa_reset_service_begin(uuid, uuid)', 'EXECUTE')
          and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.mfa_reset_service_begin(uuid, uuid)'::regprocedure and a.grantee = 0),
          'mfa_reset_service_begin is executable by service_role only (not anon, authenticated or PUBLIC)');

select * from finish();
rollback;
