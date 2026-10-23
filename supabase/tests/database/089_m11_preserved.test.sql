-- M11 step 10: M11 must not replace any M5-M9 function it does not own. alert_rules_body (where M9's payable
-- rules live) and run_alert_rules are the final M9 definitions; approve_invoice, price_variance_check and
-- try_raise_alert keep their single definition (their exact pins are in 076). The device_locked alert is raised
-- inside pin_login_finish, so no hourly rule was added and nothing here was touched.
-- The md5 values were computed on main 7ce60fe (migrations up to 20261024100500) and are the same on the full
-- chain. A later migration that replaces alert_rules_body changes the hash and fails here: re-pin it on
-- purpose, with the review that goes with it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- pg_get_functiondef prints types schema-qualified or not depending on the search_path: hash under an empty one
-- (pgTAP needs the normal path, so the hashes go to a temp table and are compared after).
set local search_path = '';
create temp table pin_md5 on commit drop as
select 'alert_rules_body' as k, md5(pg_get_functiondef('app.alert_rules_body(timestamptz)'::regprocedure)) as h;
set local search_path = "$user", public, extensions;

select is((select h from pin_md5 where k = 'alert_rules_body'), '0cfd0da52e449cecac5895eaea41ab75',
  'app.alert_rules_body is the M9 definition on main 7ce60fe (md5 of pg_get_functiondef)');
select is((select md5(prosrc) from pg_proc where oid = 'app.run_alert_rules(timestamptz)'::regprocedure),
  'ff878123053f643e184b4a6dd537bb27', 'app.run_alert_rules is the M6 body, as 075 pins it (md5 of prosrc)');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'approve_invoice'), 1, 'approve_invoice has one definition');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname = 'price_variance_check'), 1, 'price_variance_check has one definition');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname = 'try_raise_alert'), 1, 'try_raise_alert has one definition');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname = 'alert_rules_body'), 1, 'alert_rules_body has one definition');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname = 'run_alert_rules'), 1, 'run_alert_rules has one definition');

-- The registry has no hourly rule for device_locked: the kind is raised only by pin_login_finish.
select ok(pg_get_functiondef('app.alert_rules_body(timestamptz)'::regprocedure) !~ 'device_locked',
  'alert_rules_body does not mention device_locked (no hourly rule)');
select ok(pg_get_functiondef('app.lock_device_if_needed(uuid,timestamptz)'::regprocedure) ~ 'app\.try_raise_alert\('
      and pg_get_functiondef('app.lock_device_if_needed(uuid,timestamptz)'::regprocedure) !~ 'app\.raise_alert\(',
  'the device lock raises through app.try_raise_alert');

select * from finish();
rollback;
