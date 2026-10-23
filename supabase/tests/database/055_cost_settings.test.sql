-- M8 step 1: cost settings, the ingredient cost basis history and fixed costs (M8 plan §3.1.3,
-- §3.1.7, §3.1.8, §3.2; ADR-008). Owner and admin read and write; the chef and the waiter get 42501
-- from every procedure and 0 rows from both tables (Q16 = V6). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(116);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Supporto Demo');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg'),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'pz'),
  ('1e000000-0000-4000-8000-00000000001e', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- 'ok', or 'SQLSTATE message | detail'.
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' | ' || nullif(det, ''), '');
end
$$;
create function pg_temp.upd(p_patch text) returns text language sql as $$
  select pg_temp.err(format('select public.update_cost_settings(%L::jsonb)', p_patch)) $$;
create function pg_temp.fc(p_month date, p_rent numeric, p_labour numeric, p_util numeric) returns text
  language sql as $$
  select pg_temp.err(format('select public.enter_fixed_costs(%L, %s, %s, %s)', p_month,
    coalesce(p_rent::text, 'null'), coalesce(p_labour::text, 'null'), coalesce(p_util::text, 'null'))) $$;
create function pg_temp.basis(p_ing uuid, p_basis text) returns text language sql as $$
  select pg_temp.err(format('select public.set_ingredient_cost_basis(%L, %L)', p_ing, p_basis)) $$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text), pg_temp.upd(text),
  pg_temp.fc(date, numeric, numeric, numeric), pg_temp.basis(uuid, text) to authenticated, anon;

-- Current month in Rome (the first day), so the cases do not depend on the date the suite runs.
create function pg_temp.this_month() returns date language sql as $$
  select date_trunc('month', (now() at time zone 'Europe/Rome'))::date $$;
grant execute on function pg_temp.this_month() to authenticated;

-- 1. app.cost_settings: defaults on an empty settings object, unknown tenant.
select results_eq(
  $$ select * from app.cost_settings('11111111-1111-4111-8111-111111111111') $$,
  $$ values (3, 10::numeric, 10::numeric) $$,
  'a tenant with empty settings has the defaults: 3 purchases, 10 % variance, 10 % VAT');
select throws_ok(
  $$ select * from app.cost_settings('99999999-9999-4999-8999-999999999999') $$,
  'P0002', 'tenant_not_found', 'an unknown tenant is P0002');

-- 2. Roles and tenant helpers are in place and closed to the API roles.
select is_empty(
  $$ select f.fn from (values
       ('app.cost_settings(uuid)'), ('app.require_cost_reader()'), ('app.require_margin_reader()'),
       ('app.lock_ingredient_costs(uuid, uuid[])')) f (fn)
      cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, f.fn, 'execute') $$,
  'no API role can execute the app.* helpers of this step');
select is_empty(
  $$ select f.fn || ' ' || r.rolname from (values
       ('public.cost_settings()'), ('public.update_cost_settings(jsonb)'),
       ('public.set_ingredient_cost_basis(uuid, public.cost_basis)'),
       ('public.enter_fixed_costs(date, numeric, numeric, numeric)')) f (fn)
      cross join (values ('anon'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, f.fn, 'execute') $$,
  'anon and service_role cannot execute the public procedures');
select is(
  (select count(*)::int from (values
       ('public.cost_settings()'), ('public.update_cost_settings(jsonb)'),
       ('public.set_ingredient_cost_basis(uuid, public.cost_basis)'),
       ('public.enter_fixed_costs(date, numeric, numeric, numeric)')) f (fn)
     where has_function_privilege('authenticated', f.fn, 'execute')), 4,
  'authenticated can execute the four public procedures');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
        and p.proname in ('cost_settings', 'update_cost_settings', 'set_ingredient_cost_basis',
                          'enter_fixed_costs', 'lock_ingredient_costs', 'require_cost_reader',
                          'require_margin_reader')
        and not (p.proconfig @> array['search_path=""']) $$,
  'every function of this step has an empty search_path');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('cost_settings', 'update_cost_settings', 'set_ingredient_cost_basis',
                          'enter_fixed_costs')
        and not p.prosecdef $$,
  'the four public procedures are security definer');

-- 3. Settings as the owner.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(public.cost_settings(), '{"avgCostN":3,"priceVariancePct":10,"saleVatPct":10}'::jsonb,
  'the owner reads the defaults');
select is(public.update_cost_settings('{"price_variance_pct":5}'),
  '{"avgCostN":3,"priceVariancePct":5,"saleVatPct":10}'::jsonb,
  'the owner changes the alert threshold to 5');
select is((select count(*)::int from public.audit_event where action = 'tenant.settings_changed'), 1,
  'one audit event for the change');
select is((select before from public.audit_event where action = 'tenant.settings_changed'),
  '{"price_variance_pct":10}'::jsonb, 'the audit event holds the changed key before (the default 10)');
select is((select after from public.audit_event where action = 'tenant.settings_changed'),
  '{"price_variance_pct":5}'::jsonb, 'and after');
select is((select entity_type || ' ' || entity_id from public.audit_event where action = 'tenant.settings_changed'),
  'tenant 11111111-1111-4111-8111-111111111111', 'the audit event is about the tenant');
select is(pg_temp.upd('{"price_variance_pct":5}'), 'ok', 'the same patch again is accepted');
select is((select count(*)::int from public.audit_event where action = 'tenant.settings_changed'), 1,
  'and writes no second audit event');
select is(pg_temp.upd('{"price_variance_pct":5.00,"sale_vat_pct":10}'), 'ok', 'values equal to the effective ones');
select is((select count(*)::int from public.audit_event where action = 'tenant.settings_changed'), 1,
  'are not a change either (a default written explicitly is the default)');
select is(pg_temp.upd('{}'), 'ok', 'an empty patch is accepted');

-- Validation: ranges and types.
select is(pg_temp.upd('{"avg_cost_n":0}'),
  'P0001 settings_invalid | [{"code": "out_of_range", "field": "avg_cost_n"}]', 'avg_cost_n 0 is out of range');
select is(pg_temp.upd('{"avg_cost_n":11}'),
  'P0001 settings_invalid | [{"code": "out_of_range", "field": "avg_cost_n"}]', 'avg_cost_n 11 is out of range');
select is(pg_temp.upd('{"avg_cost_n":2.5}'),
  'P0001 settings_invalid | [{"code": "invalid_value", "field": "avg_cost_n"}]', 'avg_cost_n 2.5 is not an integer');
select is(pg_temp.upd('{"avg_cost_n":"3"}'),
  'P0001 settings_invalid | [{"code": "invalid_value", "field": "avg_cost_n"}]', 'a string is not a number');
select is(pg_temp.upd('{"avg_cost_n":null}'),
  'P0001 settings_invalid | [{"code": "invalid_value", "field": "avg_cost_n"}]', 'null is not a value');
select is(pg_temp.upd('{"price_variance_pct":0.99}'),
  'P0001 settings_invalid | [{"code": "out_of_range", "field": "price_variance_pct"}]', 'threshold below 1');
select is(pg_temp.upd('{"price_variance_pct":100.01}'),
  'P0001 settings_invalid | [{"code": "out_of_range", "field": "price_variance_pct"}]', 'threshold above 100');
select is(pg_temp.upd('{"price_variance_pct":5.555}'),
  'P0001 settings_invalid | [{"code": "invalid_value", "field": "price_variance_pct"}]', 'more than two decimals');
select is(pg_temp.upd('{"sale_vat_pct":31}'),
  'P0001 settings_invalid | [{"code": "out_of_range", "field": "sale_vat_pct"}]', 'VAT above 30');
select is(pg_temp.upd('{"sale_vat_pct":-1}'),
  'P0001 settings_invalid | [{"code": "out_of_range", "field": "sale_vat_pct"}]', 'VAT below 0');
select is(pg_temp.upd('{"sale_vat_pct":0}'), 'ok', 'VAT 0 is allowed (boundary)');
select is(pg_temp.upd('{"sale_vat_pct":10}'), 'ok', 'and back to 10');
select is(pg_temp.upd('{"avg_cost_n":10,"price_variance_pct":100,"sale_vat_pct":30}'), 'ok',
  'the upper boundaries are allowed');
select is(pg_temp.upd('{"avg_cost_n":3,"price_variance_pct":5,"sale_vat_pct":10}'), 'ok', 'and back');
select is(pg_temp.upd('{"fixed_cost_basis":"x"}'),
  'P0001 settings_invalid | [{"code": "unknown_field", "field": "fixed_cost_basis"}]', 'an unknown key is refused');
select is(pg_temp.upd('[1]'),
  'P0001 settings_invalid | [{"code": "invalid_value", "field": ""}]', 'a patch that is not an object is refused');
select is(pg_temp.upd('{"avg_cost_n":0,"nope":1}'),
  'P0001 settings_invalid | [{"code": "out_of_range", "field": "avg_cost_n"}, {"code": "unknown_field", "field": "nope"}]',
  'every error is listed, in key order');
select is(public.cost_settings() ->> 'priceVariancePct', '5', 'refused patches changed nothing');

-- Other keys already in tenant.settings are kept.
reset role;
update public.tenant set settings = '{"keep":true}' where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.upd('{"avg_cost_n":4}'), 'ok', 'a patch on settings with a foreign key');
reset role;
select is((select settings from public.tenant where id = '11111111-1111-4111-8111-111111111111'),
  '{"keep":true,"avg_cost_n":4}'::jsonb, 'merges and keeps the other keys');
-- A stored value of the wrong type falls back to the default (never an error on read).
update public.tenant set settings = '{"avg_cost_n":"x","price_variance_pct":null}'
 where id = '11111111-1111-4111-8111-111111111111';
select results_eq(
  $$ select * from app.cost_settings('11111111-1111-4111-8111-111111111111') $$,
  $$ values (3, 10::numeric, 10::numeric) $$, 'garbage stored values read as the defaults');
update public.tenant set settings = '{"price_variance_pct":5}' where id = '11111111-1111-4111-8111-111111111111';

-- Admin may; chef, waiter and the unauthenticated may not.
set local role authenticated;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.upd('{"avg_cost_n":4}'), 'ok', 'the admin changes a rule');
select is(public.cost_settings() ->> 'avgCostN', '4', 'and reads it');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select alike(pg_temp.upd('{"avg_cost_n":5}'), '42501 %', 'the chef cannot change a rule');
select alike(pg_temp.err('select public.cost_settings()'), '42501 %', 'the chef cannot read the rules');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select alike(pg_temp.upd('{"avg_cost_n":5}'), '42501 %', 'the waiter cannot change a rule');
select alike(pg_temp.err('select public.cost_settings()'), '42501 %', 'the waiter cannot read the rules');
select set_config('request.jwt.claims', '', true);
select alike(pg_temp.upd('{"avg_cost_n":5}'), '42501 %', 'a session without claims cannot change a rule');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(public.cost_settings(), '{"avgCostN":3,"priceVariancePct":10,"saleVatPct":10}'::jsonb,
  'owner B reads the defaults of tenant B, not the rules of tenant A');
reset role;
set local role anon;
select alike(pg_temp.upd('{"avg_cost_n":5}'), '42501 %', 'anon cannot execute the procedure');
reset role;
select results_eq($$ select (settings ->> 'avg_cost_n')::int from public.tenant
  where id = '11111111-1111-4111-8111-111111111111' $$, $$ values (4) $$, 'tenant A kept the admin''s value');

-- 4. Ingredient cost basis: an append-only history.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.basis('1b000000-0000-4000-8000-00000000001b', 'moving_average'), 'ok', 'moving_average when nothing is stored');
select is((select count(*)::int from public.ingredient_cost_basis), 0, 'is the default and stores no row');
select is(public.set_ingredient_cost_basis('1b000000-0000-4000-8000-00000000001b', 'moving_average') ->> 'validFrom', null,
  'and has no validFrom');
select is(public.set_ingredient_cost_basis('1a000000-0000-4000-8000-00000000001a', 'last_price') ->> 'basis', 'last_price',
  'the owner sets last_price');
select is((select count(*)::int from public.ingredient_cost_basis), 1, 'one history row');
select isnt((select valid_from from public.ingredient_cost_basis), null, 'with a valid_from');
select is(public.set_ingredient_cost_basis('1a000000-0000-4000-8000-00000000001a', 'last_price') ->> 'validFrom',
  (select to_json(valid_from)#>>'{}' from public.ingredient_cost_basis),
  'the same basis again returns the row in force');
select is((select count(*)::int from public.ingredient_cost_basis), 1, 'and writes no new row');
select is(pg_temp.basis('1a000000-0000-4000-8000-00000000001a', 'moving_average'), 'ok', 'switching back');
select is(pg_temp.basis('1a000000-0000-4000-8000-00000000001a', 'last_price'), 'ok', 'and forth in one transaction');
select is((select count(*)::int from public.ingredient_cost_basis), 3, 'three rows');
select ok((select bool_and(valid_from > prev) from (select valid_from, lag(valid_from) over (order by valid_from) prev
    from public.ingredient_cost_basis) x where prev is not null), 'valid_from strictly increases');
reset role;
-- A clock that ran ahead: the next row is later than the newest one.
insert into public.ingredient_cost_basis (tenant_id, ingredient_id, basis, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1c000000-0000-4000-8000-00000000001c', 'last_price',
          now() + interval '1 hour', 'a1000000-0000-4000-8000-00000000000a');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.basis('1c000000-0000-4000-8000-00000000001c', 'moving_average'), 'ok', 'a change after a row dated in the future');
select is((select valid_from - lag(valid_from) over (order by valid_from)
             from public.ingredient_cost_basis where ingredient_id = '1c000000-0000-4000-8000-00000000001c'
            order by valid_from desc limit 1), interval '1 microsecond',
  'is dated one microsecond after it');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.basis('1b000000-0000-4000-8000-00000000001b', 'last_price'), 'ok', 'the admin sets a basis');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select alike(pg_temp.basis('1a000000-0000-4000-8000-00000000001a', 'moving_average'), '42501 %', 'the chef cannot');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select alike(pg_temp.basis('1a000000-0000-4000-8000-00000000001a', 'moving_average'), '42501 %', 'the waiter cannot');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select alike(pg_temp.basis('1a000000-0000-4000-8000-00000000001a', 'moving_average'), 'P0002 %',
  'owner B cannot touch tenant A''s ingredient (not found)');
select is(pg_temp.basis('1e000000-0000-4000-8000-00000000001e', 'last_price'), 'ok', 'but sets his own');
reset role;
set local role anon;
select alike(pg_temp.basis('1a000000-0000-4000-8000-00000000001a', 'moving_average'), '42501 %', 'anon cannot');
reset role;
select throws_ok($$ update public.ingredient_cost_basis set basis = 'moving_average' $$, 'P0001', 'append_only',
  'the history cannot be updated, even by the table owner');
select throws_ok($$ delete from public.ingredient_cost_basis $$, 'P0001', 'append_only', 'nor deleted');
select throws_ok($$ truncate public.ingredient_cost_basis $$, 'P0001', 'append_only', 'nor truncated');

-- 5. Fixed costs: monthly totals, append-only, the newest row of a month wins.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.fc(pg_temp.this_month(), 3000, 9000, 1500), 'ok', 'the owner enters a month');
select is((select (public.enter_fixed_costs(pg_temp.this_month(), 3000, 9000, 1500) ->> 'total')::numeric), 13500.00,
  'total 13500');
select is((select count(*)::int from public.fixed_cost_period), 1, 'the same figures again (a double tap) write no new row');
select is(public.enter_fixed_costs(pg_temp.this_month(), 3000, 9000, 1500) ->> 'id',
  (select id::text from public.fixed_cost_period), 'and return the same id');
select is(public.enter_fixed_costs(pg_temp.this_month(), 3000, 9000, 1500) - 'id',
  jsonb_build_object('month', pg_temp.this_month(), 'rent', 3000, 'labour', 9000, 'utilities', 1500, 'total', 13500),
  'the result carries month, the three figures and the total');
select is(pg_temp.fc(pg_temp.this_month(), 3000, 9500, 1500), 'ok', 'a correction is a new row');
select is((select count(*)::int from public.fixed_cost_period), 2, 'both rows are kept');
select is(pg_temp.fc(pg_temp.this_month() + 14, 1, 1, 1),
  'P0001 fixed_cost_invalid | [{"code": "month_not_first_day", "field": "month"}]', 'the 15th is not a month');
select is(pg_temp.fc((pg_temp.this_month() + interval '2 months')::date, 1, 1, 1),
  'P0001 fixed_cost_invalid | [{"code": "month_too_far", "field": "month"}]', 'two months ahead is too far');
select is(pg_temp.fc((pg_temp.this_month() + interval '1 month')::date, 1, 1, 1), 'ok', 'next month is allowed');
select is(pg_temp.fc(pg_temp.this_month(), -1, 1, 1),
  'P0001 fixed_cost_invalid | [{"code": "out_of_range", "field": "rent"}]', 'a negative rent');
select is(pg_temp.fc(pg_temp.this_month(), 1, 1000001, 1),
  'P0001 fixed_cost_invalid | [{"code": "out_of_range", "field": "labour"}]', 'labour above 1 000 000');
select is(pg_temp.fc('2020-01-01', 1000000, 0, 0), 'ok', 'the boundaries 1 000 000 and 0 are allowed');
select is(pg_temp.fc('2020-01-01', 1, 1, null),
  'P0001 fixed_cost_invalid | [{"code": "invalid_value", "field": "utilities"}]', 'a missing figure');
select is(pg_temp.fc('2020-02-01', 1.005, 1, 1),
  'P0001 fixed_cost_invalid | [{"code": "invalid_value", "field": "rent"}]', 'three decimals');
select is(pg_temp.fc(null, 1, 1, 1),
  'P0001 fixed_cost_invalid | [{"code": "month_not_first_day", "field": "month"}]', 'a missing month');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.fc('2020-03-01', 100, 100, 100), 'ok', 'the admin enters a month');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select alike(pg_temp.fc('2020-04-01', 100, 100, 100), '42501 %', 'the chef cannot');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select alike(pg_temp.fc('2020-04-01', 100, 100, 100), '42501 %', 'the waiter cannot');
reset role;
set local role anon;
select alike(pg_temp.fc('2020-04-01', 100, 100, 100), '42501 %', 'anon cannot');
reset role;
select throws_ok($$ update public.fixed_cost_period set rent = 1 $$, 'P0001', 'append_only', 'a fixed cost row cannot be updated');
select throws_ok($$ delete from public.fixed_cost_period $$, 'P0001', 'append_only', 'nor deleted');
select throws_ok($$ truncate public.fixed_cost_period $$, 'P0001', 'append_only', 'nor truncated');

-- Owner B enters a month of his own tenant.
set local role authenticated;
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.fc('2020-01-01', 5, 5, 5), 'ok', 'owner B enters a month for tenant B');

-- 6. RLS: owner and admin read both tables; nobody else does.
select is((select count(*)::int from public.fixed_cost_period where tenant_id = '11111111-1111-4111-8111-111111111111'), 0,
  'owner B reads no fixed cost of tenant A');
select is((select count(*)::int from public.ingredient_cost_basis where tenant_id = '11111111-1111-4111-8111-111111111111'), 0,
  'and no basis row of tenant A');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select cmp_ok((select count(*)::int from public.fixed_cost_period), '>', 0, 'owner A reads fixed costs');
select is((select count(*)::int from public.fixed_cost_period where tenant_id <> '11111111-1111-4111-8111-111111111111'), 0,
  'of tenant A only');
select cmp_ok((select count(*)::int from public.ingredient_cost_basis), '>', 0, 'and the basis history');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select cmp_ok((select count(*)::int from public.fixed_cost_period), '>', 0, 'the admin reads fixed costs');
select cmp_ok((select count(*)::int from public.ingredient_cost_basis), '>', 0, 'and the basis history');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select count(*)::int from public.fixed_cost_period), 0, 'the chef reads no fixed cost');
select is((select count(*)::int from public.ingredient_cost_basis), 0, 'and no basis row');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from public.fixed_cost_period), 0, 'the waiter reads no fixed cost');
select is((select count(*)::int from public.ingredient_cost_basis), 0, 'and no basis row');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select throws_ok($$ insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2020-05-01', 1, 1, 1, 'a1000000-0000-4000-8000-00000000000a') $$,
  '42501', null, 'authenticated cannot insert a fixed cost directly');
select throws_ok($$ insert into public.ingredient_cost_basis (tenant_id, ingredient_id, basis, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', 'last_price', now(),
          'a1000000-0000-4000-8000-00000000000a') $$,
  '42501', null, 'nor a basis row');
select throws_ok($$ update public.fixed_cost_period set rent = 1 $$, '42501', null, 'authenticated cannot update');
select throws_ok($$ delete from public.ingredient_cost_basis $$, '42501', null, 'authenticated cannot delete');
reset role;
select is_empty(
  $$ select t.relname::text || ' ' || r.rolname from (values ('fixed_cost_period'), ('ingredient_cost_basis')) t (relname)
       cross join (values ('anon'), ('service_role')) r (rolname)
      where has_any_column_privilege(r.rolname, ('public.' || t.relname)::regclass, 'select, insert, update')
         or has_table_privilege(r.rolname, ('public.' || t.relname)::regclass, 'select, insert, update, delete, truncate') $$,
  'anon and service_role have no privilege on the new tables');

-- 7. Constraints.
select throws_ok($$ insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2020-05-15', 1, 1, 1, 'a1000000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'a month must be a first day (table check)');
select throws_ok($$ insert into public.ingredient_cost_basis (tenant_id, ingredient_id, basis, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1e000000-0000-4000-8000-00000000001e', 'last_price', now(),
          'a1000000-0000-4000-8000-00000000000a') $$,
  '23503', null, 'a basis row cannot name another tenant''s ingredient (composite foreign key)');
select throws_ok($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'tenant', '11111111-1111-4111-8111-111111111111',
          'tenant.nope', 'a1000000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'the audit action list is still closed');
select is((select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_enum e
            where e.enumtypid = 'public.cost_basis'::regtype), array['moving_average', 'last_price'],
  'the cost_basis type has the two bases');

select * from finish();
rollback;
