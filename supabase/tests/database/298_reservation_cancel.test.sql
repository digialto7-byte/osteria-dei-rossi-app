-- Reservations B2 (docs/plans/2026-11-08-reservations.md §3.1.13, §3.3.5, §5 B2; ADR-032): cancel by link. The route has checked the token MAC before any call; these functions take
-- the reservation id and the token's exp (epoch seconds) with the gate. cancel_reservation: pending or accepted -> cancelled, tables released, event cancelled_by_customer; single use
-- (a second call is already: true and writes nothing); closed from the earlier of exp and the start minus cancel_until_minutes. reservation_cancel_view reports the booking without
-- a name, phone or e-mail. Another tenant's reservation, an unknown id and an unknown slug are all P0002 not_found. p_now is fixed on the twins. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
  det text;
begin
  execute stmt into v_out;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
create function pg_temp.anon(stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
  det text;
begin
  set local role anon;
  execute stmt into v_out;
  reset role;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  reset role;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
create function pg_temp.mac(p_fn text, p_slug text, p_ts bigint, p_key text) returns text language sql as $$
  select encode(extensions.hmac('resv-gate|v1|' || p_fn || '|' || p_slug || '|' || p_ts::text, p_key, 'sha256'), 'hex')
$$;
create function pg_temp.epoch(p_at timestamptz) returns bigint language sql as $$ select extract(epoch from p_at)::bigint $$;
-- The twins at a fixed clock. Reservation ids are 'c0000000-...-0000000000NN'.
create function pg_temp.rid(p_n integer) returns uuid language sql as $$ select ('c0000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.cancel(p_n integer, p_exp bigint, p_now timestamptz, p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns text language sql as $$
  select pg_temp.err(format('select app.cancel_reservation_at(%L, %L, %s, %L)::text', p_tenant, pg_temp.rid(p_n), p_exp, p_now))
$$;
create function pg_temp.vw(p_n integer, p_exp bigint, p_now timestamptz, p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns text language sql as $$
  select pg_temp.err(format('select app.reservation_cancel_view_at(%L, %L, %s, %L)::text', p_tenant, pg_temp.rid(p_n), p_exp, p_now))
$$;
-- A public call as the route would make it: anon, the real clock.
create function pg_temp.pub(p_fn text, p_slug text, p_extra text, p_key text default 'test-gate-key-0123456789-abcdefghij') returns text language plpgsql as $$
declare
  v_ts bigint := extract(epoch from clock_timestamp())::bigint;
begin
  return pg_temp.anon(format('select public.%I(%L, %s, %L, %s)::text', p_fn, p_slug, v_ts, pg_temp.mac(p_fn, p_slug, v_ts, p_key), p_extra));
end
$$;

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'), ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

delete from vault.secrets where name in ('reservation_gate_key', 'reservation_gate_key_next', 'reservation_hash_salt');
select vault.create_secret('test-gate-key-0123456789-abcdefghij', 'reservation_gate_key');
select vault.create_secret('test-salt-0123456789-abcdef', 'reservation_hash_salt');
-- A is enabled and ready; B has a slug but is switched off (a customer can still cancel).
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a',
  '{"publicSlug": "osteria-demo-a", "privacyControllerName": "Osteria Demo S.r.l. (demo)", "privacyContactEmail": "privacy@example.com", "enabled": true}', now());
insert into public.reservation_settings (tenant_id, public_slug, enabled) values ('22222222-2222-4222-8222-222222222222', 'osteria-demo-b', false);

-- Reservations: all start 2026-11-20 20:00 Rome (19:00Z) unless stated; the contact is Cliente Demo.
create function pg_temp.mk(p_n integer, p_status public.reservation_status default 'pending', p_tenant uuid default '11111111-1111-4111-8111-111111111111', p_start timestamptz default '2026-11-20 19:00+00') returns void language plpgsql as $$
begin
  insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
    values (p_tenant, pg_temp.rid(p_n), 'pending', (p_start at time zone 'Europe/Rome')::date, 'cena', p_start, p_start + interval '2 hours', 4, 'v1', '2026-11-08 10:00+00');
  insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
    values (p_tenant, pg_temp.rid(p_n), 'Cliente Demo', '390000000001', 'cliente.demo@example.com', 'it');
  if p_status in ('accepted', 'seated') then
    update public.reservation set status = 'accepted' where tenant_id = p_tenant and id = pg_temp.rid(p_n);
  end if;
  if p_status = 'seated' then
    update public.reservation set status = 'seated' where tenant_id = p_tenant and id = pg_temp.rid(p_n);
  elsif p_status not in ('pending', 'accepted') then
    update public.reservation set status = p_status where tenant_id = p_tenant and id = pg_temp.rid(p_n);
  end if;
end
$$;
select pg_temp.mk(1);
select pg_temp.mk(2, 'accepted');
select pg_temp.mk(3, 'declined');
select pg_temp.mk(4, 'seated');
select pg_temp.mk(5, 'pending', '22222222-2222-4222-8222-222222222222');
select pg_temp.mk(7);
select pg_temp.mk(8);
select pg_temp.mk(9);
select pg_temp.mk(10);
select pg_temp.mk(11);
select pg_temp.mk(12, 'cancelled');
insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by) values
  ('11111111-1111-4111-8111-111111111111', pg_temp.rid(2), '13000000-0000-4000-8000-000000000001', '2026-11-08 10:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.rid(2), '13000000-0000-4000-8000-000000000002', '2026-11-08 10:00+00', 'a1000000-0000-4000-8000-00000000000a');

-- Cancel ------------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.cancel(1, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00'), '{"status": "cancelled", "already": false}', 'a pending request is cancelled: {status: cancelled, already: false}');
select is((select status::text from public.reservation where id = pg_temp.rid(1)), 'cancelled', 'its status is cancelled');
select is((select count(*)::int from public.reservation_event where reservation_id = pg_temp.rid(1) and kind = 'cancelled_by_customer' and created_by is null), 1, 'one cancelled_by_customer event, by no user');
select is((select data::text from public.reservation_event where reservation_id = pg_temp.rid(1) and kind = 'cancelled_by_customer'), '{}', 'whose data carries nothing personal');
select is((select count(*)::int from public.reservation_contact where reservation_id = pg_temp.rid(1)), 1, 'the contact stays (retention deletes it later)');
select is(pg_temp.cancel(1, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 11:00+00'), '{"status": "cancelled", "already": true}', 'a second call is already: true (single use)');
select is((select count(*)::int from public.reservation_event where reservation_id = pg_temp.rid(1) and kind = 'cancelled_by_customer'), 1, 'and writes no new event');
select is(pg_temp.cancel(1, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-20 20:00+00'), '{"status": "cancelled", "already": true}', 'also after exp: the answer is still already, not cancel_closed');

select is(pg_temp.cancel(2, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00'), '{"status": "cancelled", "already": false}', 'an accepted booking is cancelled');
select is((select count(*)::int from public.reservation_table where reservation_id = pg_temp.rid(2) and released_at = '2026-11-08 10:00+00' and released_by is null), 2, 'both its tables are released (rows kept, released_at set, no staff user)');
select is((select count(*)::int from public.reservation_table where reservation_id = pg_temp.rid(2) and released_at is null), 0, 'none is held any more');
select is((select count(*)::int from public.reservation_event where reservation_id = pg_temp.rid(2) and kind = 'cancelled_by_customer'), 1, 'with its event');

select alike(pg_temp.err($$ insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by, released_by)
  values ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000002', now(), 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a') $$),
  '23514 new row for relation "reservation_table" violates check constraint "reservation_table_released_ck"%', 'the loosened check still refuses a releaser without a release time');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'reservation_table_released_ck'), 'CHECK (((released_by IS NULL) OR (released_at IS NOT NULL)))', 'the check is "a releaser implies a release time"');

-- The deadline: exp - 1 s ok, exp closed ---------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.cancel(7, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-20 18:59:59+00'), '{"status": "cancelled", "already": false}', 'at exp - 1 s the cancel works');
select is(pg_temp.cancel(8, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-20 19:00:00+00'), 'P0001 cancel_closed', 'at exp it is cancel_closed');
select is((select status::text from public.reservation where id = pg_temp.rid(8)), 'pending', 'and the booking is untouched');
select is((select count(*)::int from public.reservation_event where reservation_id = pg_temp.rid(8)), 0, 'with no event');
select is(pg_temp.cancel(8, pg_temp.epoch('2026-11-20 18:00+00'), '2026-11-20 18:00:00+00'), 'P0001 cancel_closed', 'an exp earlier than the start closes earlier (the token says so)');

-- cancel_until_minutes 60: closed from start - 60 min even when the token says the start ---------------------------------------------------------------------------------
update public.reservation_settings set cancel_until_minutes = 60 where tenant_id = '11111111-1111-4111-8111-111111111111';
select is(pg_temp.cancel(9, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-20 17:59:59+00'), '{"status": "cancelled", "already": false}', 'cancel_until 60: at start - 60 min - 1 s it works');
select is(pg_temp.cancel(10, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-20 18:00:00+00'), 'P0001 cancel_closed', 'at start - 60 min it is cancel_closed, whatever the token says');
update public.reservation_settings set cancel_until_minutes = 0 where tenant_id = '11111111-1111-4111-8111-111111111111';

-- A start moved earlier than exp -----------------------------------------------------------------------------------------------------------------------------------------
update public.reservation set starts_at = '2026-11-20 17:00+00', ends_at = '2026-11-20 19:00+00' where id = pg_temp.rid(11);
select is(pg_temp.cancel(11, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-20 17:30:00+00'), 'P0001 cancel_closed', 'a start moved earlier than exp: cancel_closed from the new start');
select is(pg_temp.cancel(11, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-20 16:59:59+00'), '{"status": "cancelled", "already": false}', 'and still possible before it');

-- Statuses ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.cancel(3, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00'), 'P0001 status_invalid', 'a declined booking: status_invalid');
select is(pg_temp.cancel(4, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00'), 'P0001 status_invalid', 'a seated booking: status_invalid');
select is(pg_temp.cancel(12, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00'), '{"status": "cancelled", "already": true}', 'a booking cancelled by anyone else reads already: true');

-- No enumeration ------------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.cancel(5, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00'), 'P0002 not_found', 'tenant B''s reservation with A''s tenant: not_found');
select is(pg_temp.cancel(99, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00'), 'P0002 not_found', 'an unknown id: the same not_found');
select is((select status::text from public.reservation where id = pg_temp.rid(5)), 'pending', 'and B''s booking is untouched');

-- The view ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.vw(3, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00'), '{"date": "2026-11-20", "time": "20:00", "party": 4, "status": "declined", "canCancel": false, "serviceName": "Cena"}',
          'the view of a declined booking: date, local time, party, service name, status, canCancel false');
create temp table v2 as select pg_temp.vw(7, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00')::jsonb as j;
select is((select j ->> 'status' from v2), 'cancelled', 'booking 7 was cancelled above: the view says so');
select is((select (j -> 'canCancel')::text from v2), 'false', 'and cannot be cancelled again');
select pg_temp.mk(13);
create temp table v3 as select pg_temp.vw(13, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00')::jsonb as j;
select is((select j ->> 'status' from v3), 'pending', 'a pending booking: status pending');
select is((select (j -> 'canCancel')::text from v3), 'true', 'canCancel true');
select is((select array_agg(k order by k collate "C") from v3, jsonb_object_keys(j) k), array['canCancel', 'date', 'party', 'serviceName', 'status', 'time'], 'the keys are exactly those six: no name, phone, e-mail or id');
select is((select count(*)::int from v3 where j::text ~* 'cliente|0000|example'), 0, 'and no personal value appears');
select is(pg_temp.vw(13, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-20 18:59:59+00')::jsonb -> 'canCancel', 'true'::jsonb, 'canCancel at exp - 1 s');
select is(pg_temp.vw(13, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-20 19:00:00+00')::jsonb -> 'canCancel', 'false'::jsonb, 'canCancel false at exp');
select is(pg_temp.vw(13, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-20 20:00:00+00')::jsonb ->> 'status', 'expired', 'a pending request past its start reads expired');
select is(pg_temp.vw(2, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00')::jsonb ->> 'status', 'cancelled', 'an accepted booking cancelled above reads cancelled');
select is(pg_temp.vw(5, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00'), 'P0002 not_found', 'view: another tenant''s booking is not_found');
select is(pg_temp.vw(99, pg_temp.epoch('2026-11-20 19:00+00'), '2026-11-08 10:00+00'), 'P0002 not_found', 'view: an unknown id is not_found');
select is(pg_temp.err(format('select app.reservation_cancel_view_at(%L, null, 1, now())::text', '11111111-1111-4111-8111-111111111111')), 'P0002 not_found', 'view: a null id is not_found');

-- Grants and definer rules ----------------------------------------------------------------------------------------------------------------------------------------------------
create temp table pubfn as
  select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reservation_page', 'reservation_slots', 'request_reservation', 'reservation_cancel_view', 'cancel_reservation');
select is((select count(*)::int from pubfn), 5, 'the five anon functions exist');
select is((select count(*)::int from pubfn where has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('service_role', oid, 'execute')), 5, 'each is executable by anon only');
select is((select count(*)::int from pg_proc p join pubfn f on f.oid = p.oid where p.prosecdef and p.proconfig @> array['search_path=""']), 5, 'each is a definer with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('cancel_reservation_at', 'reservation_cancel_view_at', 'reservation_slug_tenant') and p.prosecdef and p.proconfig @> array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 3,
          'the twins and the slug helper are definers closed to every API role');

-- Through the wrappers: the gate first -------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mk(20, 'accepted', '11111111-1111-4111-8111-111111111111', now() + interval '10 days');
select pg_temp.mk(21, 'pending', '22222222-2222-4222-8222-222222222222', now() + interval '10 days');
create function pg_temp.args(p_n integer, p_exp_off integer default 0) returns text language sql as $$
  select format('%L, %s', pg_temp.rid(p_n), pg_temp.epoch((select starts_at from public.reservation where id = pg_temp.rid(p_n))) + p_exp_off)
$$;
select is(pg_temp.pub('cancel_reservation', 'osteria-demo-a', pg_temp.args(20), 'wrong-gate-key-0123456789-abcdefghijk'), 'P0001 gate_invalid', 'cancel: a wrong gate is gate_invalid');
select is(pg_temp.pub('reservation_cancel_view', 'osteria-demo-a', pg_temp.args(20), 'wrong-gate-key-0123456789-abcdefghijk'), 'P0001 gate_invalid', 'view: a wrong gate is gate_invalid');
select is(pg_temp.anon(format('select public.cancel_reservation(%L, 1, ''00'', %L, 1)::text', 'osteria-demo-a', pg_temp.rid(20))), 'P0001 gate_invalid', 'cancel: a made-up gate called directly (as through PostgREST) is gate_invalid');
select is((select status::text from public.reservation where id = pg_temp.rid(20)), 'accepted', 'and the booking is untouched');
select is(pg_temp.pub('cancel_reservation', 'osteria-demo-a', pg_temp.args(21)), 'P0002 not_found', 'with a valid gate, B''s booking under A''s slug is not_found');
select is(pg_temp.pub('cancel_reservation', 'no-such-slug', pg_temp.args(20)), 'P0002 not_found', 'an unknown slug is the same not_found');
select is(((pg_temp.pub('reservation_cancel_view', 'osteria-demo-a', pg_temp.args(20)))::jsonb ->> 'status'), 'accepted', 'view with a valid gate: accepted');
select is(((pg_temp.pub('reservation_cancel_view', 'osteria-demo-a', pg_temp.args(20)))::jsonb -> 'canCancel')::text, 'true', 'canCancel true');
select is(pg_temp.pub('cancel_reservation', 'osteria-demo-a', pg_temp.args(20)), '{"status": "cancelled", "already": false}', 'cancel with a valid gate');
select is(pg_temp.pub('cancel_reservation', 'osteria-demo-a', pg_temp.args(20)), '{"status": "cancelled", "already": true}', 'and a second time: already');
select is(pg_temp.pub('cancel_reservation', 'osteria-demo-b', pg_temp.args(21)), '{"status": "cancelled", "already": false}', 'a customer of a tenant that has switched the page off can still cancel');

select * from finish();
rollback;
