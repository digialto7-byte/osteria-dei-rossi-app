-- M13 step 10: M13 added functions and replaced none of the M6-M12 ones it builds on. The stock engine and the
-- procedures it reuses (post_stock_outflow, post_transfer, reverse_movement), the alert pipeline (raise_alert,
-- try_raise_alert, alert_rules_body, run_alert_rules) and approve_invoice are pinned by the md5 of
-- pg_get_functiondef under an empty search_path (the technique of 076 and 098), computed on a database migrated to
-- 20261026100900 only (the last M12 migration); it must be the same on the full chain. 060, 075, 076 and 098 run unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.fn(p_schema text, p_name text) returns oid language sql stable as $$
  select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = p_schema and p.proname = p_name $$;

set local search_path = '';
create temp table pin_md5 on commit drop as
select 'post_stock_outflow' as k,
       md5(pg_get_functiondef('app.post_stock_outflow(uuid, uuid, uuid, uuid, numeric, public.stock_movement_type, text, uuid, text, uuid, timestamptz, timestamptz, text)'::regprocedure)) as h
union all select 'post_transfer', md5(pg_get_functiondef('public.post_transfer(uuid, numeric, text, uuid, uuid, uuid)'::regprocedure))
union all select 'reverse_movement', md5(pg_get_functiondef('public.reverse_movement(uuid)'::regprocedure))
union all select 'raise_alert', md5(pg_get_functiondef(pg_temp.fn('app', 'raise_alert')))
union all select 'try_raise_alert', md5(pg_get_functiondef(pg_temp.fn('app', 'try_raise_alert')))
union all select 'alert_rules_body', md5(pg_get_functiondef('app.alert_rules_body(timestamptz)'::regprocedure))
union all select 'run_alert_rules', md5(pg_get_functiondef('app.run_alert_rules(timestamptz)'::regprocedure))
union all select 'approve_invoice', md5(pg_get_functiondef('public.approve_invoice(uuid, uuid)'::regprocedure));
set local search_path = "$user", public, extensions;

select is((select h from pin_md5 where k = 'post_stock_outflow'), 'b50e1690b47e3b3f89dd1da533c59463',
  'app.post_stock_outflow is the M12 definition (md5)');
select is((select h from pin_md5 where k = 'post_transfer'), '7c0272c203f4fb83a959a0e1769f76ef', 'public.post_transfer is the M12 definition (md5)');
select is((select h from pin_md5 where k = 'reverse_movement'), '86315a44ad8596241d21beab13ec00ab', 'public.reverse_movement is the M12 definition (md5)');
select is((select h from pin_md5 where k = 'raise_alert'), '4cb45fc51c5fefa12eaa9945942ceb23', 'app.raise_alert is the M12 definition (md5)');
select is((select h from pin_md5 where k = 'try_raise_alert'), '5894b65bd641b328301b72a9bc30b282', 'app.try_raise_alert is the M8 definition (md5)');
select is((select h from pin_md5 where k = 'alert_rules_body'), '0cfd0da52e449cecac5895eaea41ab75', 'app.alert_rules_body is the M9 definition (md5)');
select is((select h from pin_md5 where k = 'run_alert_rules'), '911fe833b447c706107f25d74cd15304', 'app.run_alert_rules is the M6 definition (md5)');
select is((select h from pin_md5 where k = 'approve_invoice'), '6b4682a200fa7d7ad6cf848f37556812', 'public.approve_invoice is the M8 definition (md5)');

-- One definition of each (no overload, no second copy).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('app', 'post_stock_outflow'), ('public', 'post_transfer'), ('public', 'reverse_movement'),
                                             ('app', 'raise_alert'), ('app', 'try_raise_alert'), ('app', 'alert_rules_body'),
                                             ('app', 'run_alert_rules'), ('public', 'approve_invoice'))),
  8, 'the eight pinned functions have one definition each');

-- The nightly check is a separate job: it does not touch the hourly one.
select is((select count(*)::int from cron.job where jobname in ('extract-invoices', 'alert-rules', 'ledger-invariants')), 3,
  'the three scheduled jobs are registered');
select ok(pg_get_functiondef(pg_temp.fn('app', 'run_alert_rules')) !~ 'ledger',
  'run_alert_rules does not mention the invariant check');

select * from finish();
rollback;
