-- Demo data step 1 (migration 20261105100000_demo_tenant_flag.sql; ADR-018): tenant.is_demo can never change, at most one
-- demo tenant exists, create_demo_tenant (service role) makes it with its owner, admin and one audit row, and the audit
-- action check still accepts every earlier action. Two real tenants (R1, R2) are used so no test depends on "the" tenant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ':' || msg;
end
$$;

-- The 32 actions that existed before this branch (26 + the six of M17) (the union, written out by hand) plus the new one: each must be accepted.
create function pg_temp.rejected_actions(p_tenant uuid, p_by uuid) returns text[] language plpgsql as $$
declare
  a text;
  bad text[] := '{}';
begin
  foreach a in array array[
    'invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared', 'ingredient.allergens_confirmed',
    'recipe.deactivated', 'recipe.reactivated', 'tenant.settings_changed', 'payable.status_changed',
    'payable.payment_reversed', 'app_user.created', 'app_user.updated', 'app_user.deactivated',
    'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created', 'venue_device.enrolled',
    'venue_device.revoked', 'venue_device.unlocked', 'count_session.closed', 'count_session.cancelled',
    'ingredient.critical_changed', 'staff_meal_rule.created', 'staff_meal_rule.updated',
    'ingredient.rules_changed', 'supplier.delivery_changed', 'recipe.rules_changed',
    'menu_item.created', 'menu_item.updated', 'dining_table.created', 'dining_table.updated',
    'table_session.covers_changed', 'sale_settings.changed', 'tenant.demo_created']
  loop
    begin
      insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
        values (p_tenant, 'tenant', p_tenant, a, p_by);
    exception when check_violation then
      bad := bad || a;
    end;
  end loop;
  return bad;
end
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-0000000000a1', 'owner-r1@example.test'),
  ('a0000000-0000-4000-8000-0000000000a2', 'owner-r2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d1', 'owner-demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'admin-demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d3', 'owner-demo-2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d4', 'admin-demo-2@example.test');

select public.create_tenant_with_owner('Locale Uno (demo)', 'IT00000000001', 'a0000000-0000-4000-8000-0000000000a1', 'Titolare Uno (demo)');
select public.create_tenant_with_owner('Locale Due (demo)', 'IT00000000002', 'a0000000-0000-4000-8000-0000000000a2', 'Titolare Due (demo)');

-- The column ----------------------------------------------------------------------------------------------------------------------------
select col_not_null('public', 'tenant', 'is_demo', 'is_demo is not null');
select col_default_is('public', 'tenant', 'is_demo', 'false', 'and defaults to false');
select is((select count(*)::int from public.tenant where is_demo), 0, 'no tenant is a demo yet');
select is((select count(*)::int from public.tenant where vat_number in ('IT00000000001', 'IT00000000002') and not is_demo), 2,
          'create_tenant_with_owner still makes real tenants (is_demo false), two of them');

-- Grants --------------------------------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.create_demo_tenant(text, text, uuid, text, uuid, text)', 'execute'), 'service_role can execute create_demo_tenant');
select ok(not has_function_privilege('authenticated', 'public.create_demo_tenant(text, text, uuid, text, uuid, text)', 'execute'), 'authenticated cannot');
select ok(not has_function_privilege('anon', 'public.create_demo_tenant(text, text, uuid, text, uuid, text)', 'execute'), 'anon cannot');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role)
           where has_function_privilege(r.role, 'app.tenant_is_demo(uuid)', 'execute')), 0, 'no API role can execute app.tenant_is_demo');

-- Validation: a bad VAT or one auth user for both roles fails and leaves nothing behind (the demo does not exist yet).
set local role service_role;
select is(left(pg_temp.err($$ select public.create_demo_tenant('Prova (demo)', 'bad-vat', 'd0000000-0000-4000-8000-0000000000d3', 'A (demo)', 'd0000000-0000-4000-8000-0000000000d4', 'B (demo)') $$), 5),
          '23514', 'a malformed VAT is refused');
select is(left(pg_temp.err($$ select public.create_demo_tenant('Prova (demo)', 'IT00000000096', 'd0000000-0000-4000-8000-0000000000d3', 'A (demo)', 'd0000000-0000-4000-8000-0000000000d3', 'B (demo)') $$), 5),
          '23505', 'one auth user for owner and admin is refused');
reset role;
select is((select count(*)::int from public.tenant where vat_number in ('IT00000000096', 'IT00000000095')), 0, 'and no half-created tenant remains');

-- create_demo_tenant ---------------------------------------------------------------------------------------------------------------------
set local role service_role;
select is(pg_temp.err($$ select public.create_demo_tenant('Osteria Demo (dati di prova)', 'IT00000000099',
  'd0000000-0000-4000-8000-0000000000d1', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d2', 'Supporto DigiAlto (demo)') $$),
  'ok', 'service_role creates the demo tenant');
reset role;

select is((select count(*)::int from public.tenant where is_demo), 1, 'exactly one demo tenant');
select is((select name from public.tenant where is_demo), 'Osteria Demo (dati di prova)', 'with the given name');
select is((select vat_number from public.tenant where is_demo), 'IT00000000099', 'and VAT');
select is((select string_agg(u.role::text || ':' || u.login_method::text || ':' || u.display_name, ',' order by u.role)
             from public.app_user u join public.tenant t on t.id = u.tenant_id where t.is_demo),
          'owner:email:Titolare (demo),admin:email:Supporto DigiAlto (demo)'::text, 'an email owner and an email admin');
select is((select u.auth_id::text from public.app_user u join public.tenant t on t.id = u.tenant_id where t.is_demo and u.role = 'owner'),
          'd0000000-0000-4000-8000-0000000000d1', 'the owner is the first auth user');
select is((select u.auth_id::text from public.app_user u join public.tenant t on t.id = u.tenant_id where t.is_demo and u.role = 'admin'),
          'd0000000-0000-4000-8000-0000000000d2', 'the admin is the second auth user');
select is((select u.id from public.app_user u join public.tenant t on t.id = u.tenant_id where t.is_demo and u.role = 'owner'),
          (select t.created_by from public.tenant t where t.is_demo), 'tenant.created_by is the owner row');
select is((select count(*)::int from public.audit_event e join public.tenant t on t.id = e.tenant_id
            where t.is_demo and e.action = 'tenant.demo_created' and e.entity_type = 'tenant' and e.entity_id = t.id
              and e.created_by = t.created_by), 1, 'one tenant.demo_created audit row, by the owner row');
select is((select count(*)::int from public.audit_event e join public.tenant t on t.id = e.tenant_id where t.is_demo), 1, 'and nothing else');
select is((select count(*)::int from public.tenant where not is_demo), 2, 'the two real tenants are untouched');
select is((select count(*)::int from public.audit_event e join public.tenant t on t.id = e.tenant_id where not t.is_demo), 0, 'and have no audit rows');

set local role service_role;
select is(pg_temp.err($$ select public.create_demo_tenant('Altro (demo)', 'IT00000000098',
  'd0000000-0000-4000-8000-0000000000d3', 'Titolare Due (demo)', 'd0000000-0000-4000-8000-0000000000d4', 'Supporto Due (demo)') $$),
  'P0001:demo_tenant_exists', 'a second demo tenant is refused with demo_tenant_exists');
reset role;
select is((select count(*)::int from public.tenant where vat_number = 'IT00000000098'), 0, 'and nothing was written');

-- The index backs the rule even when the function is bypassed.
select is(left(pg_temp.err($$ insert into public.tenant (name, vat_number, is_demo) values ('Doppio (demo)', 'IT00000000097', true) $$), 5),
          '23505', 'a second is_demo row is refused by the unique index');
select is((select count(*)::int from pg_indexes where indexname = 'tenant_one_demo_uq'), 1, 'index tenant_one_demo_uq exists');

-- is_demo never changes ------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ update public.tenant set is_demo = false where is_demo $$), 'P0001:tenant_is_demo_immutable', 'demo true to false: refused (migration owner)');
select is(pg_temp.err($$ update public.tenant set is_demo = true where vat_number = 'IT00000000001' $$), 'P0001:tenant_is_demo_immutable', 'real false to true: refused (migration owner)');
select is(pg_temp.err($$ update public.tenant set is_demo = true where vat_number = 'IT00000000002' $$), 'P0001:tenant_is_demo_immutable', 'for the second real tenant too');
set local role service_role;
select is(pg_temp.err($$ update public.tenant set is_demo = false where is_demo $$), 'P0001:tenant_is_demo_immutable', 'demo true to false: refused (service_role)');
select is(pg_temp.err($$ update public.tenant set is_demo = true where vat_number = 'IT00000000001' $$), 'P0001:tenant_is_demo_immutable', 'real false to true: refused (service_role)');
select is(pg_temp.err($$ update public.tenant set name = 'Locale Uno rinominato (demo)' where vat_number = 'IT00000000001' $$), 'ok', 'a name update still works');
select is(pg_temp.err($$ update public.tenant set is_demo = is_demo, name = name || '!' where is_demo $$), 'ok', 'and an update that leaves is_demo as it is');
reset role;
select is((select count(*)::int from public.tenant where is_demo), 1, 'still exactly one demo tenant');

-- The audit action check ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.rejected_actions((select id from public.tenant where vat_number = 'IT00000000001'),
                                   (select id from public.app_user where auth_id = 'a0000000-0000-4000-8000-0000000000a1')),
          '{}'::text[], 'all 32 earlier audit actions (M17 included) and tenant.demo_created are accepted');
select is(left(pg_temp.err($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  select id, 'tenant', id, 'tenant.something_else', (select id from public.app_user limit 1) from public.tenant limit 1 $$), 5),
  '23514', 'an unknown action is still refused');

select * from finish();
rollback;
