-- M11 step 2: the business-day cut-off helpers (M11 plan §3.1.7, §3.2). A staff session ends at the next
-- cut-off; M21 and M22 reuse these. No API role can execute them.
--
-- DST rule: a cut-off is the FIRST instant at which the venue clock reads the cut-off time or later.
-- An ambiguous time (autumn change, 02:00 happens twice) is the earlier occurrence; a missing time
-- (spring change, 02:00 does not exist) is the instant of the jump. The comparison of offsets is done
-- here and does not rely on Postgres's default resolution of such wall times.

-- The tenant's cut-off: settings.business_day_cutoff as HH:MM, else 02:00 (project Q18).
create function app.business_day_cutoff(p_tenant uuid) returns time
  language plpgsql stable security definer
  set search_path = ''
as $$
declare
  v_settings jsonb;
  v_value text;
begin
  select t.settings into v_settings from public.tenant t where t.id = p_tenant;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(v_settings -> 'business_day_cutoff') = 'string' then
    v_value := v_settings ->> 'business_day_cutoff';
    if v_value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return v_value::time;
    end if;
  end if;
  return time '02:00';
end
$$;

-- The first instant whose local wall time in p_tz is at or after p_date + p_time.
create function app.local_instant(p_date date, p_time time, p_tz text) returns timestamptz
  language plpgsql immutable
  set search_path = ''
as $$
declare
  v_wall timestamp := p_date + p_time;
  v_wall_utc timestamptz := v_wall at time zone 'UTC';
  -- The UTC offsets in force a day before and a day after (they differ only around a change).
  v_off_before interval;
  v_off_after interval;
  v_c1 timestamptz;
  v_c2 timestamptz;
  v_ok1 boolean;
  v_ok2 boolean;
  v_lo bigint;
  v_hi bigint;
  v_mid bigint;
begin
  v_off_before := ((v_wall_utc - interval '1 day') at time zone p_tz)
                  - ((v_wall_utc - interval '1 day') at time zone 'UTC');
  v_off_after := ((v_wall_utc + interval '1 day') at time zone p_tz)
                 - ((v_wall_utc + interval '1 day') at time zone 'UTC');
  v_c1 := v_wall_utc - v_off_before;
  v_c2 := v_wall_utc - v_off_after;
  v_ok1 := (v_c1 at time zone p_tz) = v_wall;
  v_ok2 := (v_c2 at time zone p_tz) = v_wall;
  if v_ok1 and v_ok2 then
    return least(v_c1, v_c2);
  elsif v_ok1 then
    return v_c1;
  elsif v_ok2 then
    return v_c2;
  end if;
  -- The wall time does not exist: the answer is the instant of the jump, between the two candidates
  -- (offset before at the earlier one, offset after at the later one). Bisect to the second.
  v_lo := extract(epoch from least(v_c1, v_c2))::bigint;
  v_hi := extract(epoch from greatest(v_c1, v_c2))::bigint;
  while v_hi - v_lo > 1 loop
    v_mid := (v_lo + v_hi) / 2;
    if (to_timestamp(v_mid) at time zone p_tz) - (to_timestamp(v_mid) at time zone 'UTC') = v_off_after then
      v_hi := v_mid;
    else
      v_lo := v_mid;
    end if;
  end loop;
  return to_timestamp(v_hi);
end
$$;

-- The next cut-off strictly after p_at.
create function app.next_cutoff(p_at timestamptz, p_tz text, p_cutoff time) returns timestamptz
  language plpgsql immutable
  set search_path = ''
as $$
declare
  v_date date := (p_at at time zone p_tz)::date;
  v_c timestamptz;
begin
  v_c := app.local_instant(v_date, p_cutoff, p_tz);
  if v_c <= p_at then
    v_c := app.local_instant(v_date + 1, p_cutoff, p_tz);
  end if;
  return v_c;
end
$$;

revoke all on function app.business_day_cutoff(uuid), app.local_instant(date, time, text),
  app.next_cutoff(timestamptz, text, time) from public, anon, authenticated, service_role;
