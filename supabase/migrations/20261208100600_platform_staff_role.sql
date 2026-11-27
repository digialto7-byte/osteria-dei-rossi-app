-- SP3 step 10 (docs/plans/2026-11-15-sp3-console.md §3.3.1; AT1, AT3): the Postgres role of console mode, and the check every console function makes first.
--  * platform_staff: NOLOGIN, NOINHERIT, no attribute, granted to authenticator so PostgREST can switch to it when a token says role = platform_staff (the hook gives that
--    role only to a console session, step 14). Roles belong to the cluster, not the database, so a database rebuilt in the same cluster (a local reset) finds it:
--    then it is adopted only when it is exactly what this file creates (NOLOGIN, NOINHERIT, no attribute, a member of no role), else the migration fails (rule B:
--    never a role of unknown powers). Its only privilege is usage on schema public: no table, column or sequence anywhere, and no function until steps 11 and 12
--    grant the console reads one by one (AT1).
--  * app.require_console(): 42501 console_required unless the token's role is platform_staff and its user is the active platform_admin; then P0001 mfa_factor_required
--    without a verified factor (the check moved here from the bootstrap, Q-P5); then P0001 mfa_required unless the token is aal2 (AT3). Closed to every API role: only
--    the console functions call it, as their first statement.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_staff') then
    create role platform_staff nologin noinherit;
  elsif exists (select 1 from pg_roles r where r.rolname = 'platform_staff'
                   and (r.rolcanlogin or r.rolinherit or r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls
                        or exists (select 1 from pg_auth_members m where m.member = r.oid))) then
    raise exception 'platform_staff_role_unexpected' using errcode = 'P0001';
  end if;
end
$$;
grant platform_staff to authenticator;
grant usage on schema public to platform_staff;

create function app.require_console() returns void
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_auth uuid := auth.uid();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'platform_staff' or v_auth is null
     or not exists (select 1 from platform.staff s where s.auth_id = v_auth and s.role = 'platform_admin' and s.is_active) then
    raise exception 'console_required' using errcode = '42501';
  end if;
  if not app.mfa_has_verified_factor(v_auth) then
    raise exception 'mfa_factor_required' using errcode = 'P0001';
  end if;
  if app.jwt_aal() <> 'aal2' then
    raise exception 'mfa_required' using errcode = 'P0001';
  end if;
end
$$;
revoke all on function app.require_console() from public, anon, authenticated, service_role;
