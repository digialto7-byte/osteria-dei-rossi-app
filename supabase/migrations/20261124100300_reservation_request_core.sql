-- Reservations A3 (docs/plans/2026-11-08-reservations.md §3.1.5, §3.2, §3.3, §5 A3; ADR-032): the slots of a day and the request core. The anon wrappers come in PR2
-- (B1); nothing here is callable by an API role.
--
--   app.reservation_limits        the daily limits {ip: 5, email: 3, phone: 3, pendingPerTenant: 100} (Q-R7).
--   app.reservation_hash          the hex of extensions.hmac(kind|day|value, Vault reservation_hash_salt, sha256): a counter key that is unlinkable across days. A missing
--                                 Vault secret is P0001 reservations_unconfigured. pgcrypto is created in schema extensions (T-R3).
--   app.reservation_slot_reason   the one place the rules of §3.1.5 live: null when a (date, service, time, party) can be requested, else the reason. p_skip lists reasons a
--                                 caller does not apply (a staff move skips lead and party); p_except leaves one reservation out of the counts (the one being moved).
--                                 Order: closed, service, seating, grid, dst_gap, horizon, lead, party, slot_limit, service_limit, no_fit.
--   app.reservation_slots_json    {date, closed, services: [{key, name, slots: [{time, available}]}]}; no count is ever returned.
--   app.request_reservation_at    the request. Order: strict keys (22023) -> field checks (P0001 request_invalid, DETAIL {"reason": field}) -> the advisory lock of
--                                 (tenant, date, service) -> the slot rules (P0001 slot_unavailable, DETAIL {"reason": ...}) -> the throttle (P0001 rate_limited, no detail)
--                                 -> reservation, contact, event 'requested' and a 'received' e-mail row, in one transaction -> {status: "received"}.
-- The IP is a function argument only: it is hashed and never stored or logged. Every DETAIL carries codes, never a name, phone or e-mail. A refused request rolls
-- back, so it does not count against a limit.

create extension if not exists pgcrypto with schema extensions;

create function app.reservation_limits() returns jsonb
  language sql
  immutable
  security definer
  set search_path = ''
as $$
  select '{"ip": 5, "email": 3, "phone": 3, "pendingPerTenant": 100}'::jsonb
$$;

create function app.reservation_hash(p_kind text, p_day date, p_value text) returns text
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_salt text;
begin
  select s.decrypted_secret into v_salt from vault.decrypted_secrets s where s.name = 'reservation_hash_salt';
  if v_salt is null then
    raise exception 'reservations_unconfigured' using errcode = 'P0001';
  end if;
  return encode(extensions.hmac(p_kind || '|' || to_char(p_day, 'YYYY-MM-DD') || '|' || coalesce(p_value, ''), v_salt, 'sha256'), 'hex');
end
$$;

create function app.reservation_slot_reason(p_tenant uuid, p_date date, p_service text, p_time time, p_party integer, p_now timestamptz, p_skip text[], p_except uuid)
  returns text
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_cfg jsonb := app.reservation_settings_row(p_tenant);
  v_tz text;
  v_cutoff time := app.business_day_cutoff(p_tenant);
  v_periods jsonb := app.service_periods_at(p_tenant, p_now);
  v_svc jsonb := v_cfg -> 'services' -> p_service;
  v_slot integer := (v_cfg ->> 'slot_minutes')::integer;
  v_min integer := extract(hour from p_time)::integer * 60 + extract(minute from p_time)::integer;
  v_first integer;
  v_last integer;
  v_wall timestamp;
  v_start timestamptz;
  v_bd date;
  v_n integer;
  v_covers integer;
  v_limit integer;
  v_skip text[] := coalesce(p_skip, '{}');
begin
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;

  if extract(isodow from p_date)::integer in (select e::integer from jsonb_array_elements_text(v_cfg -> 'closed_weekdays') e)
     or to_char(p_date, 'YYYY-MM-DD') in (select e from jsonb_array_elements_text(v_cfg -> 'closed_dates') e) then
    return 'closed';
  end if;
  -- The service must be one of the version in force, online, and the one the time belongs to (M25c).
  if v_svc is null or (v_svc ->> 'online') is distinct from 'true'
     or not exists (select 1 from jsonb_array_elements(v_periods) e where e ->> 'key' = p_service)
     or app.service_key_for(v_periods, p_time, v_cutoff) is distinct from p_service then
    return 'service';
  end if;
  if v_svc ->> 'firstSeating' is null or v_svc ->> 'lastSeating' is null then
    return 'seating';
  end if;
  v_first := (substr(v_svc ->> 'firstSeating', 1, 2))::integer * 60 + (substr(v_svc ->> 'firstSeating', 4, 2))::integer;
  v_last := (substr(v_svc ->> 'lastSeating', 1, 2))::integer * 60 + (substr(v_svc ->> 'lastSeating', 4, 2))::integer;
  if v_min < v_first or v_min > v_last then
    return 'seating';
  end if;
  if (v_min - v_first) % v_slot <> 0 then
    return 'grid';
  end if;
  -- A local time that does not exist (the spring gap) does not survive the round trip.
  v_wall := p_date + p_time;
  v_start := v_wall at time zone v_tz;
  if (v_start at time zone v_tz) <> v_wall then
    return 'dst_gap';
  end if;
  v_bd := app.business_date(p_tenant, v_start);

  if p_date > app.business_date(p_tenant, p_now) + (v_cfg ->> 'horizon_days')::integer then
    return 'horizon';
  end if;
  if not ('lead' = any (v_skip)) and v_start - p_now < make_interval(mins => (v_cfg ->> 'lead_minutes')::integer) then
    return 'lead';
  end if;
  if not ('party' = any (v_skip)) and p_party > (v_cfg ->> 'max_party_online')::integer then
    return 'party';
  end if;

  -- Counts: pending, accepted, arrived and seated bookings hold a place.
  select count(*)::integer, coalesce(sum(r.party), 0)::integer into v_n, v_covers
    from public.reservation r
   where r.tenant_id = p_tenant and r.starts_at = v_start and r.status in ('pending', 'accepted', 'arrived', 'seated') and r.id is distinct from p_except;
  if ((v_svc ->> 'reservationsPerSlot') is not null and v_n + 1 > (v_svc ->> 'reservationsPerSlot')::integer)
     or ((v_svc ->> 'coversPerSlot') is not null and v_covers + p_party > (v_svc ->> 'coversPerSlot')::integer) then
    return 'slot_limit';
  end if;
  v_limit := (v_svc ->> 'coversPerService')::integer;
  if v_limit is not null then
    select coalesce(sum(r.party), 0)::integer into v_covers
      from public.reservation r
     where r.tenant_id = p_tenant and r.business_date = v_bd and r.service_key = p_service
       and r.status in ('pending', 'accepted', 'arrived', 'seated') and r.id is distinct from p_except;
    if v_covers + p_party > v_limit then
      return 'service_limit';
    end if;
  end if;

  -- Table fit only when seats are configured at all (a venue that has not set them is not blocked).
  if exists (select 1 from public.dining_table_booking b join public.dining_table t on t.tenant_id = b.tenant_id and t.id = b.dining_table_id
              where b.tenant_id = p_tenant and b.bookable and b.seats is not null and t.is_active)
     and not exists (select 1 from public.dining_table_booking b join public.dining_table t on t.tenant_id = b.tenant_id and t.id = b.dining_table_id
                      where b.tenant_id = p_tenant and b.bookable and b.seats >= p_party and t.is_active)
     and not exists (select 1 from public.table_group g where g.tenant_id = p_tenant and g.is_active and g.seats >= p_party) then
    return 'no_fit';
  end if;
  return null;
end
$$;

create function app.reservation_slots_json(p_tenant uuid, p_date date, p_party integer, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_cfg jsonb := app.reservation_settings_row(p_tenant);
  v_slot integer := (v_cfg ->> 'slot_minutes')::integer;
begin
  if app.reservation_slot_reason(p_tenant, p_date, 'none', time '00:00', p_party, p_now, null, null) = 'closed' then
    return jsonb_build_object('date', p_date, 'closed', true, 'services', '[]'::jsonb);
  end if;
  return jsonb_build_object('date', p_date, 'closed', false, 'services', coalesce((
    select jsonb_agg(jsonb_build_object('key', w ->> 'key', 'name', w ->> 'name', 'slots', (
             select coalesce(jsonb_agg(jsonb_build_object('time', to_char(make_time(m / 60, m % 60, 0), 'HH24:MI'),
                                                          'available', app.reservation_slot_reason(p_tenant, p_date, w ->> 'key', make_time(m / 60, m % 60, 0), p_party, p_now, null, null) is null)
                                       order by m), '[]'::jsonb)
               from generate_series((substr(c.cfg ->> 'firstSeating', 1, 2))::integer * 60 + (substr(c.cfg ->> 'firstSeating', 4, 2))::integer,
                                    (substr(c.cfg ->> 'lastSeating', 1, 2))::integer * 60 + (substr(c.cfg ->> 'lastSeating', 4, 2))::integer, v_slot) m))
                     order by (w ->> 'position')::integer)
      from jsonb_array_elements(app.service_windows(app.service_periods_at(p_tenant, p_now), app.business_day_cutoff(p_tenant))) w
     cross join lateral (select v_cfg -> 'services' -> (w ->> 'key') as cfg) c
     where (c.cfg ->> 'online') = 'true' and c.cfg ->> 'firstSeating' is not null and c.cfg ->> 'lastSeating' is not null), '[]'::jsonb));
end
$$;

create function app.request_invalid(p_reason text) returns void
  language plpgsql
  immutable
  security definer
  set search_path = ''
as $$
begin
  raise exception 'request_invalid' using errcode = 'P0001', detail = jsonb_build_object('reason', p_reason)::text;
end
$$;

create function app.request_reservation_at(p_tenant uuid, p_body jsonb, p_ip text, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_cfg jsonb;
  v_tz text;
  v_date date;
  v_service text;
  v_time time;
  v_party integer;
  v_name text;
  v_phone text;
  v_email text;
  v_locale text;
  v_notice text;
  v_reason text;
  v_start timestamptz;
  v_id uuid := gen_random_uuid();
  v_day date;
  v_hits integer;
  v_limits jsonb := app.reservation_limits();
  v_kind text;
  v_value text;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object'
     or (select array_agg(k order by k collate "C") from jsonb_object_keys(p_body) k)
        is distinct from array['date', 'email', 'locale', 'name', 'party', 'phone', 'privacyNoticeVersion', 'serviceKey', 'time'] then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  -- Field checks: a wrong type or value is request_invalid with the field name, never the value.
  v_date := case when jsonb_typeof(p_body -> 'date') = 'string' then app.reservation_date(p_body ->> 'date') end;
  if v_date is null then perform app.request_invalid('date'); end if;
  v_service := case when jsonb_typeof(p_body -> 'serviceKey') = 'string' then p_body ->> 'serviceKey' end;
  if v_service is null or v_service !~ '^[a-z][a-z0-9_]{1,31}$' then perform app.request_invalid('service'); end if;
  if jsonb_typeof(p_body -> 'time') <> 'string' or (p_body ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform app.request_invalid('time'); end if;
  v_time := (p_body ->> 'time')::time;
  v_party := app.reservation_int(p_body -> 'party', 1, 99);
  if v_party is null then perform app.request_invalid('party'); end if;
  v_name := case when jsonb_typeof(p_body -> 'name') = 'string' then btrim(p_body ->> 'name') end;
  if v_name is null or char_length(v_name) not between 1 and 80 then perform app.request_invalid('name'); end if;
  v_phone := case when jsonb_typeof(p_body -> 'phone') = 'string' and (p_body ->> 'phone') ~ '^[0-9 ()+.-]{6,30}$' then regexp_replace(p_body ->> 'phone', '[^0-9]', '', 'g') end;
  if v_phone is null or v_phone !~ '^[0-9]{6,15}$' then perform app.request_invalid('phone'); end if;
  v_email := case when jsonb_typeof(p_body -> 'email') = 'string' then lower(btrim(p_body ->> 'email')) end;
  if v_email is null or char_length(v_email) not between 3 and 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then perform app.request_invalid('email'); end if;
  v_locale := case when jsonb_typeof(p_body -> 'locale') = 'string' then p_body ->> 'locale' end;
  if v_locale is null or v_locale not in ('it', 'en') then perform app.request_invalid('locale'); end if;
  v_notice := case when jsonb_typeof(p_body -> 'privacyNoticeVersion') = 'string' then p_body ->> 'privacyNoticeVersion' end;
  if v_notice is null or char_length(v_notice) not between 1 and 40 then perform app.request_invalid('privacy'); end if;

  -- One request at a time per (tenant, date, service): the limits below are counted under this lock.
  perform pg_advisory_xact_lock(hashtextextended('resv:' || p_tenant::text || ':' || to_char(v_date, 'YYYY-MM-DD') || ':' || v_service, 0));
  v_reason := app.reservation_slot_reason(p_tenant, v_date, v_service, v_time, v_party, p_now, null, null);
  if v_reason is not null then
    raise exception 'slot_unavailable' using errcode = 'P0001', detail = jsonb_build_object('reason', v_reason)::text;
  end if;

  -- The throttle: the day is the venue's local day of p_now; the counters hold hashes only.
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_day := (p_now at time zone v_tz)::date;
  if (select count(*) from public.reservation r where r.tenant_id = p_tenant and r.status = 'pending' and r.starts_at > p_now) >= (v_limits ->> 'pendingPerTenant')::integer then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  foreach v_kind in array array['ip', 'email', 'phone'] loop
    v_value := case v_kind when 'ip' then nullif(btrim(p_ip), '') when 'email' then v_email else v_phone end;
    if v_value is null then
      continue;
    end if;
    insert into app.reservation_throttle (tenant_id, day, kind, key_hash, hits)
      values (p_tenant, v_day, v_kind, app.reservation_hash(v_kind, v_day, v_value), 1)
    on conflict (tenant_id, day, kind, key_hash) do update set hits = app.reservation_throttle.hits + 1
    returning hits into v_hits;
    if v_hits > (v_limits ->> v_kind)::integer then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end loop;

  v_cfg := app.reservation_settings_row(p_tenant);
  v_start := (v_date + v_time) at time zone v_tz;
  insert into public.reservation (tenant_id, id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
    values (p_tenant, v_id, app.business_date(p_tenant, v_start), v_service, v_start, v_start + make_interval(mins => (v_cfg ->> 'stay_minutes')::integer), v_party, v_notice, p_now);
  insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale) values (p_tenant, v_id, v_name, v_phone, v_email, v_locale);
  insert into public.reservation_event (tenant_id, reservation_id, kind, data)
    values (p_tenant, v_id, 'requested', jsonb_build_object('party', v_party, 'serviceKey', v_service, 'businessDate', app.business_date(p_tenant, v_start)));
  insert into public.reservation_email (tenant_id, reservation_id, kind) values (p_tenant, v_id, 'received');
  return jsonb_build_object('status', 'received');
end
$$;

revoke all on function app.reservation_limits(), app.reservation_hash(text, date, text),
  app.reservation_slot_reason(uuid, date, text, time, integer, timestamptz, text[], uuid), app.reservation_slots_json(uuid, date, integer, timestamptz),
  app.request_invalid(text), app.request_reservation_at(uuid, jsonb, text, timestamptz) from public, anon, authenticated, service_role;
