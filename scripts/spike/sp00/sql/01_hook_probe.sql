select sp0.guard();

-- SP0 scratch 01 (§3.3): the probe hook. Today's hook is renamed to app.sp0_real_hook; a wrapper under the registered name
-- app.custom_access_token_hook calls it first, so every tenant, PIN and role claim stays exactly today's, and adds ONE claim:
--   sp0_in = { m: authentication_method, sid: the input claims have a non-empty session_id, keys: sorted input claim NAMES }
-- The wrapper writes nothing and echoes no claim value. The hook registration (config.toml / dashboard) is unchanged.
do $$
begin
  if to_regprocedure('app.sp0_real_hook(jsonb)') is not null then
    raise exception 'SP0 scratch 01 was already applied: app.sp0_real_hook exists.';
  end if;
end
$$;

alter function app.custom_access_token_hook(jsonb) rename to sp0_real_hook;

create function app.custom_access_token_hook(event jsonb) returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  v_out jsonb := app.sp0_real_hook(event);
  v_in jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_probe jsonb;
begin
  v_probe := jsonb_build_object(
    'm', event ->> 'authentication_method',
    'sid', coalesce(v_in ->> 'session_id', '') <> '',
    'keys', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(v_in) as k)
  );
  return jsonb_set(v_out, '{claims}', coalesce(v_out -> 'claims', '{}'::jsonb) || jsonb_build_object('sp0_in', v_probe));
end
$$;

revoke all on function app.custom_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin;
