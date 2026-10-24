-- Demo data step 2 (migration 20261105100100_demo_purge_guards.sql; ADR-018): the append-only and staff-auth guards allow a
-- DELETE only while app.demo_purge holds the id of a DEMO tenant, and only for that tenant's rows. Fixture: the demo tenant D
-- and two real tenants R1 and R2, each with two of: stock_movement, audit_event, venue_device, used device_enrolment and
-- staff_session. UPDATE, TRUNCATE, the M11 auth_purge behaviour and the grants must not change.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

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

-- Deletes every row of the tenant from the five tables, each in its own subtransaction, child tables first. Returns one
-- 'ok' or 'state:message' per table, in that order.
create function pg_temp.del(p_tenant uuid) returns text[] language plpgsql as $$
declare
  t text;
  out text[] := '{}';
begin
  foreach t in array array['stock_movement', 'audit_event', 'staff_session', 'device_enrolment', 'venue_device'] loop
    out := out || pg_temp.err(format('delete from public.%I where tenant_id = %L', t, p_tenant));
  end loop;
  return out;
end
$$;

-- The same, but only the SQLSTATEs.
create function pg_temp.del_codes(p_tenant uuid) returns text[] language sql as $$
  select array_agg(split_part(x, ':', 1) order by n) from unnest(pg_temp.del(p_tenant)) with ordinality as u(x, n)
$$;

-- Row counts: stock_movement/audit_event/staff_session/device_enrolment/venue_device.
create function pg_temp.cnt(p_tenant uuid) returns text language sql as $$
  select (select count(*) from public.stock_movement where tenant_id = p_tenant) || '/'
      || (select count(*) from public.audit_event where tenant_id = p_tenant) || '/'
      || (select count(*) from public.staff_session where tenant_id = p_tenant) || '/'
      || (select count(*) from public.device_enrolment where tenant_id = p_tenant) || '/'
      || (select count(*) from public.venue_device where tenant_id = p_tenant)
$$;

create function pg_temp.id(p_tag text, p_k text) returns uuid language sql as $$
  select md5(p_tag || ':' || p_k)::uuid
$$;

-- Two of everything for one tenant, written as the migration owner.
create function pg_temp.mk(p_tenant uuid, p_tag text) returns void language plpgsql as $$
declare
  v_owner uuid := (select id from public.app_user where tenant_id = p_tenant and role = 'owner');
  i int;
  k text;
begin
  for i in 1..2 loop
    k := i::text;
    insert into public.location (id, tenant_id, name) values (pg_temp.id(p_tag, 'loc' || k), p_tenant, 'Luogo ' || k || ' (demo)');
    insert into public.ingredient (id, tenant_id, name, base_unit) values (pg_temp.id(p_tag, 'ing' || k), p_tenant, 'Ingrediente ' || k || ' (demo)', 'kg');
    insert into public.supplier (id, tenant_id, name, vat_number) values (pg_temp.id(p_tag, 'sup' || k), p_tenant, 'Fornitore ' || k || ' (demo)', case i when 1 then 'IT12345678903' else 'IT00000000000' end);
    insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
      values (pg_temp.id(p_tag, 'inv' || k), p_tenant, p_tenant || '/2026/' || pg_temp.id(p_tag, 'inv' || k) || '.pdf', 'application/pdf', 2048, 'fattura.pdf');
    insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
      values (pg_temp.id(p_tag, 'line' || k), p_tenant, pg_temp.id(p_tag, 'inv' || k), 1, 'Riga ' || k || ' (demo)', 2, 5, 10, '{}', '{}');
    insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
      values (pg_temp.id(p_tag, 'lot' || k), p_tenant, pg_temp.id(p_tag, 'ing' || k), pg_temp.id(p_tag, 'loc' || k), pg_temp.id(p_tag, 'sup' || k), pg_temp.id(p_tag, 'line' || k), '2026-10-01', 2, 'kg', 2, 'kg', 1, v_owner);
    insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
      values (pg_temp.id(p_tag, 'mov' || k), p_tenant, pg_temp.id(p_tag, 'ing' || k), pg_temp.id(p_tag, 'lot' || k), pg_temp.id(p_tag, 'loc' || k), 'receipt', 2, 5, 'invoice_line', pg_temp.id(p_tag, 'line' || k), '2026-10-01', v_owner);
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
      values (p_tenant, 'invoice', pg_temp.id(p_tag, 'inv' || k), 'invoice.approved', v_owner);
    insert into auth.users (id, email) values (pg_temp.id(p_tag, 'au' || k), 'staff-' || p_tag || k || '@staff.invalid');
    insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, created_by)
      values (pg_temp.id(p_tag, 'usr' || k), p_tenant, pg_temp.id(p_tag, 'au' || k), case i when 1 then 'chef' else 'waiter' end::public.app_role, 'Personale ' || k || ' (demo)', 'pin', v_owner);
    insert into public.venue_device (id, tenant_id, label, token_hash, created_by)
      values (pg_temp.id(p_tag, 'dev' || k), p_tenant, 'Dispositivo ' || k || ' (demo)', repeat(md5(p_tag || 'dev' || k), 2), v_owner);
    insert into public.device_enrolment (id, tenant_id, label, code_hash, expires_at, created_by)
      values (pg_temp.id(p_tag, 'enr' || k), p_tenant, 'Codice ' || k || ' (demo)', repeat(md5(p_tag || 'enr' || k), 2), '2026-10-24T10:00:00Z', v_owner);
    update public.device_enrolment set used_at = '2026-10-24T09:00:00Z', device_id = pg_temp.id(p_tag, 'dev' || k) where id = pg_temp.id(p_tag, 'enr' || k);
    insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at)
      values (pg_temp.id(p_tag, 'ses' || k), p_tenant, pg_temp.id(p_tag, 'usr' || k), pg_temp.id(p_tag, 'dev' || k), pg_temp.id(p_tag, 'as' || k), '2026-10-24T09:00:00Z', '2026-10-25T00:00:00Z');
  end loop;
end
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-0000000000a1', 'owner-r1@example.test'),
  ('a0000000-0000-4000-8000-0000000000a2', 'owner-r2@example.test'),
  ('d0000000-0000-4000-8000-0000000000d1', 'owner-demo@example.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'admin-demo@example.test');
select public.create_tenant_with_owner('Locale Uno (demo)', 'IT00000000001', 'a0000000-0000-4000-8000-0000000000a1', 'Titolare Uno (demo)');
select public.create_tenant_with_owner('Locale Due (demo)', 'IT00000000002', 'a0000000-0000-4000-8000-0000000000a2', 'Titolare Due (demo)');
select public.create_demo_tenant('Osteria Demo (dati di prova)', 'IT00000000099', 'd0000000-0000-4000-8000-0000000000d1', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d2', 'Supporto DigiAlto (demo)');

create temp table ctx as
  select (select id from public.tenant where is_demo) as d,
         (select id from public.tenant where vat_number = 'IT00000000001') as r1,
         (select id from public.tenant where vat_number = 'IT00000000002') as r2;
grant select on ctx to public;
select pg_temp.mk(d, 'D') from ctx;
select pg_temp.mk(r1, 'R1') from ctx;
select pg_temp.mk(r2, 'R2') from ctx;

select is((select pg_temp.cnt(d) from ctx), '2/3/2/2/2', 'D: two of each (and three audit rows with the creation one)');
select is((select pg_temp.cnt(r1) || ' ' || pg_temp.cnt(r2) from ctx), '2/2/2/2/2 2/2/2/2/2', 'R1 and R2: two of each');

-- No flag: nothing can be deleted, the demo tenant included (the existing messages) --------------------------------------------------------
select is((select pg_temp.del(d) from ctx), array['P0001:append_only', 'P0001:append_only', 'P0001:staff_session_immutable', 'P0001:device_enrolment_immutable', 'P0001:venue_device_immutable'],
          'no setting: D rows are refused with the existing messages');
select is((select pg_temp.del(r1) from ctx), array['P0001:append_only', 'P0001:append_only', 'P0001:staff_session_immutable', 'P0001:device_enrolment_immutable', 'P0001:venue_device_immutable'],
          'no setting: R1 rows are refused too');
select is((select pg_temp.cnt(d) || ' ' || pg_temp.cnt(r1) from ctx), '2/3/2/2/2 2/2/2/2/2', 'and nothing was deleted');

-- Flag = D: UPDATE and TRUNCATE are still refused ------------------------------------------------------------------------------------------
select set_config('app.demo_purge', (select d::text from ctx), true);
select is(pg_temp.err($$ update public.stock_movement set reason_code = 'x' where tenant_id = (select d from ctx) $$), 'P0001:append_only', 'flag = D: UPDATE of a D ledger row is still refused');
select is(pg_temp.err($$ update public.audit_event set reason = 'x' where tenant_id = (select d from ctx) $$), 'P0001:append_only', 'also audit_event');
select is(pg_temp.err($$ update public.venue_device set label = 'Altro (demo)' where tenant_id = (select d from ctx) $$), 'P0001:venue_device_immutable', 'and a venue_device update');
select is(pg_temp.err($$ truncate public.audit_event $$), 'P0001:append_only', 'flag = D: TRUNCATE of a ledger is still refused');
select is(pg_temp.err($$ truncate public.staff_session $$), 'P0001:truncate_refused', 'and of the staff sessions');

-- Flag = D: the other tenants' rows stay refused ---------------------------------------------------------------------------------------------
select is((select pg_temp.del(r1) from ctx), array['P0001:append_only', 'P0001:append_only', 'P0001:staff_session_immutable', 'P0001:device_enrolment_immutable', 'P0001:venue_device_immutable'],
          'flag = D: R1 rows are refused');
select is((select pg_temp.del(r2) from ctx), array['P0001:append_only', 'P0001:append_only', 'P0001:staff_session_immutable', 'P0001:device_enrolment_immutable', 'P0001:venue_device_immutable'],
          'flag = D: R2 rows are refused');
select is((select pg_temp.cnt(r1) || ' ' || pg_temp.cnt(r2) from ctx), '2/2/2/2/2 2/2/2/2/2', 'R1 and R2 still hold every row');

-- Flag = a real tenant: refused for its rows (not a demo) and for D's (not its id) -----------------------------------------------------------
select set_config('app.demo_purge', (select r1::text from ctx), true);
select is((select pg_temp.del(r1) from ctx), array['P0001:append_only', 'P0001:append_only', 'P0001:staff_session_immutable', 'P0001:device_enrolment_immutable', 'P0001:venue_device_immutable'],
          'flag = R1: R1 rows are refused, R1 is not a demo');
select is((select pg_temp.del(d) from ctx), array['P0001:append_only', 'P0001:append_only', 'P0001:staff_session_immutable', 'P0001:device_enrolment_immutable', 'P0001:venue_device_immutable'],
          'flag = R1: D rows are refused too, the setting names another tenant');

-- Values that are not D's id ---------------------------------------------------------------------------------------------------------------
select is((select array_agg(pg_temp.err(format('delete from public.stock_movement where tenant_id = %L', ctx.d)) order by v.n)
             from ctx, lateral (select n, set_config('app.demo_purge', v, true) from unnest(array['on', '', ' ', 'true', 'not-a-uuid', upper(ctx.d::text), ctx.d::text || ' ', '00000000-0000-0000-0000-000000000000']) with ordinality as x(v, n)) v(n, s)),
          array_fill('P0001:append_only'::text, array[8]), 'a flag that is "on", empty, malformed, upper-case, padded or another id deletes nothing');
select set_config('app.demo_purge', '', true);

-- The setting set by a role without privileges does nothing --------------------------------------------------------------------------------
set local role authenticated;
select set_config('app.demo_purge', (select d::text from ctx), true);
select is((select pg_temp.del_codes(d) from ctx), array['42501', '42501', '42501', '42501', '42501'], 'authenticated sets the flag to D: DELETE is still permission denied on every table');
select is(pg_temp.err($$ select app.demo_purge_allows((select d from ctx)) $$) like '42501:%', true, 'and authenticated cannot call demo_purge_allows');
reset role;
set local role service_role;
select set_config('app.demo_purge', (select d::text from ctx), true);
select is((select pg_temp.del_codes(d) from ctx), array['42501', '42501', '42501', '42501', '42501'], 'service_role sets the flag to D: permission denied as well');
reset role;
select set_config('app.demo_purge', '', true);
select is((select pg_temp.cnt(d) from ctx), '2/3/2/2/2', 'D still holds every row after those attempts');

-- demo_purge_allows ------------------------------------------------------------------------------------------------------------------------
select is((select app.demo_purge_allows(null::uuid)), false, 'demo_purge_allows(null) is false');
select is((select app.demo_purge_allows(d) from ctx), false, 'no setting: false for D');
select set_config('app.demo_purge', (select d::text from ctx), true);
select is((select array[app.demo_purge_allows(d), app.demo_purge_allows(r1), app.demo_purge_allows(r2), app.demo_purge_allows(gen_random_uuid())] from ctx),
          array[true, false, false, false], 'flag = D: true only for D');
select set_config('app.demo_purge', (select r1::text from ctx), true);
select is((select array[app.demo_purge_allows(d), app.demo_purge_allows(r1)] from ctx), array[false, false], 'flag = R1: false for R1 (not a demo) and for D');
select set_config('app.demo_purge', '', true);
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role)
            where has_function_privilege(r.role, 'app.demo_purge_allows(uuid)', 'execute')), 0, 'no API role can execute demo_purge_allows');
select is((select count(*)::int from unnest(array['anon', 'authenticated']) r(role), unnest(array['app.append_only()', 'app.auth_attempt_guard()', 'app.staff_session_guard()', 'app.device_guard()', 'app.enrolment_guard()']) f(fn)
            where has_function_privilege(r.role, f.fn, 'execute')), 0, 'the five guard functions are still closed to anon and authenticated');

-- A row without a tenant_id is never allowed -------------------------------------------------------------------------------------------------
create temp table no_tenant (x int);
create trigger no_tenant_append_only before update or delete on no_tenant for each row execute function app.append_only();
insert into no_tenant values (1);
select set_config('app.demo_purge', (select d::text from ctx), true);
select is(pg_temp.err($$ delete from no_tenant $$), 'P0001:append_only', 'append_only on a table with no tenant_id refuses even with the flag set');
select set_config('app.demo_purge', '', true);

-- app.auth_purge keeps its M11 meaning (any tenant, retention only) --------------------------------------------------------------------
select set_config('app.auth_purge', 'on', true);
select is((select pg_temp.del(r2) from ctx), array['P0001:append_only', 'P0001:append_only', 'ok', 'P0001:device_enrolment_immutable', 'P0001:venue_device_immutable'],
          'auth_purge = on: staff sessions can go, ledgers, used codes and devices cannot (as in 080 and 088)');
select is((select pg_temp.del(d) from ctx), array['P0001:append_only', 'P0001:append_only', 'ok', 'P0001:device_enrolment_immutable', 'P0001:venue_device_immutable'],
          'and the demo tenant gets nothing more than a real one from auth_purge');
select set_config('app.auth_purge', '', true);

-- Flag = D: now the purge itself may delete D, and only D -------------------------------------------------------------------------------------
-- (the D sessions went above; the rest goes child-first)
select set_config('app.demo_purge', (select d::text from ctx), true);
select is((select pg_temp.del(d) from ctx), array['ok', 'ok', 'ok', 'ok', 'ok'], 'flag = D: every D table can be deleted from, child tables first');
select is((select pg_temp.cnt(d) from ctx), '0/0/0/0/0', 'D has no rows left in those tables');
select is((select pg_temp.cnt(r1) from ctx), '2/2/2/2/2', 'R1 is untouched');
select is((select pg_temp.cnt(r2) from ctx), '2/2/0/2/2', 'R2 lost only its sessions, to the auth_purge test above');
select is((select pg_temp.del(r1) from ctx), array['P0001:append_only', 'P0001:append_only', 'P0001:staff_session_immutable', 'P0001:device_enrolment_immutable', 'P0001:venue_device_immutable'],
          'and with the flag still set, R1 is still refused');
select set_config('app.demo_purge', '', true);
select is(coalesce(current_setting('app.demo_purge', true), ''), '', 'the setting is empty again');
select is(pg_temp.err($$ delete from public.audit_event where tenant_id = (select r1 from ctx) $$), 'P0001:append_only', 'a plain delete is refused again');

select * from finish();
rollback;
