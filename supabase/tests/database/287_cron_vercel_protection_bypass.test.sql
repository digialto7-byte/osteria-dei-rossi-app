-- Vercel Deployment Protection bypass for the cron route call
-- (migration 20261122100000_cron_vercel_protection_bypass.sql). When the Vault secret
-- vercel_protection_bypass is set and not blank, app.call_cron_route adds the header
-- x-vercel-protection-bypass; otherwise it sends exactly the headers it sent before.
-- net.http_post is the stand-in of supabase/tests-native/platform_shim.sql (captures rows).
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

delete from net.http_request_queue where url like '%/api/cron/%';
delete from vault.secrets where name in ('app_base_url', 'cron_secret', 'vercel_protection_bypass');

-- Unchanged contract: security definer, empty search_path, same grants as before (nobody).
select is((select prosecdef from pg_proc where oid = 'app.call_cron_route(text)'::regprocedure), true,
  'call_cron_route stays security definer');
select is((select proconfig from pg_proc where oid = 'app.call_cron_route(text)'::regprocedure),
  array['search_path=""'], 'with an empty search_path');
select ok(not has_function_privilege('anon', 'app.call_cron_route(text)', 'execute'),
  'anon cannot execute call_cron_route');
select ok(not has_function_privilege('authenticated', 'app.call_cron_route(text)', 'execute'),
  'authenticated cannot execute call_cron_route');
select ok(not has_function_privilege('service_role', 'app.call_cron_route(text)', 'execute'),
  'service_role cannot execute call_cron_route');
select is((select count(*) from information_schema.routine_privileges
            where specific_schema = 'app' and routine_name = 'call_cron_route'
              and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')), 0::bigint,
  'PUBLIC has no grant either');

-- Missing base URL or cron secret: null, no call, and the bypass value never shows in the notice.
select vault.create_secret('bypass-fake-123', 'vercel_protection_bypass');
select vault.create_secret('test-cron-secret-0123456789abcdef0123', 'cron_secret');
select is(app.call_cron_route('/api/cron/extract'), null, 'without app_base_url nothing is called');
select is((select count(*) from net.http_request_queue where url like '%/api/cron/%'), 0::bigint,
  'and nothing is queued');
select vault.create_secret('http://app.test', 'app_base_url');
delete from vault.secrets where name = 'cron_secret';
select is(app.call_cron_route('/api/cron/extract'), null, 'without cron_secret nothing is called');
select is((select count(*) from net.http_request_queue where url like '%/api/cron/%'), 0::bigint,
  'and still nothing is queued');

-- A notice cannot be caught inside pgTAP, so check the function source: neither a notice nor an
-- exception may mention the bypass variable.
select doesnt_match(pg_get_functiondef('app.call_cron_route(text)'::regprocedure),
  'raise (notice|exception)[^;]*v_bypass', 'neither a notice nor an exception mentions the bypass value');

-- All three secrets: bypass header plus Authorization and Content-Type.
select vault.create_secret('test-cron-secret-0123456789abcdef0123', 'cron_secret');
select isnt(app.call_cron_route('/api/cron/extract'), null, 'with all three secrets a request id is returned');
select is((select headers ->> 'x-vercel-protection-bypass' from net.http_request_queue
            where url like '%/api/cron/%'), 'bypass-fake-123', 'the bypass header carries the secret');
select is((select headers - 'x-vercel-protection-bypass' from net.http_request_queue
            where url like '%/api/cron/%'),
  '{"Authorization": "Bearer test-cron-secret-0123456789abcdef0123", "Content-Type": "application/json"}'::jsonb,
  'next to Authorization and Content-Type');
select is((select url from net.http_request_queue where url like '%/api/cron/%'), 'http://app.test/api/cron/extract',
  'the bypass path keeps the URL');
select is((select timeout_milliseconds from net.http_request_queue where url like '%/api/cron/%'), 150000,
  'and the 150 s timeout');
select is((select convert_from(body, 'UTF8') from net.http_request_queue where url like '%/api/cron/%'), '{}',
  'and the empty JSON body');

-- Without the bypass secret: exactly the old headers.
delete from net.http_request_queue where url like '%/api/cron/%';
delete from vault.secrets where name = 'vercel_protection_bypass';
select isnt(app.call_cron_route('/api/cron/extract'), null, 'without the bypass secret the call still goes out');
select is((select headers from net.http_request_queue where url like '%/api/cron/%'),
  '{"Authorization": "Bearer test-cron-secret-0123456789abcdef0123", "Content-Type": "application/json"}'::jsonb,
  'with exactly Authorization and Content-Type');

-- Blank bypass: no header.
delete from net.http_request_queue where url like '%/api/cron/%';
select vault.create_secret('   ', 'vercel_protection_bypass');
select isnt(app.call_cron_route('/api/cron/extract'), null, 'with a blank bypass secret the call goes out');
select is((select headers from net.http_request_queue where url like '%/api/cron/%'),
  '{"Authorization": "Bearer test-cron-secret-0123456789abcdef0123", "Content-Type": "application/json"}'::jsonb,
  'and the blank value adds no header');
select * from finish();
rollback;
