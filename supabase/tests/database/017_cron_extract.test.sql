-- M3 cron trigger (plan step 5): pg_cron runs app.call_cron_route every minute while
-- app.extraction_due() says there is work; the route is called through pg_net with the secret
-- read from Vault. On plain Postgres the stand-ins in supabase/tests-native/platform_shim.sql
-- replace cron, net and vault; CI runs the real extensions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Isolation: nothing queued by other work is visible to this test.
delete from public.invoice_line;
delete from public.invoice;
delete from net.http_request_queue where url like '%/api/cron/%';
delete from vault.secrets where name in ('app_base_url', 'cron_secret');

-- The schedule.
select is((select schedule from cron.job where jobname = 'extract-invoices'), '* * * * *',
  'extract-invoices runs every minute');
select matches((select command from cron.job where jobname = 'extract-invoices'),
  'app\.call_cron_route\(''/api/cron/extract''\)', 'the job calls the extract route');
select matches((select command from cron.job where jobname = 'extract-invoices'),
  'app\.extraction_due\(\)', 'and only when something is due');

-- Privileges: nobody but the owner reaches the Vault-reading function.
select ok(not has_function_privilege('authenticated', 'app.call_cron_route(text)', 'execute'),
  'authenticated cannot execute call_cron_route');
select ok(not has_function_privilege('service_role', 'app.call_cron_route(text)', 'execute'),
  'service_role cannot execute call_cron_route');
select ok(not has_function_privilege('anon', 'app.call_cron_route(text)', 'execute'),
  'anon cannot execute call_cron_route');
select ok(not has_function_privilege('authenticated', 'app.extraction_due(int)', 'execute'),
  'authenticated cannot execute extraction_due');
select ok(not has_function_privilege('anon', 'app.extraction_due(int)', 'execute'),
  'anon cannot execute extraction_due');
select is((select prosecdef from pg_proc where oid = 'app.call_cron_route(text)'::regprocedure), true,
  'call_cron_route is security definer (it reads Vault)');
select is((select proconfig from pg_proc where oid = 'app.call_cron_route(text)'::regprocedure),
  array['search_path=""'], 'with an empty search_path');

-- No Vault secrets: no call.
select is(app.call_cron_route('/api/cron/extract'), null, 'without Vault secrets nothing is called');
select is((select count(*) from net.http_request_queue where url like '%/api/cron/%'), 0::bigint,
  'and nothing is queued');
select vault.create_secret('http://app.test', 'app_base_url');
select is(app.call_cron_route('/api/cron/extract'), null, 'with only the base URL nothing is called');
delete from vault.secrets where name = 'app_base_url';
select vault.create_secret('test-cron-secret-0123456789abcdef0123', 'cron_secret');
select is(app.call_cron_route('/api/cron/extract'), null, 'with only the secret nothing is called');
select is((select count(*) from net.http_request_queue where url like '%/api/cron/%'), 0::bigint,
  'and still nothing is queued');

-- Both secrets: one POST with the bearer and a timeout above the route limit.
select vault.create_secret('http://app.test/', 'app_base_url');
select isnt(app.call_cron_route('/api/cron/extract'), null, 'with both secrets a request id is returned');
select is((select count(*) from net.http_request_queue where url like '%/api/cron/%'), 1::bigint,
  'one request is queued');
select is((select url from net.http_request_queue where url like '%/api/cron/%'),
  'http://app.test/api/cron/extract', 'to the route (a trailing slash in the base URL is dropped)');
select is((select headers ->> 'Authorization' from net.http_request_queue where url like '%/api/cron/%'),
  'Bearer test-cron-secret-0123456789abcdef0123', 'with the bearer secret');
select is((select headers ->> 'Content-Type' from net.http_request_queue where url like '%/api/cron/%'),
  'application/json', 'and a JSON content type');
select is((select timeout_milliseconds from net.http_request_queue where url like '%/api/cron/%'), 150000,
  'with a 150 s timeout, above the route''s 120 s limit');
select is((select convert_from(body, 'UTF8') from net.http_request_queue where url like '%/api/cron/%'),
  '{}', 'and an empty JSON body');
select throws_ok($$ select app.call_cron_route('/api/other') $$, 'P0001', null,
  'a path outside /api/cron/ is refused');
select throws_ok($$ select app.call_cron_route('/api/cron/../me') $$, 'P0001', null,
  'a path that climbs out of /api/cron/ is refused');

-- extraction_due: waiting work or an expired lease.
select is(app.extraction_due(), false, 'an empty queue is not due');
insert into public.tenant (id, name, vat_number)
  values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
create function pg_temp.mk(n int, p_status public.invoice_status, p_started_ago interval default null,
    p_next_in interval default null) returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      extraction_started_at, next_attempt_at)
  values (('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.pdf',
    'application/pdf', 100, p_status, now() - p_started_ago, now() + p_next_in)
$$;
select pg_temp.mk(1, 'review');
select pg_temp.mk(2, 'extracting', '0 seconds');
select pg_temp.mk(3, 'received', null, '1 hour');
select is(app.extraction_due(), false,
  'a reviewed invoice, a live lease and a backoff in the future are not due');
select pg_temp.mk(4, 'received');
select is(app.extraction_due(), true, 'a waiting invoice is due');
delete from public.invoice where id = '00000000-0000-4000-8000-000000000004';
select pg_temp.mk(5, 'extracting', '1 hour');
select is(app.extraction_due(), true, 'an expired lease is due');
select * from finish();
rollback;
