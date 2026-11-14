-- P2-1 A7 (docs/plans/2026-11-12-p2-1-totp.md section 5 "Shared lists changed on purpose", A7): what P2-1 leaves alone and what it replaced on purpose.
-- md5 of pg_get_functiondef: the "unchanged on purpose" functions equal their value on main (taken from a database built from main's migrations); the six replaced
-- functions equal their A1 to A6 values; the thirteen new public functions are definers with an empty search_path and the right grants; no public table gains a write
-- grant for an API role; the public catalogue minus the thirteen is main's; the alert registry and the cron jobs are main's (plus the one P2-1 job).
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- 1. Unchanged on purpose: md5 on main.
create temp table pins (fn regprocedure primary key, md5 text not null);
insert into pins values
  ('app.custom_access_token_hook(jsonb)', 'f748cfaaaa9fd22fb48a872745f1bbc5'),
  ('app.staff_session_open(uuid, uuid, timestamptz)', '57542249aea3b728369c41daf47ea8ff'),
  ('app.pin_sign_in_allowed(uuid, timestamptz)', 'efc44d434d6ec09c0dec5fb4b46ca79d'),
  ('public.pin_login_begin(text, uuid)', 'ac47a9d282b10b025334d9070a133f07'),
  ('public.pin_login_finish(uuid, text, uuid)', '709c357f3c268a7ee887fe7560a4d7a0'),
  ('public.staff_session_active()', '9c874a9179d9a7548745b45d96c8e8da'),
  ('app.end_staff_sessions(uuid, uuid, public.staff_session_end, timestamptz)', '144453721ab0c2b4433dc27f3b7d4023'),
  ('public.record_pin_change(uuid)', '29d0d6da12d4788bfc5340b1a3c25089'),
  ('public.prepare_pin_change(uuid)', 'c086653e78f7890671c0ad3ca9a7ee33'),
  ('app.raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity, public.app_role[], timestamptz, date)', '466bf2bd34105a9df1f229fb8c423262'),
  ('app.payload_has_money_value(jsonb)', '981c0b371c1db3d69232692b8cf26eb6'),
  -- re-pinned on purpose by P2-7 S3 (invoice_vat_summary joins the list; was 244dbb02cefe9a6ea25146717a2bcbb4)
  ('app.demo_purge_tables()', '5a0d9d6ebf852c5955d1b935bbcbfbe8');
select is((select count(*)::int from pins where md5(pg_get_functiondef(fn)) <> pins.md5), 0, 'the twelve functions that must stay as they are equal their md5 on main');
select is((select string_agg(fn::text, ', ') from pins where md5(pg_get_functiondef(fn)) <> pins.md5), null, 'none is named as changed');
select is((select count(*)::int from pins), 12, 'and the list has twelve');
select is(app.custom_access_token_hook(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('role', 'authenticated', 'aal', 'aal2'))) -> 'claims' ->> 'aal', 'aal2', 'the hook still passes an aal claim through');

-- 2. Replaced on purpose, re-pinned by P2-1.
create temp table repinned (fn regprocedure primary key, md5 text not null, step text not null);
insert into repinned values
  ('app.tenant_id()', '9120a54efc015457eae0667af6f4fe60', 'A1'),
  ('app.role()', '69915b58e501ac26de0f54d2df409994', 'A1'),
  ('app.app_user_id()', '1571cf2fb0444cbe443e91eb09cf6045', 'A1'),
  ('app.pin_login_finish_at(uuid, public.auth_attempt_outcome, uuid, timestamptz)', '3e2a76dbb9b589d8dfcfe73409f1f87f', 'A5'),
  ('app.payload_money_keys(jsonb)', '028401e1ca05beeced0dc1a7fb66572f', 'A6'),
  ('app.job_health_checks(uuid, timestamptz)', 'fd3492f2c76f20ac63795804b3129cb9', 'A4b');
select is((select string_agg(step || ':' || fn::text, ', ') from repinned where md5(pg_get_functiondef(fn)) <> repinned.md5), null, 'the six replaced functions equal their P2-1 values (a later change must re-pin them on purpose)');
select is((select string_agg(p.proname || ':' || coalesce(p.proacl::text, '-'), ', ' order by p.proname)
             from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('tenant_id', 'role', 'app_user_id')),
          'app_user_id:{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}, role:{postgres=X/postgres,authenticated=X/postgres}, tenant_id:{postgres=X/postgres,authenticated=X/postgres}',
          'the three helpers keep the grants they had');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('job_health_checks', 'pin_login_finish_at', 'payload_money_keys')
              and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'))), 0, 'the other three stay closed to every API role');

-- 3. The thirteen new public functions.
create temp table newfn (proname text primary key, who text not null);
insert into newfn values
  ('mfa_gate', 'authenticated'), ('mfa_status', 'authenticated'), ('mfa_attempt_allowed', 'authenticated'), ('mfa_record_failure', 'authenticated'),
  ('mfa_enrol_check', 'authenticated'), ('mfa_record_enrolled', 'authenticated'), ('mfa_unenrol_check', 'authenticated'), ('mfa_record_unenrolled', 'authenticated'),
  ('mfa_accounts', 'authenticated'), ('finish_pin_change', 'authenticated'),
  ('set_mfa_enforcement', 'service_role'), ('mfa_reset_service_begin', 'service_role'), ('mfa_reset_service_failed', 'service_role');
select is((select count(*)::int from pg_proc p join newfn n on n.proname = p.proname where p.pronamespace = 'public'::regnamespace), 13, 'the thirteen new public functions exist, once each');
select is((select count(*)::int from pg_proc p join newfn n on n.proname = p.proname where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proconfig = array['search_path=""']), 13, 'each is a definer with an empty search_path');
select is((select count(*)::int from pg_proc p join newfn n on n.proname = p.proname where p.pronamespace = 'public'::regnamespace and n.who = 'authenticated'
              and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')), 10,
          'ten are executable by authenticated only');
select is((select count(*)::int from pg_proc p join newfn n on n.proname = p.proname where p.pronamespace = 'public'::regnamespace and n.who = 'service_role'
              and has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')), 3,
          'three (set_mfa_enforcement and the two break-glass twins) are executable by the service role only');
select is((select count(*)::int from pg_proc p join newfn n on n.proname = p.proname where p.pronamespace = 'public'::regnamespace and p.proacl::text ~ '[{,]=X/'), 0, 'none is executable by PUBLIC');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in (select proname from newfn) and proowner <> 'postgres'::regrole), 0, 'all are owned by postgres');
select is((select count(*)::int || ',' || md5(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text collate "C"))
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not in (select proname from newfn)
              and p.proname not in ('invoice_xml_precheck', 'import_xml_invoices', 'trace_lot_search', 'lot_capture', 'trace_lot', 'trace_batch', 'trace_order_line', 'trace_line_search', 'push_sell_through', 'reservations_covers')), -- P2-2 (20261203*): its public functions are left out on purpose, each step adds its names
          '184,5a2eab03d76e48e89fe269f8609c70bf', 'the public functions other than the thirteen are exactly those of main (catalogue md5)');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname not in ('invoice_xml_precheck', 'import_xml_invoices', 'trace_lot_search', 'lot_capture', 'trace_lot', 'trace_batch', 'trace_order_line', 'trace_line_search', 'push_sell_through', 'reservations_covers')), 197, 'so the public surface is main''s 184 plus thirteen (P2-2''s functions left out on purpose)');

-- 3b. The new app functions are closed to every API role.
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
              and p.proname in ('jwt_aal', 'mfa_has_verified_factor', 'mfa_needs_aal2', 'membership_ungated', 'require_aal2', 'mfa_lock_failures', 'mfa_lock_minutes', 'mfa_max_factors', 'mfa_gate_of',
                                'mfa_reset_pending_minutes', 'run_mfa_failure_retention')), 11, 'the eleven new app functions exist');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
              and p.proname in ('jwt_aal', 'mfa_has_verified_factor', 'mfa_needs_aal2', 'membership_ungated', 'require_aal2', 'mfa_lock_failures', 'mfa_lock_minutes', 'mfa_max_factors', 'mfa_gate_of',
                                'mfa_reset_pending_minutes', 'run_mfa_failure_retention')
              and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'))), 0,
          'and none is executable by any API role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('jwt_aal', 'mfa_has_verified_factor', 'mfa_needs_aal2', 'membership_ungated', 'require_aal2', 'mfa_gate_of', 'run_mfa_failure_retention')
              and p.prosecdef and p.proconfig = array['search_path=""']), 6,
          'the definer helpers pin an empty search_path (jwt_aal is a plain invoker function)');

-- 4. No public table gains a write grant for an API role (table and column level), and the two new objects are closed.
select is((select md5(coalesce(string_agg(x, ',' order by x collate "C"), '')) || ',' || count(*) from (
             select format('%s.%s:%s:%s', c.relnamespace::regnamespace, c.relname, r.rolname, p.priv) x
               from pg_class c, pg_roles r, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p(priv)
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and r.rolname in ('anon','authenticated','service_role') and has_table_privilege(r.rolname, c.oid, p.priv)
             union all
             select format('%s.%s.%s:%s:%s', c.relnamespace::regnamespace, c.relname, a.attname, r.rolname, p.priv)
               from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped, pg_roles r, unnest(array['INSERT','UPDATE']) p(priv)
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and r.rolname in ('anon','authenticated','service_role')
                and has_column_privilege(r.rolname, c.oid, a.attnum, p.priv) and not has_table_privilege(r.rolname, c.oid, p.priv)) t),
          '3835ad2b5c1c2f09281c08ca1820fa93,69', 'no public table gains a write grant (table or column) for anon, authenticated or service_role');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')), (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and relrowsecurity), 'every public table still has RLS on');
select is((select string_agg(c.relname, ',' order by c.relname) from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind = 'r' and c.relname = 'mfa_failure'), 'mfa_failure', 'the one new table is app.mfa_failure');
select ok(not has_table_privilege('anon', 'app.mfa_failure', 'SELECT') and not has_table_privilege('authenticated', 'app.mfa_failure', 'SELECT') and not has_table_privilege('service_role', 'app.mfa_failure', 'SELECT')
          and (select relrowsecurity from pg_class where oid = 'app.mfa_failure'::regclass), 'it is closed to every API role and has RLS on');

-- 5. Registry, cron, audit check.
select is((select md5(string_agg(k::text, ',' order by kind)) || ',' || count(*) from app.alert_kind k), 'f51e5576a270a09ac45dbf07efd144ee,15', 'the alert registry is main''s');
select is((select string_agg(jobname, ',' order by jobname collate "C") from cron.job where jobname <> 'mfa-failure-retention'),
          'alert-rules,auth-purge,extract-invoices,kpi-rollup,ledger-invariants,reservation-mail,reservation-retention', 'the cron jobs are main''s');
select is((select count(*)::int from cron.job where jobname = 'mfa-failure-retention'), 1, 'plus the one P2-1 job');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'audit_event_action_check'), '014e2adc1b25094e2196b7f889851fef' /* re-pinned on purpose by P2-7 S4: invoice.imported_xml */, 'the audit action check is the A3 text (main plus seven actions)');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'audit_event_entity_type_check'), '72e5b28132df039351b652a126ed03a3', 'the audit entity types are main''s (no new type)');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'tenant' and column_name = 'mfa_enforcement'), 1, 'the only change to a public table is public.tenant.mfa_enforcement');

select * from finish();
rollback;
