-- Reservations B5 (docs/plans/2026-11-08-reservations.md §5 B5; ADR-032): what PR2 must not touch, and what it may expose. The md5 pins of 296 still hold (the same functions, the same
-- bodies: PR2 changes none of them), the only functions that anon can execute in public or app are the five of B1 and B2, anon holds no table privilege anywhere, the API roles
-- run nothing in app, service_role runs exactly the two mail functions of the feature, the cron jobs are the PR1 list plus reservation-mail and reservation-retention, the job
-- check is the PR1 list plus the two jobs, and the public tables are still the nine of PR1. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- The 296 pins still hold (md5 of prosrc) -----------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_table' and pronamespace = 'public'::regnamespace), '1,883534f4a8466e0eeef298d805c10b29', 'public.close_table: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'close_session_at' and pronamespace = 'app'::regnamespace), '1,845becea17ad49fb545ea34367d9a01f', 'app.close_session_at: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'table_session_guard' and pronamespace = 'app'::regnamespace), '1,8baaaca12626d00b229d3409939aaf82', 'app.table_session_guard: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'session_services' and pronamespace = 'app'::regnamespace), '1,2d51f85415887d0858bd9b1ce75b6c1b', 'app.session_services: one definition, unchanged (a seated reservation is an ordinary session)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'session_service_one' and pronamespace = 'app'::regnamespace), '1,02d12b5ca3259dcdd01f08b8f18dab0e', 'app.session_service_one: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'kpi_service_split' and pronamespace = 'app'::regnamespace), '1,b66dbeb720b0dfed3c663e72e5b67461', 'app.kpi_service_split: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'app_vs_register_json' and pronamespace = 'app'::regnamespace), '1,86f8d4a0b351affd4ad62039b1530a5c', 'app.app_vs_register_json: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'enter_day_close' and pronamespace = 'public'::regnamespace), '1,12bea6d6dc388226b5a87cf9bbe8277e', 'public.enter_day_close: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'rollup_daily_kpi' and pronamespace = 'app'::regnamespace), '1,31c95a4a73e9fc116d212fa941939f98', 'app.rollup_daily_kpi: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op_dispatch' and pronamespace = 'app'::regnamespace), '1,43cfcbb590e039e1990b44a341b54b62', 'app.apply_op_dispatch: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'apply_op' and pronamespace = 'public'::regnamespace), '1,5b6710a9fe6eca1c7d44ae84d880db5e', 'public.apply_op: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'default_service_periods' and pronamespace = 'app'::regnamespace), '1,ba8c29fa4e644bbb3d140f4641a68307', 'app.default_service_periods: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_date' and pronamespace = 'app'::regnamespace), '1,091124d73dbb308b0915f7738e72e53c', 'app.business_date: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'business_day_cutoff' and pronamespace = 'app'::regnamespace), '1,fc1b2056218acfc22e97b49e39adc7a0', 'app.business_day_cutoff: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'tenant_has_operational_data' and pronamespace = 'app'::regnamespace), '1,c5bb9875af9aae5b14b31a062d486c83', 'app.tenant_has_operational_data: one definition, unchanged (saved settings count as data through the purge list)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'open_table' and pronamespace = 'public'::regnamespace), '1,f85ea9303f6c1be6184a940d75f4c0fe', 'public.open_table: one definition, re-pinned on purpose to the A7b text (adds table_joined, Q-R6; pgTAP 296b proves the behaviour)');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'tables_list' and pronamespace = 'public'::regnamespace), '1,f9dc48f18477964c93416dcc1f9cfdbe', 'public.tables_list: one definition, re-pinned on purpose to the A7b text (adds the joined status and joinedTo.overtime for the booking seated on the lead''s open session, lead 2026-11-08; re-pinned again on purpose after review; pgTAP 296b proves the behaviour)');

-- The only anon-executable functions are the five public wrappers -----------------------------------------------------------------------------------------------------------------
select is((select array_agg(p.pronamespace::regnamespace::text || '.' || p.proname order by p.proname) from pg_proc p
            where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and has_function_privilege('anon', p.oid, 'execute')
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
          array['public.cancel_reservation', 'public.request_reservation', 'public.reservation_cancel_view', 'public.reservation_page', 'public.reservation_slots'],
          'the only functions in public or app that anon can execute are the five anon wrappers of B1 and B2');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and has_function_privilege('anon', p.oid, 'execute')), 0, 'anon can execute nothing in the app schema');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
            and p.proname ~ 'reserv|request_invalid|cancel_reservation'), 0, 'and no API role can execute an app function of the feature');
select is((select count(*)::int from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p', 'S')
            and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')), 0, 'anon has no privilege on any table, view or sequence in public or app');
-- Supabase grants anon ALL on new public sequences by default; 20261128100400 removes that default for postgres (the migrations' role).
-- The three checks below read every default ACL entry of postgres, the role every migration runs as: the global entry (defaclnamespace = 0) and the
-- per-schema entries of public and app, so a later `alter default privileges` cannot hand anon a new object of ours unnoticed. supabase_admin's
-- entries are Supabase's own (they grant anon on objects supabase_admin creates, never ours) and no migration can change them, so they are out of scope.
select is((select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
            where d.defaclrole = 'postgres'::regrole and d.defaclnamespace in (0::oid, 'public'::regnamespace, 'app'::regnamespace) and d.defaclobjtype = 'S'
              and a.grantee = 'anon'::regrole), 0, 'no default privilege, global or in public or app, for postgres, gives anon a new sequence');
-- Lead's read of #69: no default privilege may give anon a new table, sequence or function, so a later migration that forgets its revoke stays closed (20261128100500).
select is((select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
            where d.defaclrole = 'postgres'::regrole and d.defaclnamespace in (0::oid, 'public'::regnamespace, 'app'::regnamespace)
              and d.defaclobjtype in ('r', 'S', 'f') and a.grantee = 'anon'::regrole), 0,
          'no default privilege, global or in public or app, for postgres, gives anon a new table, sequence or function');
select is((select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
            where d.defaclrole = 'postgres'::regrole and d.defaclnamespace in (0::oid, 'public'::regnamespace, 'app'::regnamespace)
              and d.defaclobjtype = 'f' and a.grantee = 0), 0,
          'no default ACL entry, global or in public or app, for postgres, grants PUBLIC execute on functions (the built-in PUBLIC execute is not a pg_default_acl entry and is covered by the anon-executable list above; a postgres default grant on functions that keeps PUBLIC fails here too, so revoke it from public in the same statement)');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname ~ 'reservation|table_group|dining_table_booking'
            and has_table_privilege('service_role', c.oid, 'insert,update,delete,truncate')), 0, 'service_role writes no reservation table directly (PR1: select only)');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ 'reserv' and has_function_privilege('service_role', p.oid, 'execute')),
          array['reservation_mail_claim', 'reservation_mail_finish'], 'the reservation functions service_role can execute are exactly the two mail functions');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ 'reserv|table_group|table_booking|staff_reservation|request_reservation|cancel_reservation'
            and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))), 0, 'every public function of the feature is a definer with an empty search_path');

-- Cron jobs, job check, tables -------------------------------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(jobname, ',' order by jobname) from cron.job),
          'alert-rules,auth-purge,extract-invoices,kpi-rollup,ledger-invariants,reservation-mail,reservation-retention', 'the cron jobs are the PR1 list plus reservation-mail and reservation-retention');
select is((select schedule from cron.job where jobname = 'reservation-mail') || '|' || (select schedule from cron.job where jobname = 'reservation-retention'), '* * * * *|20 3 * * *', 'at * * * * * and 20 3 * * *');
select is((select md5(regexp_replace(pg_get_constraintdef(oid), ', ''reservation-(mail|retention)''::text', '', 'g')) from pg_constraint where conname = 'job_run_job_check'), '9a60b99c761a655c11433a7c2121a61a', 'job_run_job_check is the PR1 list');
select is((select pg_get_constraintdef(oid) ~ 'reservation-mail.*reservation-retention' from pg_constraint where conname = 'job_run_job_check'), true, 'plus the two reservation jobs');
select is((select count(*)::int from pg_tables where schemaname = 'public' and tablename ~ 'reservation|table_group|dining_table_booking'), 9, 'the nine reservation tables of PR1 are still the only ones (PR2 adds no table)');
select is((select count(*)::int from pg_tables where schemaname = 'app' and tablename ~ 'reserv'), 1, 'and app.reservation_throttle the only app table');
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still has 15 kinds (PR2 adds none)');

select * from finish();
rollback;
