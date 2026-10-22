-- M3: pg_cron calls the Next.js extraction route every minute while there is work. pg_net sends
-- the request; the base URL and the bearer secret are read from Vault, never from this file:
--   select vault.create_secret('https://<app host>', 'app_base_url');
--   select vault.create_secret('<same value as CRON_SECRET in Vercel>', 'cron_secret');
-- Until both exist, app.call_cron_route only raises a notice, so local stacks, CI and unconfigured
-- projects never call out. Supabase Vault (supabase_vault) is enabled by default on Supabase.

-- On Supabase these create the cron and net schemas. Skipped when the schemas already exist (the
-- extension is already enabled, or the plain-Postgres stand-ins in supabase/tests-native are loaded).
do $$
begin
  if to_regnamespace('cron') is null then
    create extension pg_cron;
  end if;
  if to_regnamespace('net') is null then
    create extension pg_net with schema extensions;
  end if;
end
$$;

-- True when an invoice is waiting (its backoff has passed) or holds an expired lease. Saves about
-- 1 440 empty route calls a day. The default lease is EXTRACTION_LEASE_SECONDS (src/server/extraction).
create function app.extraction_due(p_lease_seconds int default 180) returns boolean
  language sql stable
  set search_path = ''
as $$
  select exists (
    select 1
      from public.invoice i
     where (i.status = 'received' and (i.next_attempt_at is null or i.next_attempt_at <= now()))
        or (i.status = 'extracting'
            and i.extraction_started_at < now() - make_interval(secs => p_lease_seconds))
  )
$$;

-- POSTs {} to <app_base_url><path> with the cron bearer. 150 s (pg_net timeout) stays above the
-- route's 120 s maxDuration, so pg_net does not give up first. Returns the pg_net request id, or
-- null when Vault is not configured. Only routes under /api/cron/ can be called.
create function app.call_cron_route(p_path text) returns bigint
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_base text;
  v_secret text;
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
  return net.http_post(
    url := regexp_replace(v_base, '/+$', '') || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
end
$$;

revoke all on function app.extraction_due(int), app.call_cron_route(text)
  from public, anon, authenticated, service_role;

select cron.schedule(
  'extract-invoices',
  '* * * * *',
  $job$select app.call_cron_route('/api/cron/extract') where app.extraction_due()$job$);
