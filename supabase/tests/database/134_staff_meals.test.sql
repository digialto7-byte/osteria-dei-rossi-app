-- M15 step 5: set_staff_meal_rule and confirm_staff_meal (M15 plan §3.1.7, §3.1.8, §3.1.12, §3.2; AT5; ADR-014).
-- Called under claims, as the API does. The confirmation of a rule is also run through app.confirm_staff_meal_core with a
-- fixed instant, to prove the business date (now() is constant inside a transaction). Batches are inserted as the
-- migration owner. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(78);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'kg', true),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Sale grosso (demo)', 'kg', true),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Detersivo (demo)', 'kg', false);
-- Batch recipes: Ragù, Brodo, Sugo, Fondo; a sub-recipe; and one of tenant B.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brodo (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'sugo (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e4', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'fondo (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e5', '11111111-1111-4111-8111-111111111111', 'sub', 1, 'soffritto (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e6', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'brodo b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by)
  select ('ed000000-0000-4000-8000-0000000000d' || right(k.id::text, 1))::uuid, k.tenant_id, k.id, 1, '2026-10-01T00:00Z',
         initcap(k.name_norm), 2, 'kg', 10, 48, k.created_by
    from public.recipe_key k where k.type = 'batch';
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by)
  values ('ed000000-0000-4000-8000-0000000000d5', '11111111-1111-4111-8111-111111111111',
          'ec000000-0000-4000-8000-0000000000e5', 1, '2026-10-01T00:00Z', 'Soffritto (demo)', 1, 'kg',
          'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.as_chef() returns void language sql as $$
  select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef') $$;
create function pg_temp.keys(j jsonb) returns setof text language sql as $$
  select k from (select jsonb_object_keys(j) k) a
  union all
  select pg_temp.keys(v) from jsonb_each(j) e (k, v) where jsonb_typeof(v) = 'object'
  union all
  select pg_temp.keys(v) from jsonb_each(j) e (k, a), lateral jsonb_array_elements(a) v
   where jsonb_typeof(a) = 'array' and jsonb_typeof(v) = 'object'
$$;
-- A batch of tenant A of a recipe (e1..e4): p_portions portions made p_age ago, valid p_shelf hours from production.
create sequence pg_temp.lot_seq;
create function pg_temp.mkbatch(p_id uuid, p_key text, p_code text, p_portions int, p_age interval, p_shelf int)
  returns void language plpgsql as $$
declare
  v_seq int := nextval('pg_temp.lot_seq');
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, state, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', ('ec000000-0000-4000-8000-0000000000' || p_key)::uuid,
      ('ed000000-0000-4000-8000-0000000000d' || right(p_key, 1))::uuid, 1,
      to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-' || p_code || '-' || v_seq,
      (now() at time zone 'Europe/Rome')::date, p_code, v_seq, now() - p_age, 'a1000000-0000-4000-8000-00000000000a', 2, 'kg',
      p_portions, p_portions, p_shelf, now() - p_age + make_interval(hours => p_shelf), 'open',
      '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, 'produce', p_portions, 'batch', p_id,
      (now() at time zone 'Europe/Rome')::date, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.rem(p_batch uuid) returns numeric language sql as $$
  select coalesce(sum(portions), 0) from public.batch_movement where batch_id = p_batch
$$;
create function pg_temp.st(p_batch uuid) returns text language sql as $$
  select state::text from public.batch where id = p_batch
$$;
create function pg_temp.nconf(p_rule uuid) returns bigint language sql as $$
  select count(*) from public.staff_meal_confirmation where rule_id = p_rule
$$;
create function pg_temp.nwaste() returns bigint language sql as $$
  select (select count(*) from public.batch_movement where type = 'waste' and ref_type = 'staff_meal')
       + (select count(*) from public.stock_movement where type = 'waste' and ref_type = 'staff_meal')
$$;
create sequence pg_temp.line_seq;
create function pg_temp.new_line() returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', 1,
      10, 10, '{}', '{}');
  return v_line;
end
$$;
create temporary table res (k text primary key, j jsonb);
grant all on res to authenticated;
grant execute on function pg_temp.err(text), pg_temp.act_as(uuid, uuid, text), pg_temp.as_chef(), pg_temp.keys(jsonb),
  pg_temp.rem(uuid), pg_temp.st(uuid), pg_temp.nconf(uuid), pg_temp.nwaste() to authenticated;

-- Pane: 5 kg in a lot received at 3.00 per kg (three purchases at 3.00). Sale: no stock, never bought.
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry,
    received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  values ('10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
    '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1',
    '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(), 'L-PANE', null, '2026-10-20', 5, 'kg', 5, 'kg', 1,
    'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id,
    effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
    '10700000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'receipt', 5, 3, 'invoice_line',
    pg_temp.new_line(), '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
    effective_on, created_by)
  select '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
         '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(), 3, 'kg', d, 'a1000000-0000-4000-8000-00000000000a'
    from unnest(array['2026-09-01', '2026-09-02', '2026-09-03']::date[]) d;

-- Batches. Ragù: R1 7 portions (valid to tomorrow), R3 5 portions (valid longer). Brodo: expired B0 (3, first by use-by if it
-- counted), B1 7, B2 5. Sugo: 3. Fondo: F1 3 and F2 5.
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', 'e1', 'RAGUDE', 7, interval '1 hour', 24);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b3', 'e1', 'RAGUDE', 5, interval '1 hour', 72);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000c0', 'e2', 'BRODOD', 3, interval '50 hours', 48);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000c1', 'e2', 'BRODOD', 7, interval '1 hour', 24);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000c2', 'e2', 'BRODOD', 5, interval '1 hour', 72);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000d1', 'e3', 'SUGODE', 3, interval '1 hour', 24);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000f1', 'e4', 'FONDOD', 3, interval '1 hour', 24);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000f2', 'e4', 'FONDOD', 5, interval '1 hour', 72);

-- Shape and grants -----------------------------------------------------------------------------------------
select is_empty(
  $$ select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('set_staff_meal_rule', 'confirm_staff_meal')
        and not (p.prosecdef and p.proconfig @> array['search_path=""']
                 and has_function_privilege('authenticated', p.oid, 'execute')
                 and not has_function_privilege('anon', p.oid, 'execute')
                 and not has_function_privilege('service_role', p.oid, 'execute')) $$,
  'both procedures are definer, have an empty search_path and are executable by authenticated only');
select is_empty(
  $$ select r from unnest(array['anon', 'authenticated', 'service_role']) r
      where has_function_privilege(r, 'app.confirm_staff_meal_core(uuid, uuid, uuid, numeric, timestamptz)', 'execute') $$,
  'no API role can execute the confirmation core');

set local role authenticated;

-- Roles and tenancy ---------------------------------------------------------------------------------------
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e1', null, 2) $$) ~ '^42501', true,
  'waiter: set_staff_meal_rule is refused (42501)');
select is(pg_temp.err($$ select public.confirm_staff_meal(gen_random_uuid()) $$) ~ '^42501', true,
  'waiter: confirm_staff_meal is refused (42501)');
select pg_temp.act_as('00000000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'none');
select is(pg_temp.err($$ select public.confirm_staff_meal(gen_random_uuid()) $$) ~ '^42501', true,
  'no role: confirm_staff_meal is refused (42501)');

-- Rules ---------------------------------------------------------------------------------------------------
select pg_temp.as_chef();
insert into res select 'ru1', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e1', null, 2);
select is((select (j->>'created')::boolean from res where k = 'ru1'), true, 'the chef creates a rule for Ragù: created');
select is((select j->>'kind' || '/' || trim_scale((j->>'defaultCount')::numeric) || '/' || (j->>'isActive') from res where k = 'ru1'),
  'recipe/2/true', 'and it is a recipe rule of 2 portions, active');
select is((select array_agg(kk.k order by kk.k) from pg_temp.keys((select j from res where k = 'ru1')) kk (k)),
  array['created', 'defaultCount', 'isActive', 'kind', 'locationId', 'ruleId', 'targetId'], 'set_staff_meal_rule answers exactly its seven keys');
select is((select count(*)::int from public.staff_meal_rule), 1, 'one rule row (the chef reads it)');
insert into res select 'ru2', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e1', null, 3);
select is((select (j->>'created')::boolean from res where k = 'ru2'), false, 'setting it again returns created false');
select is((select (a.j->>'ruleId') = (b.j->>'ruleId') and (a.j->>'defaultCount')::numeric = 3
             from res a, res b where a.k = 'ru2' and b.k = 'ru1'), true, 'with the same id and the new count 3');
select is((select count(*)::int from public.staff_meal_rule), 1, 'still one rule row (one per target)');
insert into res select 'ru3', public.set_staff_meal_rule(null, '1a000000-0000-4000-8000-00000000001a', 500, 'g');
select is((select j->>'kind' || '/' || trim_scale((j->>'defaultCount')::numeric) from res where k = 'ru3'), 'ingredient/0.5',
  'Pane 500 g is stored as 0.5 kg');
select is(pg_temp.err($$ select public.set_staff_meal_rule(null, '1a000000-0000-4000-8000-00000000001a', 1, 'ml') $$),
  'P0001 unit_mismatch', 'ml on Pane -> unit_mismatch');
select is(pg_temp.err($$ select public.set_staff_meal_rule(null, '1a000000-0000-4000-8000-00000000001a', 1) $$),
  'P0001 unit_mismatch', 'no unit on an ingredient -> unit_mismatch');
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e2',
    '1a000000-0000-4000-8000-00000000001a', 1, 'kg') $$), 'P0001 staff_meal_target_invalid', 'both targets -> staff_meal_target_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule(null, null, 1) $$), 'P0001 staff_meal_target_invalid',
  'no target -> staff_meal_target_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e5', null, 1) $$),
  'P0001 staff_meal_target_invalid', 'a sub-recipe key -> staff_meal_target_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e6', null, 1) $$),
  'P0001 staff_meal_target_invalid', 'a key of another tenant -> staff_meal_target_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule(gen_random_uuid(), null, 1) $$),
  'P0001 staff_meal_target_invalid', 'an unknown key -> staff_meal_target_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule(null, '1c000000-0000-4000-8000-00000000001c', 1, 'kg') $$),
  'P0001 staff_meal_target_invalid', 'a non-stock ingredient -> staff_meal_target_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e2', null, 1, null,
    '10000000-0000-4000-8000-0000000000a1') $$), 'P0001 staff_meal_target_invalid', 'a location on a recipe rule -> staff_meal_target_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e2', null, 0) $$),
  'P0001 count_invalid', 'a count of 0 -> count_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e2', null, 1000.5) $$),
  'P0001 count_invalid', 'a count above 1000 -> count_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e2', null, 1.23456) $$),
  'P0001 count_invalid', 'a count with 5 decimals -> count_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e2', null, null) $$),
  'P0001 count_invalid', 'a null count -> count_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule(null, '1b000000-0000-4000-8000-00000000001b', 1001, 'kg') $$),
  'P0001 count_invalid', 'an ingredient quantity above 1000 base units -> count_invalid');
select is(pg_temp.err($$ select public.set_staff_meal_rule(null, '1b000000-0000-4000-8000-00000000001b', 1, 'kg',
    '10000000-0000-4000-8000-0000000000b1') $$), 'P0001 location_not_found', 'a location of another tenant -> location_not_found');
select is((select count(*)::int from public.staff_meal_rule), 2, 'the refusals created nothing (two rules: Ragù, Pane)');

reset role;
select is((select count(*)::int || '/' || min(e.after->>'defaultCount') from public.audit_event e
            where e.entity_type = 'staff_meal_rule' and e.action = 'staff_meal_rule.created'
              and e.entity_id = (select (j->>'ruleId')::uuid from res where k = 'ru1') and e.created_by = 'c1000000-0000-4000-8000-00000000000c'),
  '1/2.0000', 'one staff_meal_rule.created audit event for Ragù, by the chef');
select is((select count(*)::int || '/' || min(e.before->>'defaultCount') || '/' || min(e.after->>'defaultCount')
             from public.audit_event e
            where e.entity_type = 'staff_meal_rule' and e.action = 'staff_meal_rule.updated'
              and e.entity_id = (select (j->>'ruleId')::uuid from res where k = 'ru1')),
  '1/2.0000/3.0000', 'and one staff_meal_rule.updated event with the old and the new count');

-- AT5 (recipe): R1 (7, valid to tomorrow) and R3 (5, valid longer), rule Ragù 2 --------------------------------
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'ru1b', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e1', null, 2);
insert into res select 'c1', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'ru1'));
select is((select j->>'ruleId' = (select j->>'ruleId' from res where k = 'ru1') from res where k = 'c1'), true,
  'confirm: the answer names the rule');
select is((select (j->>'count')::numeric from res where k = 'c1'), 2::numeric, 'confirm: the default count of 2 was used');
select is((select array_agg(kk.k order by kk.k) from pg_temp.keys((select j from res where k = 'c1')) kk (k)),
  array['batchId', 'businessDate', 'confirmationId', 'count', 'movements', 'negatives', 'portions', 'ruleId'],
  'confirm_staff_meal answers its six keys (movements carry batchId and portions)');
select is_empty(
  $$ select kk.k from res r, lateral pg_temp.keys(r.j) kk (k) where kk.k ~* '(eur|cost|price|value|amount)' $$,
  'and no key looks like a value, a cost or a price (answers of the rules and the confirmation)');
reset role;
select is((select c.business_date from public.staff_meal_confirmation c where c.id = (select (j->>'confirmationId')::uuid from res where k = 'c1')),
  app.business_date('11111111-1111-4111-8111-111111111111', now()), 'the confirmation carries the business date of now');
select is((select j->>'businessDate' from res where k = 'c1')::date, app.business_date('11111111-1111-4111-8111-111111111111', now()),
  'and so does the answer');
select is((select count(*)::int || '/' || min(m.portions) || '/' || min(m.reason_code) || '/' || min(m.ref_type)
                  || '/' || (min(m.ref_id::text) = (select j->>'confirmationId' from res where k = 'c1'))::text
                  || '/' || min(m.created_by::text)
             from public.batch_movement m where m.type = 'waste' and m.ref_type = 'staff_meal'),
  '1/-2.0000/staff_meal/staff_meal/true/c1000000-0000-4000-8000-00000000000c',
  'AT5: one waste row of -2, reason staff_meal, ref staff_meal -> the confirmation');
select is((select m.batch_id from public.batch_movement m where m.ref_type = 'staff_meal'), 'ba000000-0000-4000-8000-0000000000b1'::uuid,
  'AT5: the portions come from R1, the one that expires first (FEFO)');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000b1') || '/' || pg_temp.st('ba000000-0000-4000-8000-0000000000b1'), '5.0000/open',
  'R1 has 5 left and is open');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000b3'), 5::numeric, 'R3 is untouched');

-- A second confirmation the same business day is refused
set local role authenticated;
select pg_temp.as_chef();
select is(pg_temp.err(format('select public.confirm_staff_meal(%L)', (select j->>'ruleId' from res where k = 'ru1'))),
  'P0001 staff_meal_already_confirmed', 'AT5: a second confirmation the same business day -> staff_meal_already_confirmed');
reset role;
select is(pg_temp.nconf((select (j->>'ruleId')::uuid from res where k = 'ru1')), 1::bigint, 'and nothing was written (one confirmation)');
select is(pg_temp.nwaste(), 1::bigint, 'and one staff-meal waste row');

-- Inactive rule
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'ru4', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e1', null, 3, null, null, false);
select is((select (j->>'isActive')::boolean from res where k = 'ru4'), false, 'a rule can be deactivated');
select is(pg_temp.err(format('select public.confirm_staff_meal(%L)', (select j->>'ruleId' from res where k = 'ru1'))),
  'P0001 staff_meal_rule_inactive', 'an inactive rule -> staff_meal_rule_inactive');
insert into res select 'ru5', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e1', null, 2, null, null, true);
select is((select (j->>'isActive')::boolean from res where k = 'ru5'), true, 'and reactivated');

-- Brodo rule 8: B0 is expired, B1 has 7, B2 has 5 -> B1 -7 (finished), B2 -1
insert into res select 'ru6', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e2', null, 8);
insert into res select 'c2', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'ru6'));
reset role;
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000c1') || '/' || pg_temp.st('ba000000-0000-4000-8000-0000000000c1'), '0.0000/finished',
  'AT4/AT5: Brodo 8: B1 gives its 7 and is finished');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000c2') || '/' || pg_temp.st('ba000000-0000-4000-8000-0000000000c2'), '4.0000/open',
  'and B2 gives 1 and stays open');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000c0') || '/' || pg_temp.st('ba000000-0000-4000-8000-0000000000c0'), '3.0000/open',
  'the expired batch B0 is skipped (3 left, unchanged)');
select is((select string_agg((e->>'batchId') || ':' || trim_scale((e->>'portions')::numeric), ',' order by e->>'batchId')
             from res r, jsonb_array_elements(r.j->'movements') e where r.k = 'c2'),
  'ba000000-0000-4000-8000-0000000000c1:7,ba000000-0000-4000-8000-0000000000c2:1', 'the answer lists both slices');

-- Not enough portions: Sugo has 3, the rule asks for 4 -> nothing is written
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'ru7', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e3', null, 4);
select is(pg_temp.err(format('select public.confirm_staff_meal(%L)', (select j->>'ruleId' from res where k = 'ru7'))),
  'P0001 portions_insufficient', 'available 3 < 4 -> portions_insufficient');
reset role;
select is(pg_temp.nconf((select (j->>'ruleId')::uuid from res where k = 'ru7')), 0::bigint, 'and no confirmation row is left');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000d1') || '/' || pg_temp.st('ba000000-0000-4000-8000-0000000000d1'), '3.0000/open',
  'and Sugo is untouched');

-- A different count for today
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'c3', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'ru7'), 3);
select is((select (j->>'count')::numeric from res where k = 'c3'), 3::numeric, 'a count of 3 overrides the default 4');
reset role;

-- Count validation on a rule not yet confirmed today: Fondo
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'ru8', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e4', null, 5);
select is(pg_temp.err(format('select public.confirm_staff_meal(%L, 0)', (select j->>'ruleId' from res where k = 'ru8'))),
  'P0001 count_invalid', 'an override count of 0 -> count_invalid');
select is(pg_temp.err(format('select public.confirm_staff_meal(%L, 1001)', (select j->>'ruleId' from res where k = 'ru8'))),
  'P0001 count_invalid', 'an override count of 1001 -> count_invalid');
select is(pg_temp.err(format('select public.confirm_staff_meal(%L, 1.23456)', (select j->>'ruleId' from res where k = 'ru8'))),
  'P0001 count_invalid', 'an override count with 5 decimals -> count_invalid');
reset role;

-- Fault injection: Fondo needs F1 (3) and F2 (2). A failure on the second slice leaves nothing.
create function public.fault_inject() returns trigger language plpgsql as $$
begin
  if new.batch_id = 'ba000000-0000-4000-8000-0000000000f2' then
    raise exception 'fault_injected';
  end if;
  return new;
end
$$;
create trigger fault_move before insert on public.batch_movement for each row execute function public.fault_inject();
set local role authenticated;
select pg_temp.as_chef();
select alike(pg_temp.err(format('select public.confirm_staff_meal(%L)', (select j->>'ruleId' from res where k = 'ru8'))),
  '%fault_injected%', 'fault on the second slice: the confirmation fails');
reset role;
drop trigger fault_move on public.batch_movement;
select is(pg_temp.nconf((select (j->>'ruleId')::uuid from res where k = 'ru8')), 0::bigint, 'fault: no confirmation row');
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000f1') || '/' || pg_temp.rem('ba000000-0000-4000-8000-0000000000f2')
          || '/' || pg_temp.st('ba000000-0000-4000-8000-0000000000f1'), '3.0000/5.0000/open', 'fault: no slice and no state change');
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'c4', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'ru8'));
reset role;
select is(pg_temp.rem('ba000000-0000-4000-8000-0000000000f1') || '/' || pg_temp.rem('ba000000-0000-4000-8000-0000000000f2')
          || '/' || pg_temp.st('ba000000-0000-4000-8000-0000000000f1'), '0.0000/3.0000/finished',
  'without the fault Fondo 5 takes F1 (3, finished) then F2 (2)');

-- AT5 (ingredient): Pane 0.5 kg at the basis in force now (3.00) --------------------------------------------
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'c5', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'ru3'));
reset role;
select is((select count(*)::int || '/' || min(m.qty) || '/' || min(m.unit_cost) || '/' || min(m.reason_code) || '/' || min(m.ref_type)
                  || '/' || (min(m.ref_id::text) = (select j->>'confirmationId' from res where k = 'c5'))::text
             from public.stock_movement m where m.type = 'waste' and m.ref_type = 'staff_meal'),
  '1/-0.5000/3.0000/staff_meal/staff_meal/true', 'AT5: one raw waste row of -0.5 kg at 3.00, reason staff_meal, ref staff_meal');
select is((select jsonb_array_length(j->'negatives') from res where k = 'c5'), 0, 'with enough stock there is no negative');
select is((select e->>'ingredientId' || ':' || trim_scale((e->>'qty')::numeric) from res r, jsonb_array_elements(r.j->'movements') e where r.k = 'c5'),
  '1a000000-0000-4000-8000-00000000001a:0.5', 'and the answer lists the ingredient and the quantity');

-- No stock: the shortfall is recorded, never refused (rule 8)
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'ru9', public.set_staff_meal_rule(null, '1b000000-0000-4000-8000-00000000001b', 1, 'kg');
insert into res select 'c6', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'ru9'));
reset role;
select is((select m.qty || '/' || coalesce(m.raw_lot_id::text, 'unlotted') || '/' || coalesce(m.unit_cost::text, 'null')
             from public.stock_movement m where m.ingredient_id = '1b000000-0000-4000-8000-00000000001b' and m.type = 'waste'),
  '-1.0000/unlotted/null', 'no stock: one unlotted waste row, valued null (never bought)');
select is((select count(*)::int from public.alert a where a.kind = 'negative_stock'
            and a.entity_id = '1b000000-0000-4000-8000-00000000001b'), 1, 'and one negative_stock alert');
select is((select e->>'ingredientId' || ':' || trim_scale((e->>'onHandQty')::numeric)
             from res r, jsonb_array_elements(r.j->'negatives') e where r.k = 'c6'),
  '1b000000-0000-4000-8000-00000000001b:-1', 'and the answer names the negative');

-- The business date (core with a fixed instant, winter time: Rome = UTC+1) ------------------------------------
select is((app.confirm_staff_meal_core('11111111-1111-4111-8111-111111111111', 'c1000000-0000-4000-8000-00000000000c',
    (select (j->>'ruleId')::uuid from res where k = 'ru3'), null, '2026-01-14T00:30:00Z')->>'businessDate')::date,
  '2026-01-13'::date, '01:30 Rome counts for the previous day');
select is(pg_temp.err($$ select app.confirm_staff_meal_core('11111111-1111-4111-8111-111111111111', 'c1000000-0000-4000-8000-00000000000c',
    (select (j->>'ruleId')::uuid from res where k = 'ru3'), null, '2026-01-14T00:45:00Z') $$),
  'P0001 staff_meal_already_confirmed', 'a second one at 01:45 is refused');
select is((app.confirm_staff_meal_core('11111111-1111-4111-8111-111111111111', 'c1000000-0000-4000-8000-00000000000c',
    (select (j->>'ruleId')::uuid from res where k = 'ru3'), null, '2026-01-14T01:05:00Z')->>'businessDate')::date,
  '2026-01-14'::date, 'one at 02:05 is accepted, for the new business day');

-- The 50-rule limit: 44 more ingredient rules make fifty; the 51st is refused; an existing rule can still be changed.
insert into public.ingredient (tenant_id, name, base_unit, is_stock)
  select '11111111-1111-4111-8111-111111111111', 'Ingrediente ' || n || ' (demo)', 'kg', true from generate_series(1, 44) n;
insert into public.staff_meal_rule (tenant_id, ingredient_id, default_count, created_by, updated_by)
  select i.tenant_id, i.id, 1, 'c1000000-0000-4000-8000-00000000000c', 'c1000000-0000-4000-8000-00000000000c'
    from public.ingredient i where i.name like 'Ingrediente % (demo)';
set local role authenticated;
select pg_temp.as_chef();
select is((select count(*)::int from public.staff_meal_rule), 50, 'fifty rules exist');
select is(pg_temp.err($$ select public.set_staff_meal_rule(null, '1c000000-0000-4000-8000-00000000001c', 1, 'kg') $$),
  'P0001 staff_meal_target_invalid', 'a refusal for the target comes before the limit');
reset role;
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e7', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'pesto (demo)',
   'a1000000-0000-4000-8000-00000000000a');
set local role authenticated;
select pg_temp.as_chef();
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e7', null, 1) $$),
  'P0001 rules_limit', 'the 51st rule -> rules_limit');
select is(pg_temp.err($$ select public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e1', null, 2) $$), 'ok',
  'at 50 rules an existing one can still be changed');
reset role;

-- Tenancy and unknown rules -----------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err(format('select public.confirm_staff_meal(%L)', (select j->>'ruleId' from res where k = 'ru1'))),
  'P0002 staff_meal_rule_not_found', 'owner B with A''s rule -> P0002 staff_meal_rule_not_found');
select is(pg_temp.err($$ select public.confirm_staff_meal(gen_random_uuid()) $$), 'P0002 staff_meal_rule_not_found',
  'an unknown rule -> P0002');
select is(pg_temp.err($$ select public.confirm_staff_meal(null) $$), 'P0002 staff_meal_rule_not_found', 'a null rule -> P0002');
reset role;

select * from finish();
rollback;
