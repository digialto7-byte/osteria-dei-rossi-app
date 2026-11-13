-- M23 step 4 (docs/plans/2026-10-31-m23-push-forecast.md §3.1.4, §3.2, §3.8, §5; AT5 data): app.forecast_json / public.forecast / app.forecast_portion_lines. D = Thu 1998-11-05,
-- now = that day 10:00 CET. The four past Thursdays (the window crosses the 1998-10-25 DST change) give 22 stew plates and 31 covers on average; 14 portions are on hand.
-- Edges: a table closed at 00:40 on the Friday counts (business date 10-29); a Wednesday sale, a voided line and an open table do not. Portions follow the plate version SOLD.
-- Divisor (Q162): the open weeks only. Dates: today .. today + 6. Roles: the chef has no covers. Two more tenants (C: three open weeks, B: no sales). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'owner-c@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222226');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '33333333-3333-4333-8333-333333333333', 'e0000000-0000-4000-8000-00000000000e', 'owner', 'Titolare C Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');

create function pg_temp.uid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;
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
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
-- One tenant's stew: a batch recipe (key tag||bk), a plate (key tag||pk, version tag||r1), a menu item (tag||mi) and two tables (tag||t1, tag||t2). Names are the same in every tenant.
create function pg_temp.stew(p_t uuid, p_owner uuid, p_tag text) returns void language plpgsql as $$
begin
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
    (pg_temp.uid(p_tag || 'bk'), p_t, 'batch', 1, 'spezzatino', p_owner),
    (pg_temp.uid(p_tag || 'pk'), p_t, 'plate', 1, 'spezzatino con polenta', p_owner);
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by)
    values (pg_temp.uid(p_tag || 'rb'), p_t, pg_temp.uid(p_tag || 'bk'), 1, '1998-09-01', 'Spezzatino', 2, 'kg', 10, 48, p_owner);
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
    values (pg_temp.uid(p_tag || 'r1'), p_t, pg_temp.uid(p_tag || 'pk'), 1, '1998-09-01', 'Spezzatino con polenta', p_owner);
  insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by)
    values (p_t, pg_temp.uid(p_tag || 'r1'), 1, pg_temp.uid(p_tag || 'bk'), 1, 'porz', 1, p_owner);
  insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by)
    values (pg_temp.uid(p_tag || 'mi'), p_t, 'Spezzatino con polenta', 'Secondi', 'secondi', pg_temp.uid(p_tag || 'pk'), p_owner, p_owner);
  insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
    (pg_temp.uid(p_tag || 't1'), p_t, 'Tavolo 1 (demo)', 1, p_owner, p_owner),
    (pg_temp.uid(p_tag || 't2'), p_t, 'Tavolo 2 (demo)', 2, p_owner, p_owner);
end
$$;
-- A session (opened two hours before p_at) on table p_table (1 or 2); closed at p_at with business date p_d when p_at is given.
create function pg_temp.sess(p_t uuid, p_owner uuid, p_tag text, p_n int, p_d date, p_covers int, p_at timestamptz, p_table int default 1) returns void language plpgsql as $$
begin
  insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by)
    values (pg_temp.uid(p_tag || 's' || p_n), p_t, pg_temp.uid(p_tag || 't' || p_table), 'Tavolo ' || p_table || ' (demo)', p_covers,
            coalesce(p_at, p_d::timestamptz + interval '19 hours') - interval '2 hours', p_owner, p_d, p_owner, p_owner);
end
$$;
-- A fired line of session n: item tag||item, plate version tag||rec (null = unmapped), qty; voided when asked.
create function pg_temp.ln(p_t uuid, p_owner uuid, p_tag text, p_n int, p_line int, p_item text, p_rec text, p_qty numeric, p_voided boolean default false) returns void language plpgsql as $$
begin
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by,
                                 fired_at, fired_by, voided_at, voided_by, void_reason)
    values (pg_temp.uid(p_tag || 'l' || p_n || '_' || p_line), p_t, pg_temp.uid(p_tag || 's' || p_n), pg_temp.uid(p_tag || p_item), 'secondi', p_qty, 14, 10, 'menu',
            '1998-10-01T12:00Z', '1998-10-01T12:00Z', p_owner, p_owner, '1998-10-01T12:00Z', p_owner,
            case when p_voided then '1998-10-01T12:05Z'::timestamptz end, case when p_voided then p_owner end, case when p_voided then 'wrong_dish' end);
  insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, missing_ingredient_ids, cost_at, created_by)
    values (pg_temp.uid(p_tag || 'l' || p_n || '_' || p_line), p_t, case when p_rec is not null then pg_temp.uid(p_tag || p_rec) end,
            case when p_rec is not null then round(4.2 * p_qty, 4) end, case when p_rec is not null then 4.2 end, p_rec is null,
            '{}', '1998-10-01T12:00Z', p_owner);
end
$$;
create function pg_temp.close_s(p_tag text, p_n int, p_owner uuid, p_at timestamptz, p_cbd date) returns void language sql as $$
  update public.table_session set closed_at = p_at, closed_by = p_owner, closed_business_date = p_cbd, receipt_type = 'scontrino',
         receipt_number = '0001-' || p_n, payment_type = 'card', total = 50.00 where id = pg_temp.uid(p_tag || 's' || p_n)
$$;

select pg_temp.stew('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A');
select pg_temp.stew('22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', 'B');
select pg_temp.stew('33333333-3333-4333-8333-333333333333', 'e1000000-0000-4000-8000-00000000000e', 'C');
-- Tenant A also has a ragù (batch) with a plate "tagliatelle" in two versions, and a brasato batch with stock but no sales.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  (pg_temp.uid('Arbk'), '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid('Arpk'), '11111111-1111-4111-8111-111111111111', 'plate', 2, 'tagliatelle al ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid('Abbk'), '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brasato (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid('Aubk'), '11111111-1111-4111-8111-111111111111', 'batch', 1, 'inutilizzato (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  (pg_temp.uid('Arrb'), '11111111-1111-4111-8111-111111111111', pg_temp.uid('Arbk'), 1, '1998-09-01', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid('Abrb'), '11111111-1111-4111-8111-111111111111', pg_temp.uid('Abbk'), 1, '1998-09-01', 'Brasato (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid('Aurb'), '11111111-1111-4111-8111-111111111111', pg_temp.uid('Aubk'), 1, '1998-09-01', 'Inutilizzato (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  (pg_temp.uid('Atv1'), '11111111-1111-4111-8111-111111111111', pg_temp.uid('Arpk'), 1, '1998-09-01', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid('Atv2'), '11111111-1111-4111-8111-111111111111', pg_temp.uid('Arpk'), 2, '1998-10-30', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
-- Version 1 uses 1 portion of ragù, version 2 (current) uses 2.
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', pg_temp.uid('Atv1'), 1, pg_temp.uid('Arbk'), 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.uid('Atv2'), 1, pg_temp.uid('Arbk'), 2, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by) values
  (pg_temp.uid('Armi'), '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', pg_temp.uid('Arpk'), 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

-- Live batches: A's stew (14 portions, produced Wed 11-04 18:00 CET), A's brasato (3), B's stew (5).
create function pg_temp.mkbatch(p_t uuid, p_owner uuid, p_loc uuid, p_tag text, p_keytag text, p_rectag text, p_n int, p_portions int) returns void language plpgsql as $$
declare
  v_id uuid := pg_temp.uid(p_tag || 'batch' || p_n);
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
      portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
    values (v_id, p_t, pg_temp.uid(p_keytag), pg_temp.uid(p_rectag), 1, '981104-LOT-' || p_n, '1998-11-04', 'LOT', p_n, '1998-11-04T17:00Z', p_owner, 2, 'kg', p_portions, p_portions, 48,
            '1998-11-06T17:00Z', 'fresh', p_loc, p_owner);
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values (p_t, v_id, 'produce', p_portions, 'batch', v_id, '1998-11-04', p_owner);
end
$$;
select pg_temp.mkbatch('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-0000000000a1', 'A', 'Abk', 'Arb', 1, 14);
select pg_temp.mkbatch('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-0000000000a1', 'A', 'Abbk', 'Abrb', 2, 3);
select pg_temp.mkbatch('22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-0000000000b1', 'B', 'Bbk', 'Brb', 1, 5);

-- Sales. Tenant A (cut-off 02:00; CEST until 1998-10-25): the four Thursdays 10-29, 10-22, 10-15, 10-08, and the edge cases. Each session is closed before the next one opens its table.
select pg_temp.sess('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 1, '1998-10-29', 18, '1998-10-29T19:30Z', 1);
select pg_temp.ln('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 1, 1, 'mi', 'r1', 12);
select pg_temp.ln('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 1, 2, 'rmi', 'tv1', 5);
select pg_temp.close_s('A', 1, 'a1000000-0000-4000-8000-00000000000a', '1998-10-29T19:30Z', '1998-10-29');
-- Session 2 closes on Friday at 00:40 CEST (22:40Z) and still belongs to the business date 10-29.
select pg_temp.sess('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 2, '1998-10-29', 12, '1998-10-29T22:40Z', 1);
select pg_temp.ln('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 2, 1, 'mi', 'r1', 8);
select pg_temp.close_s('A', 2, 'a1000000-0000-4000-8000-00000000000a', '1998-10-29T22:40Z', '1998-10-29');
select pg_temp.sess('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 3, '1998-10-22', 34, '1998-10-22T19:30Z', 1);
select pg_temp.ln('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 3, 1, 'mi', 'r1', 24);
select pg_temp.ln('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 3, 2, 'mi', 'r1', 5, true);
select pg_temp.close_s('A', 3, 'a1000000-0000-4000-8000-00000000000a', '1998-10-22T19:30Z', '1998-10-22');
select pg_temp.sess('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 4, '1998-10-15', 28, '1998-10-15T19:30Z', 1);
select pg_temp.ln('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 4, 1, 'mi', 'r1', 21);
select pg_temp.close_s('A', 4, 'a1000000-0000-4000-8000-00000000000a', '1998-10-15T19:30Z', '1998-10-15');
-- Session 5 stays open (table 2): not sold.
select pg_temp.sess('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 5, '1998-10-15', 6, null, 2);
select pg_temp.ln('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 5, 1, 'mi', 'r1', 3);
select pg_temp.sess('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 6, '1998-10-08', 32, '1998-10-08T19:30Z', 1);
select pg_temp.ln('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 6, 1, 'mi', 'r1', 23);
select pg_temp.close_s('A', 6, 'a1000000-0000-4000-8000-00000000000a', '1998-10-08T19:30Z', '1998-10-08');
-- Session 7 is a Wednesday: not a source date.
select pg_temp.sess('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 7, '1998-10-28', 40, '1998-10-28T19:30Z', 1);
select pg_temp.ln('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'A', 7, 1, 'mi', 'r1', 7);
select pg_temp.close_s('A', 7, 'a1000000-0000-4000-8000-00000000000a', '1998-10-28T19:30Z', '1998-10-28');
-- Tenant C: the same Thursdays without any session on 10-15.
select pg_temp.sess('33333333-3333-4333-8333-333333333333', 'e1000000-0000-4000-8000-00000000000e', 'C', 1, '1998-10-29', 10, '1998-10-29T19:30Z', 1);
select pg_temp.ln('33333333-3333-4333-8333-333333333333', 'e1000000-0000-4000-8000-00000000000e', 'C', 1, 1, 'mi', 'r1', 20);
select pg_temp.close_s('C', 1, 'e1000000-0000-4000-8000-00000000000e', '1998-10-29T19:30Z', '1998-10-29');
select pg_temp.sess('33333333-3333-4333-8333-333333333333', 'e1000000-0000-4000-8000-00000000000e', 'C', 2, '1998-10-22', 12, '1998-10-22T19:30Z', 1);
select pg_temp.ln('33333333-3333-4333-8333-333333333333', 'e1000000-0000-4000-8000-00000000000e', 'C', 2, 1, 'mi', 'r1', 24);
select pg_temp.close_s('C', 2, 'e1000000-0000-4000-8000-00000000000e', '1998-10-22T19:30Z', '1998-10-22');
select pg_temp.sess('33333333-3333-4333-8333-333333333333', 'e1000000-0000-4000-8000-00000000000e', 'C', 3, '1998-10-08', 14, '1998-10-08T19:30Z', 1);
select pg_temp.ln('33333333-3333-4333-8333-333333333333', 'e1000000-0000-4000-8000-00000000000e', 'C', 3, 1, 'mi', 'r1', 23);
select pg_temp.close_s('C', 3, 'e1000000-0000-4000-8000-00000000000e', '1998-10-08T19:30Z', '1998-10-08');

create function pg_temp.fc(p_t text, p_role text, p_date text, p_now text) returns jsonb language sql as $$
  select app.forecast_json(p_t::uuid, p_role, p_date::date, p_now::timestamptz) $$;
create function pg_temp.brow(j jsonb, p_name text) returns jsonb language sql as $$
  select jsonb_path_query_first(j -> 'batches', '$[*] ? (@.name == $n)', jsonb_build_object('n', p_name)) $$;
create function pg_temp.prow(j jsonb, p_name text) returns jsonb language sql as $$
  select jsonb_path_query_first(j -> 'plates', '$[*] ? (@.name == $n)', jsonb_build_object('n', p_name)) $$;
create function pg_temp.keys_of(j jsonb) returns text[] language sql as $$
  with recursive w(v) as (
    select j
    union all
    select c.v from w, lateral (
      select e.value as v from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) e
      union all
      select a.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) a) c)
  select coalesce(array_agg(distinct k order by k), '{}') from w, lateral jsonb_object_keys(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) k $$;
create temp table r (nm text primary key, j jsonb);
grant all on r to public;
insert into r values ('chef', pg_temp.fc('11111111-1111-4111-8111-111111111111', 'chef', '1998-11-05', '1998-11-05T09:00Z'));
insert into r values ('own', pg_temp.fc('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-05', '1998-11-05T09:00Z'));

-- AT5: the numbers ----------------------------------------------------------------------------------------------------------------------------------
select is((select j -> 'sourceDates' from r where nm = 'chef'), '["1998-10-29", "1998-10-22", "1998-10-15", "1998-10-08"]'::jsonb, 'the source dates are D - 7, -14, -21, -28 (across the 1998-10-25 DST change)');
select is((select j ->> 'weeksUsed' from r where nm = 'chef'), '4', 'four open weeks');
select is((select j ->> 'today' || '/' || (j ->> 'tomorrow') || '/' || (j ->> 'date') || '/' || (j ->> 'weekday') from r where nm = 'chef'), '1998-11-05/1998-11-06/1998-11-05/4', 'today, tomorrow, date and the ISO weekday (Thursday = 4)');
select is((pg_temp.brow((select j from r where nm = 'chef'), 'Spezzatino') ->> 'expectedPortions')::numeric, 22.00, 'AT5: the stew expectedPortions is 22.00 ((20 + 24 + 21 + 23) / 4)');
select is((pg_temp.brow((select j from r where nm = 'chef'), 'Spezzatino') ->> 'onHandPortions')::numeric, 14::numeric, 'onHandPortions 14');
select is((pg_temp.brow((select j from r where nm = 'chef'), 'Spezzatino') ->> 'gap')::numeric, 8.00, 'gap 8.00');
select is((pg_temp.prow((select j from r where nm = 'chef'), 'Spezzatino con polenta') ->> 'expectedPlates')::numeric, 22.00, 'the plate row: Spezzatino con polenta 22.00');
select is((pg_temp.prow((select j from r where nm = 'chef'), 'Tagliatelle al ragù (demo)') ->> 'expectedPlates')::numeric, 1.25, 'a plate sold once in four weeks: 5 / 4 = 1.25');
select is((select array_agg(e ->> 'name' order by n) from jsonb_array_elements((select j -> 'plates' from r where nm = 'chef')) with ordinality t(e, n)),
          array['Spezzatino con polenta', 'Tagliatelle al ragù (demo)'], 'plates are ordered by expected plates descending');
select is((select array_agg(e ->> 'name' order by n) from jsonb_array_elements((select j -> 'batches' from r where nm = 'chef')) with ordinality t(e, n)),
          array['Spezzatino', 'Ragù (demo)', 'Brasato (demo)'], 'batch rows by gap descending: stew 8, ragù 1.25, brasato -3; the unused recipe is absent');
select is((pg_temp.brow((select j from r where nm = 'chef'), 'Brasato (demo)') ->> 'gap')::numeric, -3.00, 'stock with no sales: expected 0, on hand 3, gap -3.00');
select is((pg_temp.brow((select j from r where nm = 'chef'), 'Brasato (demo)') ->> 'expectedPortions')::numeric, 0.00, 'and its expected portions are 0.00, not null (four open weeks)');

-- Edges: the 00:40 close counts; the Wednesday sale, the voided line and the open table do not ----------------------------------------------------------
select is((pg_temp.brow((select j from r where nm = 'chef'), 'Spezzatino') ->> 'expectedPortions')::numeric, (20 + 24 + 21 + 23) / 4.0, 'the sum has 20 on 10-29 (12 + 8: the 00:40 close counts), 24 on 10-22 (not 29: the voided 5 is out), 21 (not 24: the open table is out), 23, and no Wednesday 7');
select is((select (j -> 'covers' ->> 'expected')::numeric from r where nm = 'own'), 31.00, 'covers: (30 + 34 + 28 + 32) / 4 = 31.00 for the owner');

-- The version sold --------------------------------------------------------------------------------------------------------------------------------
select is((pg_temp.brow((select j from r where nm = 'chef'), 'Ragù (demo)') ->> 'expectedPortions')::numeric, 1.25, 'portions follow the plate version SOLD: 5 plates x 1 portion (version 1) / 4, not x 2 (the current version)');
-- Parity with the KPI sales lines
select is((select sum(x.portions) from app.forecast_portion_lines('11111111-1111-4111-8111-111111111111', array['1998-10-29', '1998-10-22', '1998-10-15', '1998-10-08']::date[]) x where x.batch_key = pg_temp.uid('Abk')),
          (select sum(k.qty) from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '1998-10-08', '1998-10-29') k
            where k.menu_item_id = pg_temp.uid('Ami') and k.mapped and k.business_date = any (array['1998-10-29', '1998-10-22', '1998-10-15', '1998-10-08']::date[])),
          'parity: the stew portions equal the mapped KPI quantity of the stew plate (88)');
select is((select count(*)::int from app.forecast_portion_lines('11111111-1111-4111-8111-111111111111', array['1998-10-28']::date[])), 1, 'forecast_portion_lines answers for any dates it is given (the Wednesday has its one stew line)');
select is((select count(*)::int from app.forecast_portion_lines('22222222-2222-4222-8222-222222222222', array['1998-10-29', '1998-10-22']::date[])), 0, 'and counts nothing of another tenant');

-- Divisor (Q162): tenant C had no session on 10-15 -----------------------------------------------------------------------------------------------
insert into r values ('c', pg_temp.fc('33333333-3333-4333-8333-333333333333', 'owner', '1998-11-05', '1998-11-05T09:00Z'));
select is((select j ->> 'weeksUsed' from r where nm = 'c'), '3', 'tenant C: three open weeks');
select is((pg_temp.brow((select j from r where nm = 'c'), 'Spezzatino') ->> 'expectedPortions')::numeric, 22.33, 'tenant C: (20 + 24 + 23) / 3 = 22.33');
select is((select (j -> 'covers' ->> 'expected')::numeric from r where nm = 'c'), 12.00, 'tenant C covers: (10 + 12 + 14) / 3 = 12.00');

-- No history ------------------------------------------------------------------------------------------------------------------------------------------
insert into r values ('b', pg_temp.fc('22222222-2222-4222-8222-222222222222', 'owner', '1998-11-05', '1998-11-05T09:00Z'));
select is((select j ->> 'weeksUsed' from r where nm = 'b'), '0', 'a tenant with no sales: weeksUsed 0');
select is((pg_temp.brow((select j from r where nm = 'b'), 'Spezzatino') -> 'expectedPortions'), 'null'::jsonb, 'every expected value is null');
select is((pg_temp.brow((select j from r where nm = 'b'), 'Spezzatino') ->> 'onHandPortions')::numeric, 5::numeric, 'but onHandPortions is still filled');
select is((pg_temp.brow((select j from r where nm = 'b'), 'Spezzatino') -> 'gap'), 'null'::jsonb, 'and the gap is null');
select is((select j -> 'covers' -> 'expected' from r where nm = 'b'), 'null'::jsonb, 'covers.expected is null');
select is((select j -> 'plates' from r where nm = 'b'), '[]'::jsonb, 'and there are no plate rows');

-- Dates -----------------------------------------------------------------------------------------------------------------------------------------------
select is((pg_temp.fc('11111111-1111-4111-8111-111111111111', 'chef', null, '1998-11-05T09:00Z') ->> 'date'), '1998-11-05', 'a null date is today''s business date');
select is((pg_temp.fc('11111111-1111-4111-8111-111111111111', 'chef', null, '1998-11-05T00:30Z') ->> 'date'), '1998-11-04', 'at 01:30 CET it is still the previous business day');
select is(pg_temp.err($$select pg_temp.fc('11111111-1111-4111-8111-111111111111', 'chef', '1998-11-11', '1998-11-05T09:00Z')$$), 'ok', 'today + 6 is accepted');
select is((pg_temp.fc('11111111-1111-4111-8111-111111111111', 'chef', '1998-11-11', '1998-11-05T09:00Z') -> 'sourceDates' ->> 0), '1998-11-04', 'and its first source date is D - 7');
select is(pg_temp.err($$select pg_temp.fc('11111111-1111-4111-8111-111111111111', 'chef', '1998-11-12', '1998-11-05T09:00Z')$$), 'P0001 date_out_of_range', 'today + 7: date_out_of_range');
select is(pg_temp.err($$select pg_temp.fc('11111111-1111-4111-8111-111111111111', 'chef', '1998-11-04', '1998-11-05T09:00Z')$$), 'P0001 date_out_of_range', 'yesterday: date_out_of_range');
select is((pg_temp.fc('11111111-1111-4111-8111-111111111111', 'chef', '1998-11-06', '1998-11-05T09:00Z') ->> 'weekday'), '5', 'tomorrow is a Friday (5)');
select is((pg_temp.brow(pg_temp.fc('11111111-1111-4111-8111-111111111111', 'chef', '1998-11-06', '1998-11-05T09:00Z'), 'Spezzatino') ->> 'onHandPortions')::numeric, 14::numeric, 'the stock on hand is "now" even for tomorrow');

-- Roles and shape -------------------------------------------------------------------------------------------------------------------------------------
select is((select j ? 'covers' from r where nm = 'chef'), false, 'the chef reply has no covers key');
select is((select j ? 'covers' from r where nm = 'own'), true, 'the owner reply has covers');
select is((select array_agg(k) from unnest(pg_temp.keys_of((select j from r where nm = 'chef'))) k where k ~* '(cover|cost|price|eur)'), null, 'chef: no cover, cost, price or eur key anywhere');
select is((select array_agg(k order by k) from jsonb_object_keys((select j from r where nm = 'own')) k),
          array['batches', 'covers', 'date', 'plates', 'role', 'sourceDates', 'today', 'tomorrow', 'weekday', 'weeksUsed'], 'the owner key set');
select is(position('Titolare' in (select j::text from r where nm = 'own')), 0, 'no staff name in the reply');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((public.forecast(null) ->> 'role'), 'owner', 'public.forecast answers the owner');
select is((public.forecast() ->> 'role'), 'owner', 'with no argument too');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((public.forecast(null) -> 'covers' is not null), true, 'the admin has covers');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((public.forecast(null) ? 'covers'), false, 'and the chef through the public function has none');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$select public.forecast(null)$$), 6), '42501 ', 'the waiter is refused');
select set_config('request.jwt.claims', '', true);
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.forecast(date)', 'execute')), array['authenticated'], 'only authenticated executes forecast');
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['app.forecast_json(uuid, text, date, timestamptz)', 'app.forecast_portion_lines(uuid, date[])', 'app.forecast_weeks()', 'app.forecast_days_ahead()']) f), false, 'no API role executes the app.* functions');
select is((select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
            where oid in ('public.forecast(date)'::regprocedure, 'app.forecast_json(uuid, text, date, timestamptz)'::regprocedure, 'app.forecast_portion_lines(uuid, date[])'::regprocedure)), true, 'definers with an empty search_path');
select is((app.forecast_weeks() || '/' || app.forecast_days_ahead()), '4/6', 'the constants: four weeks, six days ahead');
select is(position('ba000000' in (select j::text from r where nm = 'own')), 0, 'no foreign id');
select is(position(pg_temp.uid('Bbk')::text in (select j::text from r where nm = 'own')), 0, 'tenant B''s sales and stock are not in A''s reply');

select * from finish();
rollback;
