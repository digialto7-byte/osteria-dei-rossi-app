-- Reservations A5b (docs/plans/2026-11-08-reservations.md §5c, founder Q-R16): bookings typed by staff, e.g. by phone.
--
--   app.create_staff_reservation_at(tenant, user, role, body, now)   body {date, time, serviceKey, party, name, phone, email?, locale?, tableIds?, groupId?}; any other key (a note
--                         included) is 22023. The booking is created already accepted with source 'staff' and no privacy acknowledgement (the table check allows it for staff);
--                         the contact's e-mail is optional. An accepted e-mail is queued only when an address is given. Optional tables are checked like an accept (table_not_found,
--                         group_mismatch, table_taken).
--   public.create_staff_reservation(body)    owner, admin and waiter (app.require_table_operator); the chef gets 42501 before the body is read.
-- Staff are not bound by the lead time, the horizon, the online maximum, the per-slot and per-service limits, the grid or the throttle (party stays 1 to 99). The date must be today or
-- later on the business calendar (P0001 date_past); serviceKey must be a service of the version in force and the one the time belongs to (P0001 service); a local time that does not
-- exist is slot_unavailable with the reason dst_gap. The staff booking counts against the online limits like any accepted booking.
-- Locks: the per-(tenant, business date) tables lock, then the request lock of (date, service): the order of a move, so the two cannot cross. Errors carry codes only.

create function app.create_staff_reservation_at(p_tenant uuid, p_user uuid, p_role text, p_body jsonb, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_date date;
  v_service text;
  v_time time;
  v_party integer;
  v_name text;
  v_phone text;
  v_email text;
  v_locale text := 'it';
  v_tz text;
  v_cutoff time;
  v_periods jsonb;
  v_wall timestamp;
  v_start timestamptz;
  v_bd date;
  v_stay integer;
  v_id uuid := gen_random_uuid();
  r public.reservation;
  v_pick jsonb := jsonb_build_object('tableIds', '[]'::jsonb, 'groupId', null);
begin
  perform app.menu_keys_ok(p_body, array['date', 'time', 'serviceKey', 'party', 'name', 'phone', 'email', 'locale', 'tableIds', 'groupId'],
                           array['date', 'time', 'serviceKey', 'party', 'name', 'phone']);
  v_date := case when jsonb_typeof(p_body -> 'date') = 'string' then app.reservation_date(p_body ->> 'date') end;
  if v_date is null then perform app.request_invalid('date'); end if;
  if jsonb_typeof(p_body -> 'time') <> 'string' or (p_body ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform app.request_invalid('time'); end if;
  v_time := (p_body ->> 'time')::time;
  v_service := case when jsonb_typeof(p_body -> 'serviceKey') = 'string' then p_body ->> 'serviceKey' end;
  if v_service is null or v_service !~ '^[a-z][a-z0-9_]{1,31}$' then perform app.request_invalid('service'); end if;
  v_party := app.reservation_int(p_body -> 'party', 1, 99);
  if v_party is null then perform app.request_invalid('party'); end if;
  v_name := case when jsonb_typeof(p_body -> 'name') = 'string' then btrim(p_body ->> 'name') end;
  if v_name is null or char_length(v_name) not between 1 and 80 then perform app.request_invalid('name'); end if;
  v_phone := case when jsonb_typeof(p_body -> 'phone') = 'string' and (p_body ->> 'phone') ~ '^[0-9 ()+.-]{6,30}$' then regexp_replace(p_body ->> 'phone', '[^0-9]', '', 'g') end;
  if v_phone is null or v_phone !~ '^[0-9]{6,15}$' then perform app.request_invalid('phone'); end if;
  if p_body ? 'email' and jsonb_typeof(p_body -> 'email') <> 'null' then
    v_email := case when jsonb_typeof(p_body -> 'email') = 'string' then lower(btrim(p_body ->> 'email')) end;
    if v_email is null or char_length(v_email) not between 3 and 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then perform app.request_invalid('email'); end if;
  end if;
  if p_body ? 'locale' then
    v_locale := case when jsonb_typeof(p_body -> 'locale') = 'string' then p_body ->> 'locale' end;
    if v_locale is null or v_locale not in ('it', 'en') then perform app.request_invalid('locale'); end if;
  end if;
  if (p_body ? 'tableIds' and jsonb_typeof(p_body -> 'tableIds') not in ('array', 'null'))
     or (p_body ? 'groupId' and jsonb_typeof(p_body -> 'groupId') not in ('string', 'null')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  if v_date < app.business_date(p_tenant, p_now) then
    raise exception 'date_past' using errcode = 'P0001';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_cutoff := app.business_day_cutoff(p_tenant);
  v_periods := app.service_periods_at(p_tenant, p_now);
  if not exists (select 1 from jsonb_array_elements(v_periods) e where e ->> 'key' = v_service)
     or app.service_key_for(v_periods, v_time, v_cutoff) is distinct from v_service then
    raise exception 'service' using errcode = 'P0001';
  end if;
  v_wall := v_date + v_time;
  v_start := v_wall at time zone v_tz;
  if (v_start at time zone v_tz) <> v_wall then
    raise exception 'slot_unavailable' using errcode = 'P0001', detail = '{"reason": "dst_gap"}';
  end if;
  v_bd := app.business_date(p_tenant, v_start);
  v_stay := (app.reservation_settings_row(p_tenant) ->> 'stay_minutes')::integer;

  perform app.reservation_tables_lock(p_tenant, v_bd);
  perform pg_advisory_xact_lock(hashtextextended('resv:' || p_tenant::text || ':' || to_char(v_date, 'YYYY-MM-DD') || ':' || v_service, 0));
  insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, source, created_at, updated_at)
    values (p_tenant, v_id, 'accepted', v_bd, v_service, v_start, v_start + make_interval(mins => v_stay), v_party, 'staff', p_now, p_now)
    returning * into r;
  insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale) values (p_tenant, v_id, v_name, v_phone, v_email, v_locale);
  perform app.reservation_event(p_tenant, v_id, 'created_by_staff', jsonb_build_object('party', v_party, 'serviceKey', v_service, 'businessDate', v_bd), p_user, p_now);
  if p_body ? 'tableIds' or p_body ? 'groupId' then
    v_pick := app.reservation_pick_tables(p_tenant, r, jsonb_build_object('tableIds', coalesce(p_body -> 'tableIds', 'null'::jsonb), 'groupId', coalesce(p_body -> 'groupId', 'null'::jsonb)));
    if jsonb_array_length(v_pick -> 'tableIds') > 0 then
      perform app.reservation_assign(p_tenant, p_user, r, v_pick, p_now);
      perform app.reservation_event(p_tenant, v_id, 'tables_assigned', jsonb_build_object('tableIds', v_pick -> 'tableIds', 'groupId', v_pick -> 'groupId'), p_user, p_now);
    end if;
  end if;
  if v_email is not null then
    insert into public.reservation_email (tenant_id, reservation_id, kind, next_attempt_at) values (p_tenant, v_id, 'accepted', p_now);
  end if;
  return app.reservation_detail_json(p_tenant, v_id, p_role, p_now) || jsonb_build_object('changed', true);
end
$$;

create function public.create_staff_reservation(p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_table_operator();
  return app.create_staff_reservation_at(app.tenant_id(), app.app_user_id(), app.role()::text, p_body, clock_timestamp());
end
$$;

revoke all on function app.create_staff_reservation_at(uuid, uuid, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.create_staff_reservation(jsonb) from public, anon, service_role;
grant execute on function public.create_staff_reservation(jsonb) to authenticated;
