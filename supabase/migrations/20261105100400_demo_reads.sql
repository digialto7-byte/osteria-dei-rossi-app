-- Demo data step 5 (docs/plans/2026-10-24-demo-data.md §3.2; ADR-018): the two reads the seed script and the integration test
-- use, so the secret key never reads a table (above all never a recipe table, whose grants are revoked from service_role).
-- Both are service role only and return counts or ids, never row data.

-- {exists: false}, or {exists: true, tenantId, name, createdAt} for the one demo tenant.
create function public.demo_tenant_status() returns jsonb
  language sql
  stable security definer
  set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('exists', true, 'tenantId', t.id, 'name', t.name, 'createdAt', t.created_at)
       from public.tenant t where t.is_demo),
    jsonb_build_object('exists', false))
$$;
revoke all on function public.demo_tenant_status() from public, anon, authenticated;
grant execute on function public.demo_tenant_status() to service_role;

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
