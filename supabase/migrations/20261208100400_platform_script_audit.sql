-- SP3 step 5 (docs/plans/2026-11-15-sp3-console.md §3.3.6, §3.9.2): the one way a state-changing script writes the platform audit, called by scripts/lib/platform-audit.ts after the
-- script's own change succeeded. Service role only. It writes origin script and an action that starts with `script.` (22023 otherwise); an unknown action or a detail that is not
-- codes and ids is refused by the audit table's own checks (23514), so an address can never land in a row.

create function public.platform_record_script_run(p_action text, p_tenant uuid, p_detail jsonb) returns bigint
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if p_action is null or left(p_action, 7) <> 'script.' then
    raise exception 'invalid_script_action' using errcode = '22023';
  end if;
  return platform.audit_write('script', p_action, p_tenant, p_detail);
end
$$;
revoke all on function public.platform_record_script_run(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_record_script_run(text, uuid, jsonb) to service_role;
