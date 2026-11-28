-- SP3 step 15 (docs/plans/2026-11-15-sp3-console.md §3.3.5, FD31; lead decision 2026-11-28, option A): the login's venue list needs aal2 from the active
-- platform admin. public.my_memberships() is SP2's (20261207100200_select_tenant.sql) re-created in plpgsql with one check first: when the caller has the active
-- platform_admin row and its token is not aal2, P0001 mfa_required. Every other caller, a legacy admin row included, gets SP2's answer (pgTAP 432 unchanged).
-- Same signature, return type, stable, definer, search_path and grants. It reads no gated helper and not app.membership_ungated (341's exempt_session).
create or replace function public.my_memberships() returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $$
begin
  if app.jwt_aal() <> 'aal2'
     and exists (select 1 from platform.staff s where s.auth_id = auth.uid() and s.role = 'platform_admin' and s.is_active) then
    raise exception 'mfa_required' using errcode = 'P0001';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('tenantId', t.id, 'name', t.name, 'role', u.role) order by t.name, t.id), '[]'::jsonb)
      from public.app_user u
      join public.tenant t on t.id = u.tenant_id
     where u.auth_id = auth.uid()
       and u.is_active
  );
end
$$;
