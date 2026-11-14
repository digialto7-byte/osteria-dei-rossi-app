-- P2-7 S6 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.9, 5 S6): the role matrix of the three new public functions (invoice_xml_precheck, import_xml_invoices,
-- review_replace_with_xml) and what P2-7 leaves alone. Owner and admin (at aal2) pass the gate; chef, waiter, a PIN waiter and an admin at aal1 get 42501 (the P2-1 gate leaves
-- app.role() null); owner B passes the gate in its own tenant (tenant isolation of the ids is pgTAP 363 and 364). Each function is a security definer with an empty search_path,
-- executable by authenticated only. The 21 procedures and helpers P2-7 keeps unchanged are pinned by the md5 of their source (taken from a native build of main's migrations plus
-- P2-7's: none of P2-7's migrations replaces them, which tests/config/p2-7-preserves.test.ts also proves). The catalogue gains no table but invoice_vat_summary, no trigger but
-- invoice_xml_guard and the two of invoice_vat_summary, no policy but invoice_vat_summary_select and the re-created Storage insert policy; the cron jobs are main's.
-- pgTAP 341 (gate coverage) and 359 (catalogue pins), 194 and 196 (purge list and ledgers) run unchanged in the same suite. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo', 'email'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo', 'email'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo', 'pin'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo', 'email');

create function pg_temp.act_as(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', (jsonb_build_object('sub',
    case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f' when 'admin1' then 'f0000000-0000-4000-8000-00000000000f'
               when 'chef' then 'c0000000-0000-4000-8000-00000000000c' when 'ownerb' then 'b0000000-0000-4000-8000-00000000000b' else 'd0000000-0000-4000-8000-00000000000d' end,
    'role', 'authenticated', 'tenant_id', case when p_who = 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end,
    'app_role', case when p_who = 'ownerb' then 'owner' when p_who in ('pin', 'waiter') then 'waiter' when p_who = 'admin1' then 'admin' else p_who end,
    'aal', case when p_who = 'admin' then 'aal2' else 'aal1' end) || case when p_who = 'pin' then jsonb_build_object('login', 'pin') else '{}'::jsonb end)::text, true) $$;
-- ok, or the SQLSTATE, of a statement run as the authenticated role.
create function pg_temp.state_of(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;
grant execute on function pg_temp.state_of(text) to authenticated;
-- The three functions in order. Past the gate each answers something else: the precheck an object, the import invalid_request (an empty payload), the replace not_found (unknown ids).
create function pg_temp.matrix() returns text language sql as $$
  select pg_temp.state_of($q$ select public.invoice_xml_precheck(repeat('a', 64), 'IT12345678903', 'IT00000000000', null) $q$) || ','
      || pg_temp.state_of($q$ select public.import_xml_invoices('{}'::jsonb) $q$) || ','
      || pg_temp.state_of($q$ select public.review_replace_with_xml(gen_random_uuid(), gen_random_uuid()) $q$)
$$;
grant execute on function pg_temp.matrix() to authenticated;

-- 1. The role matrix ------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('owner');
select is(pg_temp.matrix(), 'ok,P0001,P0002', 'owner: past the gate on all three (answer, invalid_request, not_found)');
select pg_temp.act_as('admin');
select is(pg_temp.matrix(), 'ok,P0001,P0002', 'admin at aal2: past the gate on all three');
select pg_temp.act_as('chef');
select is(pg_temp.matrix(), '42501,42501,42501', 'chef: 42501 on all three');
select pg_temp.act_as('waiter');
select is(pg_temp.matrix(), '42501,42501,42501', 'waiter: 42501 on all three');
select pg_temp.act_as('pin');
select is(pg_temp.matrix(), '42501,42501,42501', 'a PIN waiter: 42501 on all three');
select pg_temp.act_as('admin1');
select is(pg_temp.matrix(), '42501,42501,42501', 'admin at aal1 (the P2-1 gate): 42501 on all three');
select pg_temp.act_as('ownerb');
select is(pg_temp.matrix(), 'ok,P0001,P0002', 'owner B: past the gate in its own tenant');
reset role;
-- No session at all: the role is null.
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.matrix(), '42501,42501,42501', 'no token: 42501 on all three');
reset role;
set local role anon;
select is(pg_temp.state_of($q$ select public.import_xml_invoices('{}'::jsonb) $q$), '42501', 'anon cannot execute the import (permission denied)');
select is(pg_temp.state_of($q$ select public.invoice_xml_precheck(repeat('a', 64), 'IT12345678903', null, null) $q$), '42501', 'nor the precheck');
select is(pg_temp.state_of($q$ select public.review_replace_with_xml(gen_random_uuid(), gen_random_uuid()) $q$), '42501', 'nor the replace');
reset role;

-- 2. Definers, search_path, grants ---------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('invoice_xml_precheck', 'import_xml_invoices', 'review_replace_with_xml')
              and p.prosecdef and p.proconfig = array['search_path=""']), 3, 'the three are security definers with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('invoice_xml_precheck', 'import_xml_invoices', 'review_replace_with_xml')
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 3,
          'executable by authenticated only (not anon, not service_role)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname like 'xml\_%'
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
          'the app.xml_* helpers are closed to every API role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname like 'xml\_%'), 11, 'and there are eleven of them');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'invoice_xml_guard' and not has_function_privilege('authenticated', p.oid, 'execute')
              and not has_function_privilege('anon', p.oid, 'execute')), 1, 'the immutability guard cannot be called by an API role');

-- 3. What P2-7 leaves alone ------------------------------------------------------------------------------------------------------------------------------------------
create temp table unchanged (sch text, name text, want text);
insert into unchanged values
  ('app', 'app_user_id', '1,937b81ab6692f2bb603e820e5fddb3b3'),
  ('app', 'approval_blockers', '1,069570cfc5624f114305fafe68aa3af2'),
  ('app', 'approval_lines', '1,124ea91c42da301fbc82f5243187f912'),
  ('app', 'automap_invoice', '1,f501fb644475a8f42c207a2e7a45e5a8'),
  -- Re-pinned on purpose (lead decision 2026-11-14, ADR-044 "Statistics-independent automap"): 20261204100500 replaces only its
  -- article lookup; main's source had md5 652871486f6b63a84f5ffc5c34bf3a4a. Semantics: 022 unchanged, 366 new.
  ('app', 'automap_lines', '1,3fed6c953febabdbd05787e570896d6f'),
  ('app', 'find_duplicate_invoice_in', '1,a52d2c5fbb662d5f043f9c6e6366da8c'),
  ('app', 'invoice_dup_lock_key', '1,7893c954bc1e351dda2a2c43e78b5e0a'),
  ('app', 'invoice_guard', '1,4c1707ecbf9460f17888b4ea3439b54f'),
  ('app', 'propagate_mapping', '1,dd5d3c1a8d8c0af7f8b3e2b6cb6ec5e7'),
  ('app', 'role', '1,cefd8c2cb6a62ff30395b893221cbb17'),
  ('app', 'tenant_id', '1,bd42ec4cf9b574fea9e60e0da8ce6c7a'),
  ('public', 'approve_invoice', '1,ee093461349c9ee3574d560b5b4b7859'),
  ('public', 'extraction_claim', '1,6927592eb042a4b63c24e0a29ca7ac21'),
  ('public', 'extraction_complete', '1,6cb0b3efb41fd011b12e753f58c44a1a'),
  ('public', 'extraction_quality', '1,75bab4fc59f879e820043c8f9811f77a'),
  ('public', 'invoice_approval_preview', '1,c499a3031a63689a50865ad03b108f97'),
  ('public', 'reject_invoice', '1,b833a742f191eb4b9d846de85155f3e5'),
  ('public', 'review_clear_duplicate', '1,11bdd6c4053b8b16696f3b4557604643'),
  ('public', 'review_set_supplier', '1,4186419dc5be5067fbc21dd702d1ebf9'),
  ('public', 'review_update_header', '1,e406a8eaa79098ec565735ebf923bdee'),
  ('public', 'review_update_line', '1,92843d874a2c7ad5983ec9a4e536ad39');;
select is((select count(*)::int from unchanged), 21, 'the list of unchanged-on-purpose functions has 21 entries (the plan''s list)');
select is((select count(*)::int from unchanged u where (select count(*)::int || ',' || coalesce(min(md5(p.prosrc)), '-') from pg_proc p where p.pronamespace = u.sch::regnamespace and p.proname = u.name) = u.want), 21,
          'each has one definition and its source is the one on main (md5 of the source)');
select is((select string_agg(u.sch || '.' || u.name, ', ') from unchanged u
            where (select count(*)::int || ',' || coalesce(min(md5(p.prosrc)), '-') from pg_proc p where p.pronamespace = u.sch::regnamespace and p.proname = u.name) <> u.want), null, 'none is named as changed');

-- 4. The catalogue gains only what the plan lists --------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace) and relkind in ('r', 'p', 'v', 'm')), 71, 'the tables and views of public and app: main''s 70 and invoice_vat_summary');
select is((select string_agg(c.relname::text, ',' order by c.relname) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'invoice%'),
          'invoice,invoice_duplicate_decision,invoice_line,invoice_vat_summary', 'the invoice tables are the three of main and the new one');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace in ('public'::regnamespace, 'app'::regnamespace)), 127,
          'the triggers: main''s 124 and three');
select is((select string_agg(c.relname || '.' || t.tgname, ',' order by c.relname, t.tgname collate "C") from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and (c.relname = 'invoice_vat_summary' or t.tgname = 'invoice_xml_guard')),
          'invoice.invoice_xml_guard,invoice_vat_summary.invoice_vat_summary_append_only,invoice_vat_summary.invoice_vat_summary_no_truncate', 'which are invoice_xml_guard and the two append-only guards of the VAT summary');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace)), 72, 'the row-level security policies: main''s 71 and invoice_vat_summary_select');
select is((select string_agg(p.policyname::text || ':' || p.cmd::text, ',' order by p.policyname) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname like 'invoices\_%'),
          'invoices_object_insert:INSERT,invoices_object_select:SELECT', 'the Storage policies of the invoices bucket are the same two names (the insert one re-created, no update, no delete)');
select is((select string_agg(jobname, ',' order by jobname collate "C") from cron.job), 'alert-rules,auth-purge,extract-invoices,kpi-rollup,ledger-invariants,mfa-failure-retention,reservation-mail,reservation-retention',
          'the cron jobs are main''s (eight, no new job)');
select is((select count(*)::int from pg_enum e join pg_type et on et.oid = e.enumtypid where et.typnamespace in ('public'::regnamespace, 'app'::regnamespace)), 92, 'the enum values are main''s (92)');

select * from finish();
rollback;
