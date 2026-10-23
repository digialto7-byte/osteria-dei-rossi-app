-- M9 step 9: after merging main (M8 food cost) into M9, prove that M9's migrations kept M8's work.
-- approve_invoice still runs the contained price variance check after the ingredient cost locks,
-- the variance check still raises through try_raise_alert, the refusal record has no API-role access,
-- the M6 rules runner still calls the replaceable body, and the audit check accepts M8's and M9's actions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.fn(p_schema text, p_name text) returns oid
  language sql stable
as $$
  select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name
$$;

create function pg_temp.src(p_schema text, p_name text) returns text
  language sql stable
as $$ select pg_get_functiondef(pg_temp.fn(p_schema, p_name)) $$;

-- approve_invoice (M5, extended by M8).
select ok(pg_temp.src('public', 'approve_invoice') ~ 'app\.lock_ingredient_costs\(',
  'approve_invoice still takes the ingredient cost locks (M8)');
select ok(pg_temp.src('public', 'approve_invoice') ~ 'app\.price_variance_check\(',
  'approve_invoice still runs the price variance check (M8)');
select ok(pg_temp.src('public', 'approve_invoice')
            ~ 'app\.price_variance_check\([^;]*;.*exception\s+when\s+others',
  'and the check sits in a block with an exception when others handler');
select ok(position('app.lock_ingredient_costs(' in pg_temp.src('public', 'approve_invoice'))
            < position('app.price_variance_check(' in pg_temp.src('public', 'approve_invoice')),
  'the locks are taken before the check');

-- price_variance_check raises through try_raise_alert (M8 110800).
select ok(pg_temp.src('app', 'price_variance_check') ~ 'app\.try_raise_alert\(',
  'price_variance_check raises through app.try_raise_alert');
select ok(pg_temp.src('app', 'price_variance_check') !~ 'app\.raise_alert\(',
  'and never calls app.raise_alert directly');

-- try_raise_alert, record_alert_refusal and alert_refusal exist with no API-role privilege.
select isnt(pg_temp.fn('app', 'try_raise_alert'), null, 'app.try_raise_alert exists');
select isnt(pg_temp.fn('app', 'record_alert_refusal'), null, 'app.record_alert_refusal exists');
select has_table('app', 'alert_refusal', 'app.alert_refusal exists');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
                unnest(array['try_raise_alert', 'record_alert_refusal']) f(name)
           where has_function_privilege(r.role, pg_temp.fn('app', f.name), 'execute')),
  0, 'no API role can execute try_raise_alert or record_alert_refusal');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
                unnest(array['select', 'insert', 'update', 'delete']) p(priv)
           where has_table_privilege(r.role, 'app.alert_refusal', p.priv)),
  0, 'no API role has any privilege on app.alert_refusal');

-- M6 rules runner: unchanged contract.
select ok(pg_temp.src('app', 'run_alert_rules') ~ 'app\.alert_rules_body\(',
  'app.run_alert_rules still calls app.alert_rules_body');
select ok(pg_temp.src('app', 'run_alert_rules') ~ 'rule_failed',
  'and still records rule_failed');

-- The audit check accepts M8's and M9's actions and entity types.
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_event_action_check'))
            ~ 'tenant\.settings_changed',
  'the audit action check accepts tenant.settings_changed (M8)');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_event_action_check'))
            ~ 'payable\.status_changed' and
          pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_event_action_check'))
            ~ 'payable\.payment_reversed',
  'and the M9 payable actions');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_event_entity_type_check'))
            ~ '''tenant''' and
          pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_event_entity_type_check'))
            ~ '''payable''',
  'the audit entity type check accepts tenant (M8) and payable (M9)');

-- M9 replaces none of the functions M8 owns (the grep in the PR covers the migration files too).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('public', 'approve_invoice'), ('app', 'price_variance_check'),
                                             ('app', 'try_raise_alert'), ('app', 'run_alert_rules'))),
  4, 'each guarded function has exactly one definition (no overload added by M9)');

select * from finish();
rollback;
