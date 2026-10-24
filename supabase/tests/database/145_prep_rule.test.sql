-- M16 step 6: app.prep_rule (plan §3.1.4; PRD stew example; AT1, AT2). Each scenario runs the rule at its own instant with
-- only its own recipe key active, so the alerts of one scenario never hide another. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'), ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number, lead_time_days, delivery_weekdays, order_cutoff_time) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Macelleria X (demo)', 'IT12345678903', 2, '{1,4}', '11:00'),
  ('5a000000-0000-4000-8000-0000000000b5', '22222222-2222-4222-8222-222222222222', 'Macelleria B (demo)', 'IT11111111115', 1, '{2}', '09:30');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e1000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/e1000000-0000-4000-8000-0000000000e2.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-0000000000b5');

create temporary table reg (k text primary key, id uuid not null);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create sequence pg_temp.line_seq;
create sequence pg_temp.lot_seq;
create function pg_temp.new_line(p_tenant uuid) returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, p_tenant, case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'e1000000-0000-4000-8000-0000000000e1'::uuid
                                   else 'e1000000-0000-4000-8000-0000000000e2'::uuid end, v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  return v_line;
end
$$;
create function pg_temp.mk_ing(p_k text, p_name text, p_unit text default 'kg', p_stock boolean default true,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values (pg_temp.id(p_k), p_tenant, p_name, p_unit::public.base_unit, p_stock);
end
$$;
-- A lot with its receipt (any tenant).
create function pg_temp.mk_lot(p_ing text, p_expiry date, p_qty numeric, p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line(p_tenant);
  v_lot uuid := gen_random_uuid();
  v_loc uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111' then pg_temp.id('cella') else pg_temp.id('cellab') end;
  v_by uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'a1000000-0000-4000-8000-00000000000a'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end;
  v_sup uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111' then '5a000000-0000-4000-8000-00000000005a'::uuid else '5a000000-0000-4000-8000-0000000000b5'::uuid end;
begin
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received,
      base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, p_tenant, pg_temp.id(p_ing), v_loc, v_sup, v_line, 'L-' || nextval('pg_temp.lot_seq'), p_expiry, '2026-10-01', p_qty, 'kg', p_qty, 'kg', 1, v_by);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
    values (p_tenant, pg_temp.id(p_ing), v_lot, v_loc, 'receipt', p_qty, 10, 'invoice_line', v_line, '2026-10-01', v_by);
end
$$;
-- Brings the ledger sum of an ingredient of tenant A to p_qty: a new lot without expiry, or an unlotted consumption.
create function pg_temp.stock(p_ing text, p_qty numeric) returns void language plpgsql as $$
declare
  v_now numeric := coalesce((select sum(m.qty) from public.stock_movement m where m.ingredient_id = pg_temp.id(p_ing)), 0);
begin
  if p_qty > v_now then
    perform pg_temp.mk_lot(p_ing, null, p_qty - v_now);
  elsif p_qty < v_now then
    insert into public.stock_movement (tenant_id, ingredient_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
      values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), pg_temp.id('cella'), 'consumption', p_qty - v_now, 'manual',
        gen_random_uuid(), '2026-10-01', 'a1000000-0000-4000-8000-00000000000a');
  end if;
end
$$;
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1'), ('cellab', '10000000-0000-4000-8000-0000000000b1');

-- Recipes: soffritto (sub: onion 0.6, carrot 0.4 per kg) and stews (batch 6 kg, 30 portions, 72 h: beef 5, soffritto 0.5, water 1 l).
create function pg_temp.mk_key(p_tag text, p_type text, p_ver_from timestamptz default '2026-10-01T00:00Z', p_min int default null,
    p_target int default null, p_prep int default null, p_ver_min int default null, p_ver_target int default null, p_ver_prep int default null,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
declare
  v_by uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'a1000000-0000-4000-8000-00000000000a'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end;
begin
  insert into reg values ('k_' || p_tag, gen_random_uuid()), ('r_' || p_tag, gen_random_uuid());
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by, rule_min_portions, rule_target_portions, rule_prep_time_min)
    values (pg_temp.id('k_' || p_tag), p_tenant, p_type::public.recipe_type, 1, lower(p_tag), v_by, p_min, p_target, p_prep);
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours,
      prep_time_min, min_portions, target_portions, created_by)
    values (pg_temp.id('r_' || p_tag), p_tenant, pg_temp.id('k_' || p_tag), 1, p_ver_from, initcap(p_tag) || ' (demo)',
      case p_type when 'sub' then 1 else 6 end, 'kg', case p_type when 'batch' then 30 end, case p_type when 'batch' then 72 end,
      p_ver_prep, p_ver_min, p_ver_target, v_by);
end
$$;
create function pg_temp.ln(p_rec text, p_pos int, p_target text, p_qty numeric, p_unit text default 'kg') returns void language plpgsql as $$
begin
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id('r_' || p_rec), p_pos,
      (select id from reg where k = p_target), (select id from reg where k = 'k_' || p_target and p_target ~ '^sof'),
      p_qty, p_unit::public.recipe_unit, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- A stew key whose lines are beef 5 kg, soffritto 0.5 and water 1 l.
create function pg_temp.mk_stew(p_tag text, p_min int, p_target int, p_prep int default null, p_sub text default 'sof') returns void language plpgsql as $$
begin
  perform pg_temp.mk_key(p_tag, 'batch', '2026-10-01T00:00Z', p_min, p_target, p_prep);
  perform pg_temp.ln(p_tag, 1, 'beef', 5);
  insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id('r_' || p_tag), 2, pg_temp.id('k_' || p_sub), 0.5, 'kg', 'a1000000-0000-4000-8000-00000000000a');
  perform pg_temp.ln(p_tag, 3, 'water', 1, 'l');
end
$$;
create function pg_temp.mk_batch(p_tag text, p_portions int, p_use_by timestamptz) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_seq int := nextval('pg_temp.lot_seq');
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
      output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, location_id, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', pg_temp.id('k_' || p_tag), pg_temp.id('r_' || p_tag), 1, '261023-SPEZZA-' || v_seq, '2026-10-23', 'SPEZZA', v_seq,
      p_use_by - interval '72 hours', 'c1000000-0000-4000-8000-00000000000c', 6, 'kg', greatest(p_portions, 1), greatest(p_portions, 1), 72, p_use_by,
      pg_temp.id('cella'), 'c1000000-0000-4000-8000-00000000000c');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', greatest(p_portions, 1), 'batch', v_id, '2026-10-23', 'c1000000-0000-4000-8000-00000000000c');
  return v_id;
end
$$;
-- Runs the rule at an instant with only these keys active; returns the number of new alerts.
create function pg_temp.run(p_at text, p_tags text[]) returns integer language plpgsql as $$
begin
  update public.recipe_key k set is_active = exists (select 1 from reg where reg.id = k.id and substr(reg.k, 3) = any (p_tags))
   where k.tenant_id = '11111111-1111-4111-8111-111111111111' and k.type = 'batch';
  return app.prep_rule('11111111-1111-4111-8111-111111111111', p_at::timestamptz);
end
$$;
create function pg_temp.kinds(p_tag text) returns text language sql as $$
  select coalesce(string_agg(a.kind, ',' order by a.kind), '-') from public.alert a where a.entity_id = pg_temp.id('k_' || p_tag) and a.entity_type = 'recipe_key' $$;
create function pg_temp.pl(p_tag text, p_kind text) returns jsonb language sql as $$
  select a.payload from public.alert a where a.entity_id = pg_temp.id('k_' || p_tag) and a.kind = p_kind $$;

select pg_temp.mk_ing('beef', 'Manzo muscolo (demo)');
select pg_temp.mk_ing('onion', 'Cipolla (demo)');
select pg_temp.mk_ing('carrot', 'Carota (demo)');
select pg_temp.mk_ing('water', 'Acqua (demo)', 'l', false);
select pg_temp.mk_key('sof', 'sub');
select pg_temp.ln('sof', 1, 'onion', 0.6);
select pg_temp.ln('sof', 2, 'carrot', 0.4);
create temporary table res (k text primary key, v integer);

-- AT1: remaining 4 < min 5, beef 12.3 kg: one prep_due ------------------------------------------------------------------------
select pg_temp.mk_stew('a', 5, 30, 180);
select pg_temp.mk_batch('a', 4, '2026-12-31T08:00Z');
select pg_temp.stock('beef', 12.3);
select pg_temp.stock('onion', 2);
select pg_temp.stock('carrot', 2);
insert into res select 'a1', pg_temp.run('2026-11-02T08:00:00Z', array['a']);
select is((select v from res where k = 'a1'), 1, 'AT1: the run raises one new alert');
select is(pg_temp.kinds('a'), 'prep_due', 'AT1: it is a prep_due, and there is no prep_raw_short');
select is(pg_temp.pl('a', 'prep_due'),
  ('{"recipe_key":"' || pg_temp.id('k_a') || '","recipe_id":"' || pg_temp.id('r_a') || '","remaining_portions_qty":4,"min_portions_count":5,"target_portions_count":30,"batches_count":1,"prep_hours":3,"ingredient_id":"' || pg_temp.id('beef') || '","needed_qty":5.0,"on_hand_qty":12.3,"unit":"kg"}')::jsonb,
  'AT1: the payload holds the portions, the batches, the prep hours, beef 5,0 needed of 12,3 on hand, unit kg');
select is((select audience_roles::text || ' ' || severity::text || ' ' || business_date::text || ' ' || entity_type from public.alert where kind = 'prep_due'),
  '{owner,chef} warning 2026-11-02 recipe_key', 'owner and chef, warning, the Rome date, entity recipe_key');
select is((select count(*)::int from public.alert a where a.kind = 'prep_due' and app.chef_payload_allowed(a.payload)), 1, 'the payload passes the chef allow-list');
insert into res select 'a2', pg_temp.run('2026-11-02T09:00:00Z', array['a']);
insert into res select 'a3', pg_temp.run('2026-11-02T22:30:00Z', array['a']);
select is((select v from res where k = 'a2') + (select v from res where k = 'a3'), 0, 'AT4 part: later runs the same Rome day raise nothing');
select is((select count(*)::int from public.alert), 1, 'and there is still one alert');

-- AT2: beef 3.0 kg: the purchase suggestion instead of the prep alert ------------------------------------------------------------
select pg_temp.mk_stew('b', 5, 30, 180);
select pg_temp.mk_batch('b', 4, '2026-12-31T08:00Z');
select pg_temp.stock('beef', 3.0);
insert into res select 'b1', pg_temp.run('2026-11-03T08:00:00Z', array['b']);
select is(pg_temp.kinds('b'), 'prep_raw_short', 'AT2: one prep_raw_short and no prep_due');
select is(pg_temp.pl('b', 'prep_raw_short'),
  ('{"recipe_key":"' || pg_temp.id('k_b') || '","recipe_id":"' || pg_temp.id('r_b') || '","remaining_portions_qty":4,"min_portions_count":5,"ingredient_id":"' || pg_temp.id('beef') || '","needed_qty":5.0,"on_hand_qty":3.0,"unit":"kg","short_count":1,"supplier_id":null,"order_by_at":null,"delivery_date":null}')::jsonb,
  'AT2: needed 5,0, on hand 3,0, short_count 1 and the supplier fields null');
select is((select audience_roles::text from public.alert where kind = 'prep_raw_short'), '{owner,chef}', 'it reaches the owner and the chef');

-- With the Macelleria supplier preferred for beef: its window at Monday 2026-11-02 15:00 Rome.
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, is_preferred, is_active)
  values ('51000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', pg_temp.id('beef'), 'MZ5', 1, 5, 'kg', true, true);
select pg_temp.mk_stew('c', 5, 30);
select pg_temp.mk_batch('c', 4, '2026-12-31T08:00Z');
insert into res select 'c1', pg_temp.run('2026-11-02T14:00:00Z', array['c']);
select is(pg_temp.pl('c', 'prep_raw_short') - 'recipe_key' - 'recipe_id',
  ('{"remaining_portions_qty":4,"min_portions_count":5,"ingredient_id":"' || pg_temp.id('beef') || '","needed_qty":5,"on_hand_qty":3,"unit":"kg","short_count":1,"supplier_id":"5a000000-0000-4000-8000-00000000005a","order_by_at":"2026-11-03T10:00:00Z","delivery_date":"2026-11-05"}')::jsonb,
  'AT2 with the preferred supplier: supplier_id, order_by_at (Tue 11:00 Rome) and delivery_date (Thu) from the window');
update public.supplier set delivery_weekdays = '{}' where id = '5a000000-0000-4000-8000-00000000005a';
select pg_temp.mk_stew('c2', 5, 30);
select pg_temp.mk_batch('c2', 4, '2026-12-31T08:00Z');
insert into res select 'c2', pg_temp.run('2026-11-02T14:00:00Z', array['c2']);
select is(pg_temp.pl('c2', 'prep_raw_short') ->> 'supplier_id', null, 'a preferred supplier without a window gives null supplier fields (all three)');
select is(pg_temp.pl('c2', 'prep_raw_short') ->> 'order_by_at', null, 'including the deadline');
update public.supplier set delivery_weekdays = '{1,4}' where id = '5a000000-0000-4000-8000-00000000005a';

-- Edges ---------------------------------------------------------------------------------------------------------------------
select pg_temp.stock('beef', 12.3);
select pg_temp.mk_stew('e1', 5, 30);
select pg_temp.mk_batch('e1', 5, '2026-12-31T08:00Z');
insert into res select 'e1', pg_temp.run('2026-11-04T08:00:00Z', array['e1']);
select is(pg_temp.kinds('e1'), '-', 'remaining exactly 5 (= the minimum): nothing');

select pg_temp.mk_stew('e2', 5, 30);
select pg_temp.mk_batch('e2', 4, '2026-12-31T08:00Z');
select pg_temp.mk_batch('e2', 10, '2026-11-05T07:00Z');
insert into res select 'e2', pg_temp.run('2026-11-05T08:00:00Z', array['e2']);
select is(pg_temp.kinds('e2'), 'prep_due', 'an expired batch with 10 portions does not count: remaining 4 gives the alert');
select is((pg_temp.pl('e2', 'prep_due') ->> 'remaining_portions_qty')::numeric, 4::numeric, 'with remaining 4');

select pg_temp.mk_stew('e3', 5, 70);
select pg_temp.mk_batch('e3', 4, '2026-12-31T08:00Z');
insert into res select 'e3', pg_temp.run('2026-11-06T08:00:00Z', array['e3']);
select is((pg_temp.pl('e3', 'prep_due') ->> 'batches_count')::int, 2, 'target 70, beef 12,3: wanted 3 batches, only 2 possible -> 2');
select is((pg_temp.pl('e3', 'prep_due') ->> 'needed_qty')::numeric, 10::numeric, 'and the needed quantity is 10,0 (2 x 5)');
select is((pg_temp.pl('e3', 'prep_due') ->> 'target_portions_count')::int, 70, 'the target is in the payload');

select pg_temp.stock('beef', 7);
select pg_temp.mk_stew('e4', 5, 70);
select pg_temp.mk_batch('e4', 4, '2026-12-31T08:00Z');
insert into res select 'e4', pg_temp.run('2026-11-07T08:00:00Z', array['e4']);
select is((pg_temp.pl('e4', 'prep_due') ->> 'batches_count')::int, 1, 'beef 7 with target 70: one batch is possible');
select is((pg_temp.pl('e4', 'prep_due') ->> 'on_hand_qty')::numeric, 7::numeric, 'on hand 7');

select pg_temp.stock('beef', 12.3);
select pg_temp.stock('onion', 0.4);
select pg_temp.mk_stew('e5', 5, 30);
select pg_temp.mk_batch('e5', 4, '2026-12-31T08:00Z');
insert into res select 'e5', pg_temp.run('2026-11-08T08:00:00Z', array['e5']);
select is(pg_temp.kinds('e5'), 'prep_due', 'onion 0,4 kg still allows one batch (needs 0,3)');
select is((pg_temp.pl('e5', 'prep_due') ->> 'ingredient_id')::uuid, pg_temp.id('onion'), 'and the binding ingredient is the onion (lowest ratio), found through the sub-recipe');
select is((pg_temp.pl('e5', 'prep_due') ->> 'needed_qty')::numeric, 0.3::numeric, 'with 0,3 kg needed per batch');
select pg_temp.stock('onion', 0.2);
select pg_temp.mk_stew('e5b', 5, 30);
select pg_temp.mk_batch('e5b', 4, '2026-12-31T08:00Z');
insert into res select 'e5b', pg_temp.run('2026-11-08T09:00:00Z', array['e5b']);
select is(pg_temp.kinds('e5b'), 'prep_raw_short', 'onion 0,2 kg cannot make a batch: raw short');
select is((pg_temp.pl('e5b', 'prep_raw_short') ->> 'ingredient_id')::uuid, pg_temp.id('onion'), 'naming the onion');
select is((pg_temp.pl('e5b', 'prep_raw_short') ->> 'short_count')::int, 1, 'as the only short ingredient');
select pg_temp.stock('carrot', 0);
insert into res select 'e5c', pg_temp.run('2026-11-09T09:00:00Z', array['e5b']);
select is((pg_temp.pl('e5b', 'prep_raw_short') ->> 'short_count')::int, 1, '(the first alert of the day stands; the next day tells more)');
select pg_temp.mk_stew('e5d', 5, 30);
select pg_temp.mk_batch('e5d', 4, '2026-12-31T08:00Z');
insert into res select 'e5d', pg_temp.run('2026-11-09T09:00:00Z', array['e5d']);
select is((pg_temp.pl('e5d', 'prep_raw_short') ->> 'short_count')::int, 2, 'onion and carrot both short: short_count 2');
select is((pg_temp.pl('e5d', 'prep_raw_short') ->> 'ingredient_id')::uuid, pg_temp.id('carrot'), 'the binding one is the lowest ratio (carrot 0 / 0,2)');
select pg_temp.stock('onion', 2);
select pg_temp.stock('carrot', 2);

select pg_temp.mk_stew('e6', 0, 30);
select pg_temp.mk_batch('e6', 1, '2026-12-31T08:00Z');
insert into res select 'e6', pg_temp.run('2026-11-10T08:00:00Z', array['e6']);
select is(pg_temp.kinds('e6'), '-', 'a rule minimum of 0 switches the rule off');

select pg_temp.mk_stew('e7', 5, 30);
select pg_temp.mk_batch('e7', 4, '2026-12-31T08:00Z');
update public.recipe_key set is_active = false where id = pg_temp.id('k_e7');
insert into res select 'e7', app.prep_rule('11111111-1111-4111-8111-111111111111', '2026-11-10T08:00:00Z');
select is(pg_temp.kinds('e7'), '-', 'an inactive key raises nothing (and the run is 0 when no key is active)');

-- A batch at -2 portions counts as 0: remaining 0 + 4 -> the negative one adds nothing (M15's waste rows make this real).
select pg_temp.mk_stew('e8', 5, 30);
select pg_temp.mk_batch('e8', 4, '2026-12-31T08:00Z');
alter table public.batch_movement drop constraint if exists batch_movement_m14_ck;
select pg_temp.mk_batch('e8', 1, '2026-12-31T08:00Z');
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
  select tenant_id, id, 'waste', -3, 'spoilage', 'waste', id, '2026-10-24', created_by from public.batch where recipe_key = pg_temp.id('k_e8') and portions_initial = 1;
insert into res select 'e8', pg_temp.run('2026-11-11T08:00:00Z', array['e8']);
select is((pg_temp.pl('e8', 'prep_due') ->> 'remaining_portions_qty')::numeric, 4::numeric, 'a batch at -2 portions counts as 0: remaining 4, not 2');

-- Version values apply when the key has no rule; a null target means "up to the minimum".
select pg_temp.mk_key('v', 'batch', '2026-10-01T00:00Z', null, null, null, 5, null, 90);
select pg_temp.ln('v', 1, 'beef', 5);
select pg_temp.mk_batch('v', 4, '2026-12-31T08:00Z');
insert into res select 'v', pg_temp.run('2026-11-12T08:00:00Z', array['v']);
select is(pg_temp.kinds('v'), 'prep_due', 'the version''s minimum 5 applies when the key has no rule');
select is(pg_temp.pl('v', 'prep_due') ->> 'target_portions_count', null, 'a missing target is null in the payload');
select is((pg_temp.pl('v', 'prep_due') ->> 'prep_hours')::numeric, 1.5::numeric, 'prep 90 min is 1,5 hours (the version''s)');
select is((pg_temp.pl('v', 'prep_due') ->> 'batches_count')::int, 1, 'and one batch brings it to the minimum');
select pg_temp.mk_stew('np', 5, 30);
select pg_temp.mk_batch('np', 4, '2026-12-31T08:00Z');
insert into res select 'np', pg_temp.run('2026-11-12T09:00:00Z', array['np']);
select is(pg_temp.pl('np', 'prep_due') ->> 'prep_hours', null, 'no prep time: prep_hours is null');

-- A recipe with no stock ingredient: prep_due with the ingredient fields null.
select pg_temp.mk_key('w', 'batch', '2026-10-01T00:00Z', 5, 30);
select pg_temp.ln('w', 1, 'water', 1, 'l');
select pg_temp.mk_batch('w', 2, '2026-12-31T08:00Z');
insert into res select 'w', pg_temp.run('2026-11-13T08:00:00Z', array['w']);
select is(pg_temp.pl('w', 'prep_due') - 'recipe_key' - 'recipe_id',
  '{"remaining_portions_qty":2,"min_portions_count":5,"target_portions_count":30,"batches_count":1,"prep_hours":null,"ingredient_id":null,"needed_qty":null,"on_hand_qty":null,"unit":null}'::jsonb,
  'water only: prep_due with null ingredient fields (batches = wanted = 1)');

-- A recipe that cannot be expanded is skipped and recorded; the other recipe goes on.
select pg_temp.mk_key('late', 'sub', '2027-01-01T00:00Z');
select pg_temp.ln('late', 1, 'onion', 1);
select pg_temp.mk_stew('bad', 5, 30, null, 'late');
select pg_temp.mk_batch('bad', 4, '2026-12-31T08:00Z');
select pg_temp.mk_stew('good', 5, 30);
select pg_temp.mk_batch('good', 4, '2026-12-31T08:00Z');
insert into res select 'bad', pg_temp.run('2026-11-14T08:00:00Z', array['bad', 'good']);
select is((select v from res where k = 'bad'), 1, 'two recipes below the minimum, one cannot be produced: one alert');
select is(pg_temp.kinds('bad'), '-', 'the recipe whose sub-recipe is not in force raises no alert');
select is(pg_temp.kinds('good'), 'prep_due', 'the other recipe still alerts');
select is((select caller || ' ' || code || ' ' || sqlstate || ' ' || kind || ' ' || entity_type from app.alert_refusal where entity_id = pg_temp.id('k_bad')),
  'prep_rules recipe_not_producible P0001  recipe_key', 'one alert_refusal: caller prep_rules, code recipe_not_producible, P0001');
select is((select count(*)::int from app.alert_refusal), 1, 'and only that one');

-- Tenant isolation: tenant B's identical situation gets B's own alert only.
select pg_temp.mk_ing('beefb', 'Manzo B (demo)', 'kg', true, '22222222-2222-4222-8222-222222222222');
select pg_temp.mk_lot('beefb', null, 3, '22222222-2222-4222-8222-222222222222');
insert into reg values ('k_bst', gen_random_uuid()), ('r_bst', gen_random_uuid());
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by, rule_min_portions)
  values (pg_temp.id('k_bst'), '22222222-2222-4222-8222-222222222222', 'batch', 1, 'spezzatino b', 'b1000000-0000-4000-8000-00000000000b', 5);
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by)
  values (pg_temp.id('r_bst'), '22222222-2222-4222-8222-222222222222', pg_temp.id('k_bst'), 1, '2026-10-01T00:00Z', 'Spezzatino B (demo)', 6, 'kg', 30, 72, 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by)
  values ('22222222-2222-4222-8222-222222222222', pg_temp.id('r_bst'), 1, pg_temp.id('beefb'), 5, 'kg', 'b1000000-0000-4000-8000-00000000000b');
update public.recipe_key set is_active = false where tenant_id = '11111111-1111-4111-8111-111111111111';
select is(app.prep_rule('11111111-1111-4111-8111-111111111111', '2026-11-15T08:00:00Z'), 0, 'tenant A''s run (nothing active below the minimum) raises 0 and writes nothing for B');
select is(app.prep_rule('22222222-2222-4222-8222-222222222222', '2026-11-15T08:00:00Z'), 1, 'tenant B''s run raises its own alert');
select is((select a.tenant_id::text || ' ' || a.kind from public.alert a where a.entity_id = pg_temp.id('k_bst')),
  '22222222-2222-4222-8222-222222222222 prep_raw_short', 'for tenant B, raw short (beef 3 of 5)');
select is((select count(*)::int from public.alert a where a.tenant_id = '11111111-1111-4111-8111-111111111111' and a.business_date = '2026-11-15'), 0, 'and none for tenant A on that day');

-- An expired lot is not usable stock: beef 13 in total, 10 of it expired yesterday.
update public.recipe_key set is_active = true where tenant_id = '11111111-1111-4111-8111-111111111111' and id = pg_temp.id('k_e1');
select pg_temp.stock('beef', 3);
select pg_temp.mk_lot('beef', '2026-11-16', 10);
select pg_temp.mk_stew('x', 5, 30);
select pg_temp.mk_batch('x', 4, '2026-12-31T08:00Z');
insert into res select 'x1', pg_temp.run('2026-11-17T08:00:00Z', array['x']);
select is(pg_temp.kinds('x'), 'prep_raw_short', 'a beef lot that expired yesterday (10 kg) is not usable: total 13, usable 3 -> raw short');
select is((pg_temp.pl('x', 'prep_raw_short') ->> 'on_hand_qty')::numeric, 3::numeric, 'with 3 on hand');
select pg_temp.mk_stew('x2', 5, 30);
select pg_temp.mk_batch('x2', 4, '2026-12-31T08:00Z');
insert into res select 'x2', pg_temp.run('2026-11-16T08:00:00Z', array['x2']);
select is(pg_temp.kinds('x2'), 'prep_due', 'the day before, the same lot is still usable: 13 on hand -> prep_due');

-- The same instant, the same data: the same answer under any session zone.
select pg_temp.mk_stew('z', 5, 30);
select pg_temp.mk_batch('z', 4, '2026-12-31T08:00Z');
set local timezone = 'America/New_York';
insert into res select 'z1', pg_temp.run('2026-10-25T00:30:00Z', array['z']);
select is((select a.business_date::text from public.alert a where a.entity_id = pg_temp.id('k_z')), '2026-10-25',
  'DST day, run at 02:30 CEST under America/New_York: the Rome date 2026-10-25');
set local timezone = 'Europe/Rome';

-- Closed to every API role.
select is_empty(
  $$ select p.proname || ':' || r from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
      where p.pronamespace = 'app'::regnamespace and p.proname in ('prep_rule', 'raise_rule_alert')
        and has_function_privilege(r, p.oid, 'execute') $$,
  'no API role can execute app.prep_rule or app.raise_rule_alert');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('prep_rule', 'raise_rule_alert') and p.prosecdef
            and p.proconfig @> array['search_path=""']), 2, 'both are security definer with an empty search_path');
select is((select count(*)::int from public.alert a where not app.chef_payload_allowed(a.payload)), 0, 'every payload raised passes the chef allow-list');
select is((select count(*)::int from public.alert a where a.cost_bearing or app.payload_money_keys(a.payload) <> '{}'), 0, 'and none has a money key');

select * from finish();
rollback;
