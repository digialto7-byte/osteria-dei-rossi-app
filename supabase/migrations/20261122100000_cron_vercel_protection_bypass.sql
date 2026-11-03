-- The Vercel project has Vercel Authentication (deployment protection) on for every non-custom
-- domain, so a pg_net call to a *.vercel.app URL hits Vercel's login wall before the route's bearer
-- check runs. Vercel's fix is the header x-vercel-protection-bypass, whose value comes from
-- Vercel > Settings > Deployment Protection > Protection Bypass for Automation. It is kept in Vault:
--   select vault.create_secret('<protection bypass secret>', 'vercel_protection_bypass');
-- When that secret exists and is not blank, app.call_cron_route sends the header; otherwise it sends
-- exactly the headers it sent before (a custom domain needs no bypass). The value is never logged,
-- raised or returned. Same signature, security definer, search_path and grants as in
-- 20261022120200_cron_extract.sql (create or replace keeps owner and privileges).
create or replace function app.call_cron_route(p_path text) returns bigint
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_base text;
  v_secret text;
  v_bypass text;
  v_headers jsonb;
begin
  if p_path is null or p_path !~ '^/api/cron/[a-z0-9-]+$' then
    raise exception 'invalid_cron_path' using errcode = 'P0001';
  end if;
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_base is null or v_secret is null then
    raise notice 'cron: Vault secrets app_base_url and cron_secret are not both set; % not called',
      p_path;
    return null;
  end if;
  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json');
  select decrypted_secret into v_bypass
    from vault.decrypted_secrets where name = 'vercel_protection_bypass';
  if btrim(coalesce(v_bypass, '')) <> '' then
    v_headers := v_headers || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;
  return net.http_post(
    url := regexp_replace(v_base, '/+$', '') || p_path,
    headers := v_headers,
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
end
$$;
