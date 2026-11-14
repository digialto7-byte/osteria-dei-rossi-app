-- SP0 self-check, section A: the guard (00) and the probe hook (01). Run it after 01_hook_probe.sql and BEFORE 02/03: it compares the
-- wrapper with the real hook, which stops being true once those files add the console and tenant selection.
-- Everything it creates (a fake tenant, two fake auth users) is rolled back inside the DO block. A broken expectation raises.
select sp0.guard();

do $selfcheck$
declare
  v_ref constant text := 'wjowhjsfpcdykxwgjipq'; -- the staging project: the guard must refuse it by name
  v_checks int := 0;
  v_outcome text;
  v_result text;
  v_uid uuid := gen_random_uuid();
  v_pin uuid := gen_random_uuid();
  v_none uuid := gen_random_uuid();
  v_tenant uuid;
  v_event jsonb;
  v_real jsonb;
  v_wrap jsonb;
  v_sid_ok jsonb;
begin
  -- Runs `p_setup`, then sp0.guard(), then rolls everything back. Returns 'ok' or the guard's message.
  create function pg_temp.guard_outcome(p_setup text) returns text language plpgsql as $f$
  declare v_out text;
  begin
    begin
      execute p_setup;
      begin
        perform sp0.guard();
        v_out := 'ok';
      exception when others then
        v_out := sqlerrm;
      end;
      raise exception 'sp0 rollback' using errcode = 'SP099';
    exception when sqlstate 'SP099' then
      return v_out;
    end;
  end
  $f$;

  -- A1-A6: the guard.
  v_outcome := pg_temp.guard_outcome('select 1');
  if v_outcome <> 'ok' then raise exception 'A1: the guard refused the marked database: %', v_outcome; end if;
  v_checks := v_checks + 1;

  v_outcome := pg_temp.guard_outcome('alter table sp0.target_marker rename to target_marker_off');
  if v_outcome not like '%no target marker%' then raise exception 'A2: no marker table must be refused, got: %', v_outcome; end if;
  v_checks := v_checks + 1;

  v_outcome := pg_temp.guard_outcome('delete from sp0.target_marker');
  if v_outcome not like '%exactly one row%' then raise exception 'A3: an empty marker must be refused, got: %', v_outcome; end if;
  v_outcome := pg_temp.guard_outcome($q$insert into sp0.target_marker (project_ref) values ('local')$q$);
  if v_outcome not like '%exactly one row%' then raise exception 'A3: two marker rows must be refused, got: %', v_outcome; end if;
  v_checks := v_checks + 1;

  -- By name: a marker holding the staging project ref makes the guard raise.
  v_outcome := pg_temp.guard_outcome(format('update sp0.target_marker set project_ref = %L', v_ref));
  if v_outcome not like '%staging project%' then raise exception 'A4: a marker holding the staging ref must be refused, got: %', v_outcome; end if;
  if v_outcome like '%' || v_ref || '%' then raise exception 'A4: the refusal must not repeat the ref'; end if;
  v_checks := v_checks + 1;

  -- By name, production: the ref the lead stored as production_ref when it is known.
  v_outcome := pg_temp.guard_outcome($q$update sp0.target_marker set project_ref = 'zyxwvutsrqponmlkjihg', production_ref = 'zyxwvutsrqponmlkjihg'$q$);
  if v_outcome not like '%production project%' then raise exception 'A5: a marker equal to production_ref must be refused, got: %', v_outcome; end if;
  v_outcome := pg_temp.guard_outcome($q$update sp0.target_marker set project_ref = 'zyxwvutsrqponmlkjihg', production_ref = 'abcdefghijklmnopqrst'$q$);
  if v_outcome <> 'ok' then raise exception 'A5: a temporary ref other than production_ref must pass, got: %', v_outcome; end if;
  v_outcome := pg_temp.guard_outcome($q$update sp0.target_marker set project_ref = 'Not A Ref'$q$);
  if v_outcome not like '%not a project ref%' then raise exception 'A5: a malformed marker ref must be refused, got: %', v_outcome; end if;
  v_checks := v_checks + 1;

  v_outcome := pg_temp.guard_outcome($q$insert into public.tenant (name, vat_number) values ('Some Real Venue', 'IT98000000001')$q$);
  if v_outcome not like '%tenant%not%fake%' then raise exception 'A6: a tenant with another name must be refused, got: %', v_outcome; end if;
  v_outcome := pg_temp.guard_outcome($q$insert into public.tenant (name, vat_number) values ('Osteria Demo SP0', 'IT00000000000'), ('SP0 Test A', 'IT98000000002'), ('Spike Demo 001', 'IT99000000001')$q$);
  if v_outcome <> 'ok' then raise exception 'A6: only fake tenants must pass, got: %', v_outcome; end if;
  v_outcome := pg_temp.guard_outcome($q$insert into public.tenant (name, vat_number) values ('SP0 Test A', 'IT98000000002'), ('Spike Demo 001', 'IT99000000001'), ('Osteria Dei Rossi', 'IT98000000003')$q$);
  if v_outcome not like '%not%fake%' then raise exception 'A6: one real name among fakes must be refused, got: %', v_outcome; end if;
  v_checks := v_checks + 1;

  -- A7-A10: the wrapper. Fixtures live in this transaction only (rolled back below).
  begin
    insert into auth.users (id, email) values (v_uid, 'sp0-selfcheck-owner@example.test'), (v_pin, 'sp0-selfcheck-pin@example.test'),
      (v_none, 'sp0-selfcheck-none@example.test');
    v_tenant := public.create_tenant_with_owner('SP0 Test selfcheck', 'IT98000000009', v_uid, 'Self Check');
    insert into public.app_user (tenant_id, auth_id, role, display_name, login_method)
      values (v_tenant, v_pin, 'waiter', 'Self PIN', 'pin');

    for v_event in
      select jsonb_build_object('user_id', u, 'authentication_method', m,
               'claims', jsonb_build_object('sub', u, 'aal', 'aal1', 'role', 'authenticated', 'session_id', gen_random_uuid()))
        from (values (v_uid, 'password'), (v_pin, 'password'), (v_pin, 'token_refresh'), (v_none, 'otp'), (v_uid, 'totp')) as t (u, m)
    loop
      v_real := app.sp0_real_hook(v_event);
      v_wrap := app.custom_access_token_hook(v_event);
      if not (v_wrap -> 'claims') ? 'sp0_in' then raise exception 'A7: the wrapper adds no sp0_in claim'; end if;
      if (v_wrap -> 'claims') - 'sp0_in' is distinct from (v_real -> 'claims') then
        raise exception 'A7: the wrapper changed a claim besides sp0_in (method %)', v_event ->> 'authentication_method';
      end if;
      if (v_wrap - 'claims') is distinct from (v_real - 'claims') then raise exception 'A7: the wrapper changed the event outside claims'; end if;
      if v_wrap -> 'claims' -> 'sp0_in' ->> 'm' is distinct from v_event ->> 'authentication_method' then raise exception 'A7: sp0_in.m is not the method'; end if;
      v_checks := v_checks + 1;
    end loop;

    -- The owner's event carries tenant claims through the wrapper exactly as the real hook gives them.
    v_event := jsonb_build_object('user_id', v_uid, 'authentication_method', 'password', 'claims', jsonb_build_object('session_id', gen_random_uuid()));
    if app.custom_access_token_hook(v_event) -> 'claims' ->> 'tenant_id' is distinct from v_tenant::text then
      raise exception 'A7: the owner lost the tenant claim'; end if;
    -- A forged tenant claim in the input is still stripped (a no-membership user).
    v_event := jsonb_build_object('user_id', v_none, 'authentication_method', 'password',
                 'claims', jsonb_build_object('tenant_id', v_tenant, 'session_id', gen_random_uuid()));
    if (app.custom_access_token_hook(v_event) -> 'claims') ? 'tenant_id' then raise exception 'A7: a forged tenant claim got through'; end if;
    v_checks := v_checks + 1;

    -- sid: true with a session_id; false when it is removed, empty or null.
    v_sid_ok := app.custom_access_token_hook(jsonb_build_object('user_id', v_none, 'authentication_method', 'password',
                  'claims', jsonb_build_object('session_id', gen_random_uuid())));
    if (v_sid_ok -> 'claims' -> 'sp0_in' ->> 'sid') is distinct from 'true' then raise exception 'A8: sid must be true with a session_id'; end if;
    for v_event in
      select jsonb_build_object('user_id', v_none, 'authentication_method', 'password', 'claims', c)
        from (values ('{}'::jsonb), ('{"session_id": ""}'::jsonb), ('{"session_id": null}'::jsonb)) as t (c)
    loop
      if (app.custom_access_token_hook(v_event) -> 'claims' -> 'sp0_in' ->> 'sid') is distinct from 'false' then
        raise exception 'A8: sid must be false without a usable session_id (%)', v_event -> 'claims'; end if;
    end loop;
    v_event := jsonb_build_object('user_id', v_none, 'authentication_method', 'password');
    if (app.custom_access_token_hook(v_event) -> 'claims' -> 'sp0_in' ->> 'sid') is distinct from 'false' then
      raise exception 'A8: sid must be false when the event has no claims'; end if;
    v_checks := v_checks + 1;

    -- keys: sorted claim NAMES only; never a value.
    v_event := jsonb_build_object('user_id', v_none, 'authentication_method', 'password',
                 'claims', jsonb_build_object('sub', 'value-must-not-leak', 'session_id', 'sid-value-must-not-leak', 'aal', 'aal1'));
    v_result := (app.custom_access_token_hook(v_event) -> 'claims' -> 'sp0_in') ::text;
    if (app.custom_access_token_hook(v_event) -> 'claims' -> 'sp0_in' -> 'keys') is distinct from '["aal", "session_id", "sub"]'::jsonb then
      raise exception 'A9: sp0_in.keys must be the sorted claim names, got %', v_result; end if;
    if v_result like '%must-not-leak%' or v_result like '%aal1%' then raise exception 'A9: sp0_in holds a value'; end if;
    if (select count(*) from jsonb_object_keys(app.custom_access_token_hook(v_event) -> 'claims' -> 'sp0_in')) <> 3 then
      raise exception 'A9: sp0_in holds more than m, sid and keys'; end if;
    v_checks := v_checks + 1;

    raise exception 'sp0 rollback' using errcode = 'SP099';
  exception when sqlstate 'SP099' then
    null; -- the fixtures are gone; the checks above all ran
  end;

  -- A10: execute on the wrapper (and the renamed real hook) for supabase_auth_admin only.
  if exists (
    select 1
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid in ('app.custom_access_token_hook(jsonb)'::regprocedure, 'app.sp0_real_hook(jsonb)'::regprocedure)
       and a.privilege_type = 'EXECUTE'
       and a.grantee not in (p.proowner, 'supabase_auth_admin'::regrole)
  ) then raise exception 'A10: someone besides the owner and supabase_auth_admin can execute a hook'; end if;
  if not has_function_privilege('supabase_auth_admin', 'app.custom_access_token_hook(jsonb)', 'execute') then
    raise exception 'A10: supabase_auth_admin cannot execute the wrapper'; end if;
  if not exists (select 1 from pg_proc p where p.oid = 'app.custom_access_token_hook(jsonb)'::regprocedure and p.prosecdef = false and p.provolatile = 's'
                  and p.proconfig @> array['search_path=""'])
  then raise exception 'A10: the wrapper must be stable, not security definer, with an empty search_path'; end if;
  v_checks := v_checks + 1;

  raise notice 'SP0 self-check A: % groups ok', v_checks;
end
$selfcheck$;
