-- Demo data step 5 (ADR-018, plan §3.9): what this branch must NOT change, and what a future milestone must not forget.
--  * every BEFORE DELETE trigger on a tenant table runs app.append_only or a function that honours app.demo_purge_allows, so a
--    new guard that ignores the demo purge fails here (and a purge would fail on it);
--  * the TRUNCATE guard and the procedures the demo relies on are the ones from before this branch (their source digests are
--    pinned; a milestone that deliberately changes one updates the digest in its own migration's test);
--  * each of those procedures still has exactly one definition (nothing was replaced by a copy).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Delete guards -------------------------------------------------------------------------------------------------------------------------
create temp table delete_guards as
  select c.relname::text as tbl, p.oid::regprocedure::text as fn, p.prosrc
    from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = g.tgfoid
   where n.nspname = 'public' and not g.tgisinternal
     and (g.tgtype & 1) <> 0 and (g.tgtype & 2) <> 0 and (g.tgtype & 8) <> 0
     and exists (select 1 from information_schema.columns col
                  where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id');

select cmp_ok((select count(*)::int from delete_guards), '>=', 25, 'the catalog scan finds the delete guards of the ledger and staff-login tables (not vacuous)');
select is_empty(
  $$ select tbl || ' ' || fn from delete_guards
      where fn <> 'app.append_only()' and prosrc not like '%app.demo_purge_allows%' $$,
  'every BEFORE DELETE row trigger on a tenant table is app.append_only or calls app.demo_purge_allows');
select is((select array_agg(distinct fn order by fn) from delete_guards where fn <> 'app.append_only()'),
          array['app.auth_attempt_guard()', 'app.device_guard()', 'app.enrolment_guard()', 'app.staff_session_guard()'],
          'the only other delete guards are the four staff-login ones');
select is((select array_agg(tbl order by tbl) from delete_guards
            where tbl in ('dining_table', 'menu_item', 'menu_item_price', 'sale_settings', 'table_session') and fn = 'app.append_only()'),
          array['dining_table', 'menu_item', 'menu_item_price', 'sale_settings', 'table_session'],
          'the five M17 tables are guarded by app.append_only, which honours the demo purge (no M17 guard needed a new branch)');
select ok((select prosrc like '%app.demo_purge_allows%' from pg_proc where oid = 'app.append_only()'::regprocedure), 'app.append_only honours the demo purge');
select is((select count(*)::int from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and not g.tgisinternal and (g.tgtype & 32) <> 0 and (g.tgtype & 1) = 0
              and g.tgfoid not in ('app.append_only_truncate()'::regprocedure, 'app.auth_table_no_truncate()'::regprocedure)), 0,
          'every TRUNCATE trigger on a public table still uses one of the two TRUNCATE guards');

-- Pinned digests (unchanged by this branch) ----------------------------------------------------------------------------------------
select is((select md5(prosrc) from pg_proc where oid = 'app.append_only_truncate()'::regprocedure), 'e1c096fa4bd3a8d77f42a75b92d6cd53', 'app.append_only_truncate is unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'approve_invoice' and pronamespace = 'public'::regnamespace), '1,ee093461349c9ee3574d560b5b4b7859', 'approve_invoice: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'extraction_complete' and pronamespace = 'public'::regnamespace), '1,6cb0b3efb41fd011b12e753f58c44a1a', 'extraction_complete: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'produce_batch' and pronamespace = 'public'::regnamespace), '1,02fef96a8ae90cb4a5adacb046c7b706', 'produce_batch: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'run_alert_rules' and pronamespace = 'app'::regnamespace), '1,ff878123053f643e184b4a6dd537bb27', 'run_alert_rules: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'alert_rules_body' and pronamespace = 'app'::regnamespace), '1,08aaae27b0d5cb145945353af5e7662a', 'alert_rules_body: one definition, unchanged');
select is((select count(*)::int || ',' || min(md5(prosrc)) from pg_proc where proname = 'ledger_checks_body' and pronamespace = 'app'::regnamespace), '1,59d3bb25edc1aff3a3c94354aac3df25', 'ledger_checks_body (the nightly invariant check): one definition, unchanged');
select is((select count(*)::int from pg_proc where proname in ('create_demo_tenant', 'demo_stage_invoice', 'purge_demo_tenant', 'purge_demo_tenant_by_id', 'demo_purge_pending', 'demo_purge_cleanup_done', 'demo_tenant_status', 'demo_tenant_row_counts') and pronamespace = 'public'::regnamespace), 8, 'the eight public functions of this branch exist once each');

select * from finish();
rollback;
