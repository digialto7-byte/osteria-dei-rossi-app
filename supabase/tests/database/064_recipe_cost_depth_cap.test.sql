-- M8 review fix 1: the cost walk's depth cap is the M7 one. A chain of 12 recipes is costed; a chain of
-- 13 (a recipe first reached at depth 13) fails closed with graph_too_deep, never expanded, never priced.
-- The chains are written by hand as the migration owner (the M7 procedures would refuse the 13th).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf',
          'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
    line_amount, field_confidence, extracted)
  values ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-0000000000f1', 1, 'Acquisto demo', 1, 2, 2, '{}', '{}');
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
    effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1b000000-0000-4000-8000-00000000001b',
    '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-000000000001', 2, 'kg', '2026-09-01',
    'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.k(n int) returns uuid language sql immutable as $$
  select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.v(n int) returns uuid language sql immutable as $$
  select ('ed000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- A chain of p_len subs numbered p_first .. p_first + p_len - 1: each uses 1 kg of the next, the last 1 kg
-- of flour (2.00 a kg), so every level costs 2.0000 when it is priced.
create function pg_temp.chain(p_first int, p_len int) returns void language plpgsql as $$
declare
  n int;
begin
  for n in p_first .. p_first + p_len - 1 loop
    insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
      values (pg_temp.k(n), '11111111-1111-4111-8111-111111111111', 'sub', 1, 'catena ' || n || ' (demo)',
              'a1000000-0000-4000-8000-00000000000a');
    insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
        created_by)
      values (pg_temp.v(n), '11111111-1111-4111-8111-111111111111', pg_temp.k(n), 1, '2026-09-01T00:00Z',
              'Catena ' || n || ' (demo)', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a');
  end loop;
  for n in p_first .. p_first + p_len - 1 loop
    if n < p_first + p_len - 1 then
      insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by)
        values ('11111111-1111-4111-8111-111111111111', pg_temp.v(n), 1, pg_temp.k(n + 1), 1, 'kg',
                'a1000000-0000-4000-8000-00000000000a');
    else
      insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by)
        values ('11111111-1111-4111-8111-111111111111', pg_temp.v(n), 1,
                '1b000000-0000-4000-8000-00000000001b', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a');
    end if;
  end loop;
end
$$;
-- 1 .. 13: thirteen recipes on one path. 101 .. 112: twelve.
select pg_temp.chain(1, 13);
select pg_temp.chain(101, 12);

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.k(int) to authenticated;
create function pg_temp.cost(n int) returns text language sql as $$
  select coalesce(trim_scale(round(c.total_cost, 4))::text, '-') || ' ' || c.incomplete || ' ' || c.reasons::text
    from app.recipe_costs('11111111-1111-4111-8111-111111111111', array[pg_temp.k(n)], null) c $$;

select is(pg_temp.cost(101), '2 false {}', 'a chain of 12 recipes is costed from its top');
select is(pg_temp.cost(112), '2 false {}', 'and from its bottom');
select is(pg_temp.cost(1), '- true {graph_too_deep}', 'a chain of 13 recipes fails closed from its top: graph_too_deep');
select is(pg_temp.cost(2), '2 false {}', 'the same chain from its second recipe is 12 long and is costed');
select is(pg_temp.cost(13), '2 false {}', 'its last recipe on its own is costed');

select is((select c.unit_cost from app.recipe_costs('11111111-1111-4111-8111-111111111111', array[pg_temp.k(1)], null) c),
  null, 'the failed chain has no unit cost (unknown is never zero)');
select is((select c.missing_ingredient_ids from app.recipe_costs('11111111-1111-4111-8111-111111111111', array[pg_temp.k(1)], null) c),
  '{}'::uuid[], 'and names no missing ingredient');

-- Through the public function, as the owner.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select public.recipe_cost_at(pg_temp.k(1)) ->> 'reasons'), '["graph_too_deep"]',
  'recipe_cost_at of the 13-chain top reports graph_too_deep');
select is((select public.recipe_cost_at(pg_temp.k(101)) ->> 'incomplete'), 'false',
  'recipe_cost_at of the 12-chain top is complete');

select * from finish();
rollback;
