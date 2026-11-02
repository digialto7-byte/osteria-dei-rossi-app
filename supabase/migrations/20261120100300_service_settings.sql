-- M25c step 3 (docs/plans/2026-11-01-m25c-services.md §3.1.1, §3.2, §3.6; ADR-031): reading and saving a tenant's service periods.
--
--   app.service_periods_json     {periods: [{key, name, startsAt, endsAt}], cutoff: "HH:MM", since, isDefault} at an instant (since is the created_at of the version, null for the default).
--   app.set_service_periods_at   the writer, with a "now" the tests fix (null = clock_timestamp() after the lock). Order: shape (22023) -> the tenant's advisory lock -> the
--                                rules (P0001 service_periods_invalid, DETAIL {"reason": ...}, codes only) -> compare with the version in force -> insert a version or nothing.
--   public.service_periods, public.set_service_periods   thin wrappers: app.require_day_closer() first (owner, admin; 42501 for anyone else, before the body is read).
-- A new period is sent with key null and gets 's_' plus ten hex digits; a key that is sent must be in the version in force (key_unknown), so a client cannot mint keys.
-- A saved version applies to sessions opened from its created_at on; the past never moves. created_by is stored and never returned.

create function app.service_periods_json(p_tenant uuid, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_periods jsonb;
  v_since timestamptz;
  v_found boolean;
  v_cutoff time := app.business_day_cutoff(p_tenant);
begin
  select s.periods, s.created_at into v_periods, v_since
    from public.service_schedule s
   where s.tenant_id = p_tenant and s.created_at <= p_now
   order by s.created_at desc, s.seq desc limit 1;
  v_found := found;
  if not v_found then
    v_periods := app.default_service_periods();
  end if;
  return jsonb_build_object(
    'periods', (select coalesce(jsonb_agg(w - 'position' order by (w ->> 'position')::integer), '[]'::jsonb)
                  from jsonb_array_elements(app.service_windows(v_periods, v_cutoff)) w),
    'cutoff', to_char(v_cutoff, 'HH24:MI'),
    'since', case when v_found then to_jsonb(v_since) else 'null'::jsonb end,
    'isDefault', not v_found);
end
$$;

create function app.set_service_periods_at(p_tenant uuid, p_user uuid, p_body jsonb, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_in jsonb;
  v_norm jsonb;
  v_cur jsonb;
  v_new jsonb;
  v_now timestamptz;
  v_changed boolean := true;
  v_n integer;
begin
  perform app.menu_keys_ok(p_body, array['periods'], null);
  v_in := p_body -> 'periods';
  if jsonb_typeof(v_in) <> 'array' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_in) e
     where jsonb_typeof(e) <> 'object'
        or (select array_agg(k order by k collate "C") from jsonb_object_keys(e) k) is distinct from array['key', 'name', 'startsAt']
        or jsonb_typeof(e -> 'key') not in ('string', 'null') or jsonb_typeof(e -> 'name') <> 'string' or jsonb_typeof(e -> 'startsAt') <> 'string'
  ) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- One writer per tenant: a second save waits here and then reads the version the first one wrote.
  perform pg_advisory_xact_lock(hashtextextended('service_schedule:' || p_tenant::text, 0));
  v_now := coalesce(p_now, clock_timestamp());
  v_cur := app.service_periods_at(p_tenant, v_now);

  v_n := jsonb_array_length(v_in);
  if v_n < 1 or v_n > app.service_max_periods() then
    raise exception 'service_periods_invalid' using errcode = 'P0001', detail = '{"reason": "count"}';
  end if;
  select jsonb_agg(jsonb_build_object('key', e.e -> 'key', 'name', to_jsonb(regexp_replace(e.e ->> 'name', '^\s+|\s+$', '', 'g')), 'startsAt', e.e -> 'startsAt') order by e.ord)
    into v_norm from jsonb_array_elements(v_in) with ordinality e (e, ord);

  if exists (select 1 from jsonb_array_elements(v_norm) e where char_length(e ->> 'name') not between 1 and 30) then
    raise exception 'service_periods_invalid' using errcode = 'P0001', detail = '{"reason": "name"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_norm) e where (e ->> 'startsAt') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'service_periods_invalid' using errcode = 'P0001', detail = '{"reason": "start"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_norm) e where jsonb_typeof(e -> 'key') = 'string' and (e ->> 'key') !~ '^[a-z][a-z0-9_]{1,31}$') then
    raise exception 'service_periods_invalid' using errcode = 'P0001', detail = '{"reason": "key"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_norm) e
              where jsonb_typeof(e -> 'key') = 'string'
                and (e ->> 'key') not in (select c ->> 'key' from jsonb_array_elements(v_cur) c)) then
    raise exception 'service_periods_invalid' using errcode = 'P0001', detail = '{"reason": "key_unknown"}';
  end if;
  if (select count(e ->> 'key') <> count(distinct e ->> 'key') from jsonb_array_elements(v_norm) e) then
    raise exception 'service_periods_invalid' using errcode = 'P0001', detail = '{"reason": "key_twice"}';
  end if;
  if (select count(distinct lower(e ->> 'name')) <> count(*) from jsonb_array_elements(v_norm) e) then
    raise exception 'service_periods_invalid' using errcode = 'P0001', detail = '{"reason": "name_twice"}';
  end if;
  if (select count(distinct e ->> 'startsAt') <> count(*) from jsonb_array_elements(v_norm) e) then
    raise exception 'service_periods_invalid' using errcode = 'P0001', detail = '{"reason": "start_twice"}';
  end if;

  -- Identical to the version in force (same keys, names and starts, as a set): nothing is written.
  if (select jsonb_agg(e order by e ->> 'key') from jsonb_array_elements(v_norm) e)
     is not distinct from (select jsonb_agg(c order by c ->> 'key') from jsonb_array_elements(v_cur) c) then
    v_changed := false;
  else
    select jsonb_agg(jsonb_build_object('key', coalesce(e ->> 'key', 's_' || left(replace(gen_random_uuid()::text, '-', ''), 10)),
                                        'name', e -> 'name', 'startsAt', e -> 'startsAt') order by ord)
      into v_new from jsonb_array_elements(v_norm) with ordinality t (e, ord);
    insert into public.service_schedule (tenant_id, periods, created_at, created_by) values (p_tenant, v_new, v_now, p_user);
  end if;
  return app.service_periods_json(p_tenant, v_now) || jsonb_build_object('changed', v_changed);
end
$$;

create function public.service_periods() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.service_periods_json(app.tenant_id(), clock_timestamp());
end
$$;

create function public.set_service_periods(p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.set_service_periods_at(app.tenant_id(), app.app_user_id(), p_body, null);
end
$$;

revoke all on function app.service_periods_json(uuid, timestamptz), app.set_service_periods_at(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.service_periods(), public.set_service_periods(jsonb) from public, anon, service_role;
grant execute on function public.service_periods(), public.set_service_periods(jsonb) to authenticated;
