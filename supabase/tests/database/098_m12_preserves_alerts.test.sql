-- M12 step 9: M12 replaced exactly one function of the alert pipeline, app.raise_alert (the chef-payload allow-list,
-- appended as the LAST guard), and none of the others. approve_invoice, price_variance_check and try_raise_alert are
-- pinned by md5 in 076, run_alert_rules in 075; this file pins alert_rules_body, checks that nothing was overloaded,
-- that raise_alert kept every older guard in its old order with the new one after them, and that M12 raises its
-- alert only through try_raise_alert.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create function pg_temp.fn(p_schema text, p_name text) returns oid language sql stable as $$
  select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = p_schema and p.proname = p_name $$;
create function pg_temp.src(p_schema text, p_name text) returns text language sql stable as $$
  select pg_get_functiondef(pg_temp.fn(p_schema, p_name)) $$;

-- alert_rules_body (M9, 20261024100300). The md5 of pg_get_functiondef under an empty search_path was computed on a
-- database migrated to 20261024100500 only; it must be the same on the full chain (the technique of 076).
set local search_path = '';
create temp table pin_md5 on commit drop as
select 'alert_rules_body' as k, md5(pg_get_functiondef('app.alert_rules_body(timestamptz)'::regprocedure)) as h;
set local search_path = "$user", public, extensions;
select is((select h from pin_md5 where k = 'alert_rules_body'), '0cfd0da52e449cecac5895eaea41ab75',
  'app.alert_rules_body is the M9 definition of 20261024100300 (md5)');
select ok(pg_temp.src('app', 'run_alert_rules') ~ 'app\.alert_rules_body\(', 'app.run_alert_rules still calls app.alert_rules_body');
select ok(pg_temp.src('app', 'run_alert_rules') ~ 'rule_failed', 'and still records rule_failed');

-- Exactly one definition of each (no overload, no second copy).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('public', 'approve_invoice'), ('app', 'price_variance_check'), ('app', 'try_raise_alert'),
                                             ('app', 'run_alert_rules'), ('app', 'alert_rules_body'), ('app', 'raise_alert'))),
  6, 'approve_invoice, price_variance_check, try_raise_alert, run_alert_rules, alert_rules_body and raise_alert: one definition each');
select ok(position('app.lock_ingredient_costs(' in pg_temp.src('public', 'approve_invoice')) > 0
          and position('app.lock_ingredient_stock(' in pg_temp.src('public', 'approve_invoice')) = 0,
  'approve_invoice takes the cost locks and, as planned, no stock lock (the accepted receipt-vs-consumption limit)');

-- raise_alert: the older guards in their older order, the new one after all of them.
create function pg_temp.pos(p_code text) returns int language sql stable as $$
  select position(p_code in pg_temp.src('app', 'raise_alert')) $$;
select ok(pg_temp.pos('unknown_alert_kind') > 0 and pg_temp.pos('unknown_alert_kind') < pg_temp.pos('tenant_not_found')
          and pg_temp.pos('tenant_not_found') < pg_temp.pos('alert_audience_invalid')
          and pg_temp.pos('alert_audience_invalid') < pg_temp.pos('alert_audience_cost')
          and pg_temp.pos('alert_audience_cost') < pg_temp.pos('alert_payload_cost_key')
          and pg_temp.pos('alert_payload_cost_key') < pg_temp.pos('alert_payload_invalid')
          and pg_temp.pos('alert_payload_invalid') < pg_temp.pos('alert_payload_cost_value'),
  'raise_alert keeps the seven older refusals in their M6 order');
select ok(pg_temp.pos('alert_payload_cost_value') < pg_temp.pos('alert_payload_not_allowed')
          and pg_temp.pos('alert_payload_not_allowed') < pg_temp.pos('alert_business_date'),
  'and the allow-list guard comes after all of them and before the insert');
select ok(pg_temp.src('app', 'raise_alert') ~ 'app\.chef_payload_allowed\(p_payload\)', 'the new guard calls app.chef_payload_allowed');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = pg_temp.fn('app', 'raise_alert')),
  'raise_alert is still security definer with an empty search_path');
select is_empty($$ select r.rolname from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
    where p.oid = pg_temp.fn('app', 'raise_alert') and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'and still executable by no API role');

-- M12 raises its alert only through try_raise_alert (a refusal never undoes a movement).
select ok(pg_temp.src('app', 'raise_negative_stock') ~ 'app\.try_raise_alert\(' and pg_temp.src('app', 'raise_negative_stock') !~ 'app\.raise_alert\(',
  'raise_negative_stock calls try_raise_alert and never raise_alert');
select ok(pg_temp.src('app', 'post_stock_outflow') ~ 'exception\s+when\s+others\s+then\s+perform\s+app\.record_alert_refusal\(',
  'the engine contains the negative check in a block with an exception when others handler');
select ok(position('app.raise_negative_stock(' in pg_temp.src('app', 'post_stock_outflow')) > position('insert into public.stock_movement' in pg_temp.src('app', 'post_stock_outflow')),
  'and runs it after the inserts');
select ok(pg_temp.src('app', 'post_stock_outflow') !~ 'app\.(try_)?raise_alert\(', 'the engine never calls the alert functions outside that block');

select * from finish();
rollback;
