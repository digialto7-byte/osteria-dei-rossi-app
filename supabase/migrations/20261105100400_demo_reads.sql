-- Demo data step 5 (docs/plans/2026-10-24-demo-data.md §3.2; ADR-018 revision 1): the two reads the seed script and the integration test
-- use, so the secret key never reads a table (above all never a recipe table, whose grants are revoked from service_role).
-- Both are service role only and return counts or ids, never row data.

-- {exists: false}, or {exists, tenantId, name, demoSince, hasOperationalData, demoUsers} for the given tenant. The script decides
-- from it whether it may seed (not marked, no data), must reset (marked) or must refuse (data, not marked). The name is returned
-- because the reset needs it as the confirmation; it is never printed.
create function public.demo_tenant_state(p_tenant uuid) returns jsonb
  language sql
  stable security definer
  set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
              'exists', true, 'tenantId', t.id, 'name', t.name, 'demoSince', t.demo_data_since,
              'hasOperationalData', app.tenant_has_operational_data(t.id),
              'demoUsers', coalesce((
                with recursive d(id) as (
                  select s.owner_user from app.demo_state s where s.tenant_id = t.id
                  union
                  select s.admin_user from app.demo_state s where s.tenant_id = t.id
                  union
                  select u.id from public.app_user u join d on u.created_by = d.id where u.tenant_id = t.id
                )
                select count(*)::int from d), 0))
       from public.tenant t where t.id = p_tenant),
    jsonb_build_object('exists', false))
$$;
revoke all on function public.demo_tenant_state(uuid) from public, anon, authenticated;
grant execute on function public.demo_tenant_state(uuid) to service_role;

-- A count per table of app.demo_purge_tables() plus alert_refusal, for any tenant (an unknown one gives all zeros).
create function public.demo_tenant_row_counts(p_tenant uuid) returns jsonb
  language sql
  security definer
  set search_path = ''
as $$
  select app.demo_tenant_counts(p_tenant)
$$;
revoke all on function public.demo_tenant_row_counts(uuid) from public, anon, authenticated;
grant execute on function public.demo_tenant_row_counts(uuid) to service_role;
