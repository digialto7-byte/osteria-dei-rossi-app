-- Reservations B1 (docs/plans/2026-11-08-reservations.md §3.1.9, §3.3.1, §3.7, §5 B1; ADR-032): the route gate and the anon wrappers of the public booking page.
--
--   app.reservation_gate_ok(function, slug, ts, mac, now)   true when mac = HMAC-SHA256(Vault reservation_gate_key, "resv-gate|v1|<function>|<slug>|<ts>") as 64 lower-case hex and
--                                  ts (epoch seconds) is within 60 s of now. During a rotation Vault reservation_gate_key_next is accepted too. No Vault key is P0001
--                                  reservations_unconfigured; anything else wrong is P0001 gate_invalid, with no detail. The MACs are compared as HMACs of themselves (the digests that
--                                  are compared are not the ones an attacker chose), and every key is tried, so the time taken does not tell which one matched.
--   app.reservation_public_tenant(slug, now)                the tenant of a slug that is enabled and ready, else P0002 not_found: one answer for an unknown, a disabled and a not-ready slug.
--   public.reservation_page(slug, ts, mac)                  the page config: venue, online services, date bounds, closed days, max party, phone, privacy block.
--   public.reservation_slots(slug, ts, mac, date, party)    app.reservation_slots_json (no count).
--   public.request_reservation(slug, ts, mac, body, ip)     app.request_reservation_at with the real clock. p_ip has no default: the route always passes it, and only its salted hash is stored.
-- All three are SECURITY DEFINER with an empty search_path, granted to anon only, and verify the gate FIRST: a malformed body with a bad gate is still gate_invalid. The cancel wrappers
-- come with B2. anon holds no table privilege; nothing here reads or writes a table as anon. Errors carry codes only.

create function app.reservation_gate_ok(p_function text, p_slug text, p_ts bigint, p_mac text, p_now timestamptz) returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_keys text[];
  v_key text;
  v_msg text;
  v_ok boolean := false;
begin
  select array_agg(s.decrypted_secret) into v_keys
    from vault.decrypted_secrets s
   where s.name in ('reservation_gate_key', 'reservation_gate_key_next') and s.decrypted_secret is not null;
  if v_keys is null then
    raise exception 'reservations_unconfigured' using errcode = 'P0001';
  end if;
  if p_function is null or p_slug is null or p_ts is null or p_now is null or p_mac is null or p_mac !~ '^[0-9a-f]{64}$'
     or abs(extract(epoch from p_now) - p_ts) > 60 then
    raise exception 'gate_invalid' using errcode = 'P0001';
  end if;
  v_msg := 'resv-gate|v1|' || p_function || '|' || p_slug || '|' || p_ts::text;
  foreach v_key in array v_keys loop
    v_ok := v_ok or extensions.hmac(decode(p_mac, 'hex'), convert_to(v_key, 'UTF8'), 'sha256')
                    = extensions.hmac(extensions.hmac(convert_to(v_msg, 'UTF8'), convert_to(v_key, 'UTF8'), 'sha256'), convert_to(v_key, 'UTF8'), 'sha256');
  end loop;
  if not v_ok then
    raise exception 'gate_invalid' using errcode = 'P0001';
  end if;
  return true;
end
$$;

create function app.reservation_public_tenant(p_slug text, p_now timestamptz) returns uuid
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select s.tenant_id into v_tenant from public.reservation_settings s where s.public_slug = p_slug and s.enabled;
  if v_tenant is null or cardinality(app.reservation_not_ready(v_tenant, app.reservation_settings_row(v_tenant), p_now)) > 0 then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_tenant;
end
$$;

create function app.reservation_page_json(p_tenant uuid, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_s jsonb := app.reservation_settings_json(p_tenant, p_now);
  v_name text;
  v_tz text;
begin
  select t.name, t.timezone into v_name, v_tz from public.tenant t where t.id = p_tenant;
  return jsonb_build_object(
    'venueName', v_name,
    'services', (select coalesce(jsonb_agg(jsonb_build_object('key', e ->> 'key', 'name', e ->> 'name') order by o), '[]'::jsonb)
                   from jsonb_array_elements(v_s -> 'services') with ordinality t(e, o)
                  where (e ->> 'online')::boolean and e ->> 'firstSeating' is not null and e ->> 'lastSeating' is not null),
    'minDate', to_char(((p_now + make_interval(mins => (v_s ->> 'leadMinutes')::integer)) at time zone v_tz)::date, 'YYYY-MM-DD'),
    'maxDate', to_char(app.business_date(p_tenant, p_now) + (v_s ->> 'horizonDays')::integer, 'YYYY-MM-DD'),
    'closedWeekdays', v_s -> 'closedWeekdays',
    'closedDates', v_s -> 'closedDates',
    'maxPartyOnline', v_s -> 'maxPartyOnline',
    'venuePhone', v_s -> 'venuePhone',
    'privacy', v_s -> 'privacy');
end
$$;

create function public.reservation_page(p_slug text, p_gate_ts bigint, p_gate_mac text) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  perform app.reservation_gate_ok('reservation_page', p_slug, p_gate_ts, p_gate_mac, v_now);
  return app.reservation_page_json(app.reservation_public_tenant(p_slug, v_now), v_now);
end
$$;

create function public.reservation_slots(p_slug text, p_gate_ts bigint, p_gate_mac text, p_date date, p_party integer) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_tenant uuid;
begin
  perform app.reservation_gate_ok('reservation_slots', p_slug, p_gate_ts, p_gate_mac, v_now);
  v_tenant := app.reservation_public_tenant(p_slug, v_now);
  if p_date is null then perform app.request_invalid('date'); end if;
  if p_party is null or p_party not between 1 and 99 then perform app.request_invalid('party'); end if;
  return app.reservation_slots_json(v_tenant, p_date, p_party, v_now);
end
$$;

create function public.request_reservation(p_slug text, p_gate_ts bigint, p_gate_mac text, p_body jsonb, p_ip text) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  perform app.reservation_gate_ok('request_reservation', p_slug, p_gate_ts, p_gate_mac, v_now);
  -- The per-IP daily limit counts the salted hash of p_ip: a null or blank one would skip it without a word, so it is refused.
  if nullif(btrim(p_ip), '') is null then
    perform app.request_invalid('ip');
  end if;
  return app.request_reservation_at(app.reservation_public_tenant(p_slug, v_now), p_body, p_ip, v_now);
end
$$;

revoke all on function app.reservation_gate_ok(text, text, bigint, text, timestamptz), app.reservation_public_tenant(text, timestamptz),
  app.reservation_page_json(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reservation_page(text, bigint, text), public.reservation_slots(text, bigint, text, date, integer),
  public.request_reservation(text, bigint, text, jsonb, text) from public, authenticated, service_role;
grant execute on function public.reservation_page(text, bigint, text), public.reservation_slots(text, bigint, text, date, integer),
  public.request_reservation(text, bigint, text, jsonb, text) to anon;
