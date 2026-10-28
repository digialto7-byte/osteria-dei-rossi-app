-- Demo data step 1 (migration 20261105100000_demo_data_marker.sql; ADR-018 revision 1): tenant.demo_data_since marks a tenant
-- that was filled with demo data. It is set only by begin_demo_data (service role), only on a tenant that holds no operational
-- data, and no role can change it any other way. begin_demo_data adds the demo owner and admin next to the tenant's own users
-- and writes one audit row. The audit action check still accepts every earlier action. R1 and R2 are unmarked tenants; T is
-- the target (a real tenant with its own founder-owner, as the founder's tenant is).
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

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

-- The 32 actions that existed before this branch (26 + the six of M17), written out by hand, plus the two new ones: each must be accepted.
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
    'table_session.covers_changed', 'sale_settings.changed', 'tenant.demo_data_loaded', 'tenant.demo_data_removed']
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
  ('f0000000-0000-4000-8000-0000000000f1', 'owner-t@example.test'),
  ('d0000000-0000-4000-8000-0000000000d1', 'owner.demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'admin.demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d3', 'owner.demo2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d4', 'admin.demo2@example.test');

select public.create_tenant_with_owner('Locale Uno (demo)', 'IT00000000001', 'a0000000-0000-4000-8000-0000000000a1', 'Titolare Uno (demo)');
select public.create_tenant_with_owner('Locale Due (demo)', 'IT00000000002', 'a0000000-0000-4000-8000-0000000000a2', 'Titolare Due (demo)');
select public.create_tenant_with_owner('Locale Target (demo)', 'IT00000000003', 'f0000000-0000-4000-8000-0000000000f1', 'Titolare Target (demo)');
create temp table ctx as
  select (select id from public.tenant where vat_number = 'IT00000000001') as r1,
         (select id from public.tenant where vat_number = 'IT00000000002') as r2,
         (select id from public.tenant where vat_number = 'IT00000000003') as t;
grant select on ctx to public;
update public.tenant set settings = settings || '{"kept": "yes"}'::jsonb where vat_number = 'IT00000000003';

-- The column ----------------------------------------------------------------------------------------------------------------------------
select col_type_is('public', 'tenant', 'demo_data_since', 'timestamp with time zone', 'demo_data_since is a timestamptz');
select col_is_null('public', 'tenant', 'demo_data_since', 'and nullable');
select hasnt_column('public', 'tenant', 'is_demo', 'there is no is_demo column any more');
select is((select count(*)::int from public.tenant where demo_data_since is not null), 0, 'no tenant is marked yet; create_tenant_with_owner marks none');

-- Grants --------------------------------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.begin_demo_data(uuid, uuid, text, uuid, text)', 'execute'), 'service_role can execute begin_demo_data');
select ok(not has_function_privilege('authenticated', 'public.begin_demo_data(uuid, uuid, text, uuid, text)', 'execute'), 'authenticated cannot');
select ok(not has_function_privilege('anon', 'public.begin_demo_data(uuid, uuid, text, uuid, text)', 'execute'), 'anon cannot');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role), unnest(array['app.tenant_is_demo(uuid)', 'app.tenant_has_operational_data(uuid)']) f(fn)
           where has_function_privilege(r.role, f.fn, 'execute')), 0, 'no API role can execute tenant_is_demo or tenant_has_operational_data');

-- tenant_has_operational_data ----------------------------------------------------------------------------------------------------------------
insert into public.location (tenant_id, name) select r2, 'Luogo (demo)' from ctx;
select is((select array[app.tenant_has_operational_data(r1), app.tenant_has_operational_data(r2), app.tenant_has_operational_data(t),
                        app.tenant_has_operational_data(gen_random_uuid())] from ctx),
          array[false, true, false, false], 'only a tenant with a row in a data table has operational data (users, audit and devices do not count)');

-- Refusals: nothing is written ----------------------------------------------------------------------------------------------------------------
set local role service_role;
select is(pg_temp.err(format('select public.begin_demo_data(%L, %L, %L, %L, %L)', gen_random_uuid(), 'd0000000-0000-4000-8000-0000000000d3', 'A (demo)', 'd0000000-0000-4000-8000-0000000000d4', 'B (demo)')),
          'P0001:tenant_not_found', 'an unknown tenant: tenant_not_found');
select is(pg_temp.err(format('select public.begin_demo_data(%L, %L, %L, %L, %L)', (select r2 from ctx), 'd0000000-0000-4000-8000-0000000000d3', 'A (demo)', 'd0000000-0000-4000-8000-0000000000d4', 'B (demo)')),
          'P0001:tenant_has_operational_data', 'a tenant that holds data: tenant_has_operational_data');
select is(left(pg_temp.err(format('select public.begin_demo_data(%L, %L, %L, %L, %L)', (select t from ctx), 'd0000000-0000-4000-8000-0000000000d3', 'A (demo)', 'd0000000-0000-4000-8000-0000000000d3', 'B (demo)')), 5),
          '23505', 'one auth user for owner and admin is refused');
select is(left(pg_temp.err(format('select public.begin_demo_data(%L, %L, %L, %L, %L)', (select t from ctx), 'f0000000-0000-4000-8000-0000000000f1', 'A (demo)', 'd0000000-0000-4000-8000-0000000000d4', 'B (demo)')), 5),
          '23505', 'and so is an auth user that already belongs to a user (the founder''s own account is never reused)');
reset role;
select is((select count(*)::int from public.tenant where demo_data_since is not null), 0, 'none of those marked a tenant');
select is((select count(*)::int from public.app_user u join ctx on u.tenant_id in (ctx.r1, ctx.r2, ctx.t)), 3, 'and added no user');
select is((select count(*)::int from public.audit_event), 0, 'or audit row');

-- begin_demo_data on the target -----------------------------------------------------------------------------------------------------------------
create temp table before_t as select settings, (select count(*) from public.app_user where tenant_id = (select t from ctx)) as users from public.tenant where id = (select t from ctx);
grant select on before_t to public;
set local role service_role;
select is(pg_temp.err(format('select public.begin_demo_data(%L, %L, %L, %L, %L)', (select t from ctx), 'd0000000-0000-4000-8000-0000000000d1', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d2', 'Supporto DigiAlto (demo)')),
          'ok', 'service_role marks the empty target and adds the demo owner and admin');
reset role;

select is((select count(*)::int from public.tenant where demo_data_since is not null), 1, 'exactly one tenant is marked');
select is((select demo_data_since is not null and demo_data_since <= now() from public.tenant where id = (select t from ctx)), true, 'it is the target, marked now');
select is((select string_agg(u.role::text || ':' || u.login_method::text || ':' || u.display_name, ',' order by u.display_name)
             from public.app_user u where u.tenant_id = (select t from ctx)),
          'admin:email:Supporto DigiAlto (demo),owner:email:Titolare (demo),owner:email:Titolare Target (demo)'::text, 'the target''s own owner is still there, next to an email demo owner and an email demo admin');
select is((select u.auth_id::text from public.app_user u where u.tenant_id = (select t from ctx) and u.display_name = 'Titolare Target (demo)'), 'f0000000-0000-4000-8000-0000000000f1', 'the existing user is untouched');
select is((select u.auth_id::text from public.app_user u where u.tenant_id = (select t from ctx) and u.role = 'admin'), 'd0000000-0000-4000-8000-0000000000d2', 'the admin is the second auth user');
select is((select u.created_by = u.id from public.app_user u where u.tenant_id = (select t from ctx) and u.auth_id = 'd0000000-0000-4000-8000-0000000000d1'), true, 'the demo owner row is its own creator');
select is((select u.created_by = (select id from public.app_user where auth_id = 'd0000000-0000-4000-8000-0000000000d1') from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d2'), true, 'and created the admin');
select is((select (select count(*) from public.app_user where tenant_id = (select t from ctx)) - users from before_t), 2::bigint, 'two users were added, no more');
select is((select t.settings = b.settings from public.tenant t, before_t b where t.id = (select t from ctx)), true, 'the tenant''s settings are unchanged');
select is((select count(*)::int from public.audit_event e join ctx on e.tenant_id = ctx.t
            where e.action = 'tenant.demo_data_loaded' and e.entity_type = 'tenant' and e.entity_id = ctx.t
              and e.created_by = (select id from public.app_user where auth_id = 'd0000000-0000-4000-8000-0000000000d1')), 1, 'one tenant.demo_data_loaded audit row, by the demo owner');
select is((select count(*)::int from public.audit_event), 1, 'and no other audit row anywhere');
select is((select s.settings_before = b.settings and s.owner_user = (select id from public.app_user where auth_id = 'd0000000-0000-4000-8000-0000000000d1')
                  and s.admin_user = (select id from public.app_user where auth_id = 'd0000000-0000-4000-8000-0000000000d2')
             from app.demo_state s, before_t b where s.tenant_id = (select t from ctx)), true, 'app.demo_state keeps the settings from before, and the two demo users');
select is((select count(*)::int from app.demo_state), 1, 'one state row');
select is((select count(*)::int from public.tenant where demo_data_since is null and id in (select r1 from ctx union select r2 from ctx)), 2, 'R1 and R2 are not marked');
select is((select count(*)::int from public.app_user where tenant_id in (select r1 from ctx union select r2 from ctx)), 2, 'and keep their one user each');

set local role service_role;
select is(pg_temp.err(format('select public.begin_demo_data(%L, %L, %L, %L, %L)', (select t from ctx), 'd0000000-0000-4000-8000-0000000000d3', 'A (demo)', 'd0000000-0000-4000-8000-0000000000d4', 'B (demo)')),
          'P0001:demo_data_exists', 'a second begin on a marked tenant: demo_data_exists');
reset role;
select is((select count(*)::int from public.app_user where tenant_id = (select t from ctx)), 3, 'and nothing was added');
select is(app.tenant_has_operational_data((select t from ctx)), false, 'the demo users and the audit row are not operational data');

-- The marker never changes any other way --------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ update public.tenant set demo_data_since = null where demo_data_since is not null $$), 'P0001:demo_marker_immutable', 'marked to unmarked: refused (migration owner)');
select is(pg_temp.err($$ update public.tenant set demo_data_since = now() where vat_number = 'IT00000000001' $$), 'P0001:demo_marker_immutable', 'unmarked to marked: refused (migration owner)');
select is(pg_temp.err($$ update public.tenant set demo_data_since = now() where vat_number = 'IT00000000002' $$), 'P0001:demo_marker_immutable', 'also for a tenant that holds data');
select is(pg_temp.err($$ update public.tenant set demo_data_since = now() - interval '1 year' where demo_data_since is not null $$), 'P0001:demo_marker_immutable', 'and a change of the date');
set local role service_role;
select is(pg_temp.err($$ update public.tenant set demo_data_since = null where demo_data_since is not null $$), 'P0001:demo_marker_immutable', 'marked to unmarked: refused (service_role)');
select is(pg_temp.err($$ update public.tenant set demo_data_since = now() where vat_number = 'IT00000000001' $$), 'P0001:demo_marker_immutable', 'unmarked to marked: refused (service_role)');
select is(pg_temp.err($$ update public.tenant set name = 'Locale Uno rinominato (demo)' where vat_number = 'IT00000000001' $$), 'ok', 'a name update still works');
select is(pg_temp.err($$ update public.tenant set demo_data_since = demo_data_since, name = name || '!' where demo_data_since is not null $$), 'ok', 'and an update that leaves the marker as it is');
reset role;
-- A new tenant row cannot carry the marker either: only begin_demo_data marks, and only an existing empty tenant.
select is(pg_temp.err($$ insert into public.tenant (name, vat_number, demo_data_since) values ('Nuovo (demo)', 'IT00000000004', now()) $$), 'P0001:demo_marker_immutable', 'an insert that carries the marker is refused (migration owner)');
set local role service_role;
select is(pg_temp.err($$ insert into public.tenant (name, vat_number, demo_data_since) values ('Nuovo (demo)', 'IT00000000004', now()) $$), 'P0001:demo_marker_immutable', 'and for service_role');
reset role;
select set_config('app.demo_marker_write', gen_random_uuid()::text, true);
select is(pg_temp.err($$ insert into public.tenant (name, vat_number, demo_data_since) values ('Nuovo (demo)', 'IT00000000004', now()) $$), 'P0001:demo_marker_immutable', 'even with the write setting set');
select set_config('app.demo_marker_write', '', true);
select is(pg_temp.err($$ insert into public.tenant (name, vat_number) values ('Nuovo (demo)', 'IT00000000004') $$), 'ok', 'a plain insert is fine');
select is((select demo_data_since is null from public.tenant where vat_number = 'IT00000000004'), true, 'and is not marked');

-- Even with the write setting, a tenant that holds data cannot be marked (belt and braces behind begin_demo_data).
select set_config('app.demo_marker_write', (select r2 from ctx)::text, true);
select is(pg_temp.err($$ update public.tenant set demo_data_since = now() where vat_number = 'IT00000000002' $$), 'P0001:tenant_has_operational_data', 'the write setting does not let a tenant with data be marked');
select set_config('app.demo_marker_write', (select r1 from ctx)::text, true);
select is(pg_temp.err($$ update public.tenant set demo_data_since = now() where vat_number = 'IT00000000002' $$), 'P0001:demo_marker_immutable', 'and the setting must name that very tenant');
select set_config('app.demo_marker_write', '', true);

-- The audit action check ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.rejected_actions((select r1 from ctx), (select id from public.app_user where auth_id = 'a0000000-0000-4000-8000-0000000000a1')),
          '{}'::text[], 'all 32 earlier audit actions (M17 included) and the two new ones are accepted');
select is(left(pg_temp.err($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  select id, 'tenant', id, 'tenant.something_else', (select id from public.app_user limit 1) from public.tenant limit 1 $$), 5),
  '23514', 'an unknown action is still refused');
select is((select count(*)::int from public.tenant where demo_data_since is not null), 1, 'still one marked tenant at the end');

select * from finish();
rollback;
