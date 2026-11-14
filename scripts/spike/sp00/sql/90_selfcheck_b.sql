-- SP0 self-check, section B: the console role and probes (02). Run it after 02_console_role.sql and BEFORE 03 (the wrapper's console
-- branch is checked against the real hook, which stops being true once 03 adds tenant selection). T2 runs only if B passes.
-- Fixtures are rolled back inside the DO block. A broken expectation raises.
select sp0.guard();

do $selfcheck$
declare
  v_checks int := 0;
  v_note text;
  v_bad text;
  v_set boolean;
  v_uid uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_tenant uuid;
  v_sid uuid := gen_random_uuid();
  v_event jsonb;
  v_real jsonb;
  v_wrap jsonb;
  v_ping jsonb;
  v_n bigint;
begin
  -- B1: the role exists, cannot log in, and authenticator (PostgREST's login role) is a member.
  if not exists (select 1 from pg_roles where rolname = 'platform_staff' and not rolcanlogin and not rolsuper and not rolbypassrls) then
    raise exception 'B1: platform_staff must exist as a NOLOGIN role without superuser or bypassrls'; end if;
  if not pg_has_role('authenticator', 'platform_staff', 'member') then raise exception 'B1: authenticator is not a member of platform_staff'; end if;
  v_checks := v_checks + 1;

  -- B2: no privilege at all on any table, view or sequence of public, column privileges included (a grant to PUBLIC would show here).
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('platform_staff', c.oid, 'select,insert,update,delete,truncate,references,trigger')
          or has_any_column_privilege('platform_staff', c.oid, 'select,insert,update,references'));
  if v_bad is not null then raise exception 'B2: platform_staff has a privilege on public tables: %', v_bad; end if;
  select string_agg(s.relname, ', ') into v_bad
    from (select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' offset 0) s -- offset 0: sequences only, before the privilege call
   where has_sequence_privilege('platform_staff', s.oid, 'usage,select,update');
  if v_bad is not null then raise exception 'B2: platform_staff has a privilege on public sequences: %', v_bad; end if;
  v_checks := v_checks + 1;

  -- B3: of the spike's functions it executes the ping and the leave only; authenticated and anon execute neither.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'sp0\_%' and has_function_privilege('platform_staff', p.oid, 'execute');
  if v_bad is distinct from 'sp0_leave_console, sp0_platform_ping' then raise exception 'B3: platform_staff executes % (want the ping and the leave only)', v_bad; end if;
  if has_function_privilege('authenticated', 'public.sp0_platform_ping()', 'execute') or has_function_privilege('authenticated', 'public.sp0_leave_console()', 'execute')
     or has_function_privilege('anon', 'public.sp0_platform_ping()', 'execute') or has_function_privilege('anon', 'public.sp0_leave_console()', 'execute') then
    raise exception 'B3: authenticated or anon can execute the ping or the leave'; end if;
  if not has_function_privilege('authenticated', 'public.sp0_select_console()', 'execute')
     or has_function_privilege('anon', 'public.sp0_select_console()', 'execute') then
    raise exception 'B3: sp0_select_console must be executable by authenticated only'; end if;
  -- Informational, for T2: how many other public functions platform_staff can run (PUBLIC's default execute).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like 'sp0\_%' and has_function_privilege('platform_staff', p.oid, 'execute');
  v_note := format('B3 info: platform_staff can execute %s other public functions', v_n);
  v_checks := v_checks + 1;

  -- B4: the probe table: RLS on, select and insert policies for authenticated on the owner's tenant, in the Realtime publication.
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.sp0_rt_probe'::regclass) then raise exception 'B4: sp0_rt_probe has RLS off'; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sp0_rt_probe') <> 2
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sp0_rt_probe' and cmd = 'SELECT'
                     and roles = '{authenticated}' and qual like '%tenant_id%app.tenant_id%')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sp0_rt_probe' and cmd = 'INSERT'
                     and roles = '{authenticated}' and with_check like '%tenant_id%app.tenant_id%') then
    raise exception 'B4: sp0_rt_probe needs exactly an owner-tenant select and an owner-tenant insert policy, both to authenticated'; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sp0_rt_probe') then
    raise exception 'B4: sp0_rt_probe is not in the supabase_realtime publication'; end if;
  v_checks := v_checks + 1;

  -- B5: the hook's session table: only supabase_auth_admin reads it.
  if not has_table_privilege('supabase_auth_admin', 'app.sp0_console_session', 'select')
     or has_table_privilege('anon', 'app.sp0_console_session', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'app.sp0_console_session', 'select,insert,update,delete')
     or has_table_privilege('platform_staff', 'app.sp0_console_session', 'select,insert,update,delete') then
    raise exception 'B5: app.sp0_console_session must be readable by supabase_auth_admin only'; end if;
  v_checks := v_checks + 1;

  -- B6: the wrapper. Fixtures live in this transaction only.
  begin
    insert into auth.users (id, email) values (v_uid, 'sp0-selfcheck-owner@example.test'), (v_other, 'sp0-selfcheck-other@example.test');
    v_tenant := public.create_tenant_with_owner('SP0 Test selfcheck', 'IT98000000009', v_uid, 'Self Check');
    v_event := jsonb_build_object('user_id', v_uid, 'authentication_method', 'token_refresh',
                 'claims', jsonb_build_object('sub', v_uid, 'aal', 'aal1', 'role', 'authenticated', 'session_id', v_sid));

    -- no console row: nothing changes but sp0_in.
    v_real := app.sp0_real_hook(v_event);
    v_wrap := app.custom_access_token_hook(v_event);
    if (v_wrap -> 'claims') - 'sp0_in' is distinct from (v_real -> 'claims') then raise exception 'B6: the wrapper changed claims without a console session'; end if;
    if v_wrap -> 'claims' ->> 'role' is distinct from 'authenticated' or v_wrap -> 'claims' ->> 'tenant_id' is distinct from v_tenant::text then
      raise exception 'B6: an ordinary session lost its role or tenant claim'; end if;

    -- selecting the console: sp0_select_console stores the caller's session id; it needs a session id.
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    begin
      perform public.sp0_select_console();
      raise exception 'B6: sp0_select_console accepted a token without session_id';
    exception when others then
      if sqlerrm like 'B6:%' then raise; end if;
    end;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated', 'session_id', v_sid)::text, true);
    perform public.sp0_select_console();
    perform public.sp0_select_console(); -- twice is fine
    if (select count(*) from app.sp0_console_session where session_id = v_sid and auth_id = v_uid) <> 1 then
      raise exception 'B6: sp0_select_console did not store exactly the caller''s session'; end if;

    -- console row: role platform_staff, tenant claims stripped, everything else (aal, session_id, sp0_in) kept.
    v_wrap := app.custom_access_token_hook(v_event);
    if v_wrap -> 'claims' ->> 'role' is distinct from 'platform_staff' then raise exception 'B6: a console session did not get role platform_staff'; end if;
    if (v_wrap -> 'claims') ?| array['tenant_id', 'app_role', 'login'] then raise exception 'B6: a console token still carries tenant claims'; end if;
    if v_wrap -> 'claims' ->> 'session_id' is distinct from v_sid::text or v_wrap -> 'claims' ->> 'aal' is distinct from 'aal1'
       or not (v_wrap -> 'claims') ? 'sp0_in' then raise exception 'B6: a console token lost session_id, aal or sp0_in'; end if;

    -- another user on the same session id, and the same user on another session id, are not in console mode.
    v_wrap := app.custom_access_token_hook(jsonb_set(v_event, '{user_id}', to_jsonb(v_other::text)));
    if v_wrap -> 'claims' ->> 'role' is distinct from 'authenticated' then raise exception 'B6: console mode followed a session id to another user'; end if;
    v_wrap := app.custom_access_token_hook(jsonb_set(v_event, '{claims,session_id}', to_jsonb(gen_random_uuid()::text)));
    if v_wrap -> 'claims' ->> 'role' is distinct from 'authenticated' or v_wrap -> 'claims' ->> 'tenant_id' is distinct from v_tenant::text then
      raise exception 'B6: console mode leaked to another session of the same user'; end if;
    v_checks := v_checks + 1;

    -- B7: as the role itself (needs SET ROLE on platform_staff; reported when the current user lacks it).
    v_set := pg_has_role(current_user, 'platform_staff', 'set');
    if v_set then
      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'platform_staff', 'session_id', v_sid)::text, true);
      set local role platform_staff;
      v_ping := public.sp0_platform_ping();
      if v_ping ->> 'current_user' is distinct from 'platform_staff' or (v_ping ->> 'tenant_claim')::boolean is distinct from false then
        reset role; raise exception 'B7: the ping answered %', v_ping; end if;
      begin
        perform count(*) from public.tenant;
        reset role; raise exception 'B7: platform_staff read public.tenant';
      exception when insufficient_privilege then null;
      end;
      begin
        perform public.sp0_select_console();
        reset role; raise exception 'B7: platform_staff executed sp0_select_console';
      exception when insufficient_privilege then null;
      end;
      perform public.sp0_leave_console();
      reset role;
      if exists (select 1 from app.sp0_console_session where session_id = v_sid) then raise exception 'B7: sp0_leave_console left the console row'; end if;
      v_wrap := app.custom_access_token_hook(v_event);
      if v_wrap -> 'claims' ->> 'role' is distinct from 'authenticated' or v_wrap -> 'claims' ->> 'tenant_id' is distinct from v_tenant::text then
        raise exception 'B7: after leaving the console the next token is not the tenant token'; end if;
      v_checks := v_checks + 1;
    else
      v_note := concat_ws('; ', v_note, 'B7 NOT RUN: the current user cannot SET ROLE platform_staff; the ping, the leave and the privilege checks as the role are left to the T2 script');
    end if;

    raise exception 'sp0 rollback' using errcode = 'SP099';
  exception when sqlstate 'SP099' then
    null;
  end;

  perform set_config('sp0.selfcheck_result', format('SP0 self-check B: %s groups ok%s', v_checks, coalesce(' (' || v_note || ')', '')), false);
end
$selfcheck$;

-- execute_sql returns the last statement's rows, not notices: the result is a row.
select current_setting('sp0.selfcheck_result') as result;
