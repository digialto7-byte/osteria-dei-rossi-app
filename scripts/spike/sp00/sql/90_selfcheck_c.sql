-- SP0 self-check, section C: memberships and tenant selection (03). Run it after 03_memberships.sql. Fixtures (three fake tenants and
-- their users) are rolled back inside the DO block. A broken expectation raises.
select sp0.guard();

do $selfcheck$
declare
  v_checks int := 0;
  v_note text;
  v_u uuid := gen_random_uuid();      -- admin in A, owner in B (two memberships)
  v_w uuid := gen_random_uuid();      -- one membership (in C)
  v_pin uuid := gen_random_uuid();    -- a PIN waiter in C
  v_oa uuid := gen_random_uuid();
  v_ob uuid := gen_random_uuid();
  v_oc uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_c uuid;
  v_s uuid := gen_random_uuid();      -- U's session
  v_event jsonb; v_real jsonb; v_wrap jsonb;
  v_unique_ok boolean;
begin
  -- C1: unique (tenant_id, auth_id) exists; no unique constraint or index on auth_id alone is left.
  select exists (
    select 1 from pg_index i
     where i.indrelid = 'public.app_user'::regclass and i.indisunique and i.indnatts = 2 and i.indpred is null
       and (select array_agg(a.attname::text order by k.ord) from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = array['tenant_id', 'auth_id'])
    into v_unique_ok;
  if not v_unique_ok then raise exception 'C1: unique (tenant_id, auth_id) is missing on app_user'; end if;
  if exists (
    select 1 from pg_index i
     where i.indrelid = 'public.app_user'::regclass and i.indisunique and i.indnatts = 1 and i.indpred is null
       and (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'auth_id') then
    raise exception 'C1: a unique on auth_id alone is still there'; end if;
  v_checks := v_checks + 1;

  -- C2: the selection table is read by supabase_auth_admin only; sp0_select_tenant is executable by authenticated only.
  if not has_table_privilege('supabase_auth_admin', 'app.sp0_session_tenant', 'select')
     or has_table_privilege('anon', 'app.sp0_session_tenant', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'app.sp0_session_tenant', 'select,insert,update,delete')
     or has_table_privilege('platform_staff', 'app.sp0_session_tenant', 'select,insert,update,delete') then
    raise exception 'C2: app.sp0_session_tenant must be readable by supabase_auth_admin only'; end if;
  if not has_function_privilege('authenticated', 'public.sp0_select_tenant(uuid)', 'execute')
     or has_function_privilege('anon', 'public.sp0_select_tenant(uuid)', 'execute')
     or has_function_privilege('platform_staff', 'public.sp0_select_tenant(uuid)', 'execute') then
    raise exception 'C2: sp0_select_tenant must be executable by authenticated only'; end if;
  v_checks := v_checks + 1;

  begin
    insert into auth.users (id, email) values
      (v_u, 'sp0-c-u@example.test'), (v_w, 'sp0-c-w@example.test'), (v_pin, 'sp0-c-pin@example.test'),
      (v_oa, 'sp0-c-oa@example.test'), (v_ob, 'sp0-c-ob@example.test'), (v_oc, 'sp0-c-oc@example.test');
    v_a := public.create_tenant_with_owner('SP0 Test A', 'IT98000000011', v_oa, 'Owner A');
    v_b := public.create_tenant_with_owner('SP0 Test B', 'IT98000000012', v_ob, 'Owner B');
    v_c := public.create_tenant_with_owner('SP0 Test C', 'IT98000000013', v_oc, 'Owner C');
    -- C3: the same login can now hold one membership per tenant.
    insert into public.app_user (tenant_id, auth_id, role, display_name) values (v_a, v_u, 'admin', 'U in A'), (v_b, v_u, 'owner', 'U in B');
    insert into public.app_user (tenant_id, auth_id, role, display_name) values (v_c, v_w, 'owner', 'W in C');
    insert into public.app_user (tenant_id, auth_id, role, display_name, login_method) values (v_c, v_pin, 'waiter', 'PIN in C', 'pin');
    begin
      insert into public.app_user (tenant_id, auth_id, role, display_name) values (v_a, v_u, 'owner', 'U twice in A');
      raise exception 'C3: the same login twice in one tenant was accepted';
    exception when unique_violation then null;
    end;
    v_checks := v_checks + 1;

    v_event := jsonb_build_object('user_id', v_u, 'authentication_method', 'password',
                 'claims', jsonb_build_object('sub', v_u, 'aal', 'aal2', 'role', 'authenticated', 'session_id', v_s));

    -- C4: two active memberships and no selection: no tenant claims (and the rest is the real hook's).
    v_wrap := app.custom_access_token_hook(v_event);
    if (v_wrap -> 'claims') ?| array['tenant_id', 'app_role'] then raise exception 'C4: tenant claims with two memberships and no selection'; end if;
    if v_wrap -> 'claims' ->> 'aal' is distinct from 'aal2' or v_wrap -> 'claims' ->> 'session_id' is distinct from v_s::text
       or not (v_wrap -> 'claims') ? 'sp0_in' then raise exception 'C4: aal, session_id or sp0_in lost'; end if;
    v_checks := v_checks + 1;

    -- C5: a selection gives that membership's tenant and role.
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u, 'role', 'authenticated', 'session_id', v_s)::text, true);
    perform public.sp0_select_tenant(v_a);
    v_wrap := app.custom_access_token_hook(v_event);
    if v_wrap -> 'claims' ->> 'tenant_id' is distinct from v_a::text or v_wrap -> 'claims' ->> 'app_role' is distinct from 'admin' then
      raise exception 'C5: selecting A did not give A and admin'; end if;
    perform public.sp0_select_tenant(v_b);
    v_wrap := app.custom_access_token_hook(v_event);
    if v_wrap -> 'claims' ->> 'tenant_id' is distinct from v_b::text or v_wrap -> 'claims' ->> 'app_role' is distinct from 'owner' then
      raise exception 'C5: switching to B did not give B and owner'; end if;
    if (select count(*) from app.sp0_session_tenant where session_id = v_s) <> 1 then raise exception 'C5: the selection is not one row per session'; end if;
    -- the selection belongs to the session and the user: another session or another user does not see it.
    v_wrap := app.custom_access_token_hook(jsonb_set(v_event, '{claims,session_id}', to_jsonb(gen_random_uuid()::text)));
    if (v_wrap -> 'claims') ?| array['tenant_id', 'app_role'] then raise exception 'C5: a selection leaked to another session'; end if;
    v_checks := v_checks + 1;

    -- C6: a non-member tenant is refused with 42501 and the selection stays B; a token without session_id is refused.
    begin
      perform public.sp0_select_tenant(v_c);
      raise exception 'C6: sp0_select_tenant accepted a tenant the caller is not in';
    exception when insufficient_privilege then null;
    end;
    if (select tenant_id from app.sp0_session_tenant where session_id = v_s) is distinct from v_b then raise exception 'C6: a refused selection changed the stored one'; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    begin
      perform public.sp0_select_tenant(v_a);
      raise exception 'C6: sp0_select_tenant accepted a token without session_id';
    exception when others then
      if sqlerrm like 'C6:%' then raise; end if;
    end;
    v_checks := v_checks + 1;

    -- C7: a deactivated membership: an existing selection of it gives no tenant claims, and it cannot be selected.
    update public.app_user set is_active = false, deactivated_at = now() where tenant_id = v_b and auth_id = v_u;
    v_wrap := app.custom_access_token_hook(v_event);
    if (v_wrap -> 'claims') ?| array['tenant_id', 'app_role'] then raise exception 'C7: a deactivated selected membership still gives tenant claims'; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u, 'role', 'authenticated', 'session_id', v_s)::text, true);
    begin
      perform public.sp0_select_tenant(v_b);
      raise exception 'C7: a deactivated membership was selectable';
    exception when insufficient_privilege then null;
    end;
    -- With only A still active, no selection of a live membership: today's behaviour (the one active membership).
    delete from app.sp0_session_tenant where session_id = v_s;
    v_real := app.sp0_real_hook(v_event);
    v_wrap := app.custom_access_token_hook(v_event);
    if (v_wrap -> 'claims') - 'sp0_in' is distinct from (v_real -> 'claims') or v_wrap -> 'claims' ->> 'tenant_id' is distinct from v_a::text then
      raise exception 'C7: one active membership must give today''s claims'; end if;
    v_checks := v_checks + 1;

    -- C8: one membership, no selection: exactly today's claims.
    v_event := jsonb_build_object('user_id', v_w, 'authentication_method', 'password',
                 'claims', jsonb_build_object('sub', v_w, 'aal', 'aal1', 'role', 'authenticated', 'session_id', gen_random_uuid()));
    v_real := app.sp0_real_hook(v_event);
    v_wrap := app.custom_access_token_hook(v_event);
    if (v_wrap -> 'claims') - 'sp0_in' is distinct from (v_real -> 'claims') or v_wrap -> 'claims' ->> 'tenant_id' is distinct from v_c::text then
      raise exception 'C8: one membership must give today''s claims'; end if;
    v_checks := v_checks + 1;

    -- C9: a PIN user's event is the real hook's plus sp0_in, for sign-in and refresh.
    for v_event in
      select jsonb_build_object('user_id', v_pin, 'authentication_method', m,
               'claims', jsonb_build_object('sub', v_pin, 'aal', 'aal1', 'role', 'authenticated', 'session_id', gen_random_uuid()))
        from (values ('password'), ('token_refresh')) as t (m)
    loop
      v_real := app.sp0_real_hook(v_event);
      v_wrap := app.custom_access_token_hook(v_event);
      if (v_wrap -> 'claims') - 'sp0_in' is distinct from (v_real -> 'claims') or (v_wrap - 'claims') is distinct from (v_real - 'claims') then
        raise exception 'C9: the PIN event changed (%)', v_event ->> 'authentication_method'; end if;
    end loop;
    v_checks := v_checks + 1;

    -- C10: console mode (02) still wins over a selection: role platform_staff and no tenant claims.
    v_event := jsonb_build_object('user_id', v_u, 'authentication_method', 'token_refresh',
                 'claims', jsonb_build_object('sub', v_u, 'aal', 'aal2', 'role', 'authenticated', 'session_id', v_s));
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u, 'role', 'authenticated', 'session_id', v_s)::text, true);
    perform public.sp0_select_tenant(v_a);
    perform public.sp0_select_console();
    v_wrap := app.custom_access_token_hook(v_event);
    if v_wrap -> 'claims' ->> 'role' is distinct from 'platform_staff' or (v_wrap -> 'claims') ?| array['tenant_id', 'app_role', 'login'] then
      raise exception 'C10: console mode no longer strips the tenant claims'; end if;
    v_checks := v_checks + 1;

    raise exception 'sp0 rollback' using errcode = 'SP099';
  exception when sqlstate 'SP099' then
    null;
  end;

  perform set_config('sp0.selfcheck_result', format('SP0 self-check C: %s groups ok%s', v_checks, coalesce(' (' || v_note || ')', '')), false);
end
$selfcheck$;

-- execute_sql returns the last statement's rows, not notices: the result is a row.
select current_setting('sp0.selfcheck_result') as result;
