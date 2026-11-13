-- P2-1 V1.1 (docs/plans/2026-11-12-p2-1-totp.md section 5b; founder decision Q-T1 = V1 of 2026-11-12): there is no in-app reset of an authenticator.
-- Only the service role, through DigiAlto's script, can write the reset audit row; nothing executable by authenticated or anon does.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('mfa_reset_authorize', 'mfa_reset_failed')), 0, 'mfa_reset_authorize and mfa_reset_failed do not exist');
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.proname ~* 'mfa.*reset|reset.*mfa'
            and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))), 0, 'no function with mfa and reset in its name is executable by authenticated or anon');
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prosrc ~ 'app_user\.mfa_reset'
            and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))), 0, 'no function executable by authenticated or anon writes the reset audit rows');
select is((select string_agg(p.proname, ',' order by p.proname collate "C") from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'app_user\.mfa_reset'), 'mfa_reset_service_begin,mfa_reset_service_failed', 'only the two break-glass twins write them');
select is((select string_agg(p.proname, ',' order by p.proname collate "C") from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('service_role', p.oid, 'EXECUTE') and p.proname like 'mfa\_%'),
          'mfa_reset_service_begin,mfa_reset_service_failed', 'the service role executes exactly the two twins among the mfa functions (set_mfa_enforcement is named differently)');

select * from finish();
rollback;
