-- M25c step 2 (docs/plans/2026-11-01-m25c-services.md §3.1.2, §3.2; ADR-031): which service a table session belongs to.
--
--   app.service_minute        the minute of a wall time on the business clock: (minutes(t) - minutes(cutoff) + 1440) % 1440.
--   app.service_windows       the periods of a version sorted by that minute, each with its position (1...n) and its end (the next start; the last ends at the cut-off).
--   app.service_key_for       the auto key: the period with the greatest start at or before the local time; none yet (02:00 to the first start) -> the first period.
--   app.service_periods_at    the version in force at an instant: the greatest (created_at, seq) not after it, else the built-in default.
--   app.session_services      the service of every CLOSED session whose closed_business_date is in a range (the kpi_session_rows filter).
--   app.session_service_one   the same for one session, open or closed, plus the keys it can be moved to (the version in force at its opening).
--   app.service_labels        {key: {name, position}}: the current version, then every older key with its latest name and position null.
-- Nothing is written to table_session: the service is derived from opened_at (local wall time in the tenant's zone), the cut-off and the versions, all of which
-- are immutable or forward-only. The latest override (by created_at, seq) wins when it is not null.

create function app.service_minute(p_t time, p_cutoff time) returns integer
  language sql
  immutable
  security definer
  set search_path = ''
as $$
  select (((extract(hour from p_t)::integer * 60 + extract(minute from p_t)::integer)
           - (extract(hour from p_cutoff)::integer * 60 + extract(minute from p_cutoff)::integer)) + 1440) % 1440
$$;

create function app.service_windows(p_periods jsonb, p_cutoff time) returns jsonb
  language sql
  immutable
  security definer
  set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', w.k, 'name', w.n, 'startsAt', w.s, 'position', w.pos,
                                               'endsAt', coalesce(w.nxt, to_char(p_cutoff, 'HH24:MI'))) order by w.pos), '[]'::jsonb)
    from (select e ->> 'key' as k, e ->> 'name' as n, e ->> 'startsAt' as s,
                 row_number() over (order by app.service_minute((e ->> 'startsAt')::time, p_cutoff)) as pos,
                 lead(e ->> 'startsAt') over (order by app.service_minute((e ->> 'startsAt')::time, p_cutoff)) as nxt
            from jsonb_array_elements(p_periods) e) w
$$;

create function app.service_key_for(p_periods jsonb, p_local time, p_cutoff time) returns text
  language sql
  immutable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select e ->> 'key' from jsonb_array_elements(p_periods) e
      where app.service_minute((e ->> 'startsAt')::time, p_cutoff) <= app.service_minute(p_local, p_cutoff)
      order by app.service_minute((e ->> 'startsAt')::time, p_cutoff) desc limit 1),
    (select e ->> 'key' from jsonb_array_elements(p_periods) e
      order by app.service_minute((e ->> 'startsAt')::time, p_cutoff) asc limit 1))
$$;

create function app.service_periods_at(p_tenant uuid, p_at timestamptz) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select v.periods from public.service_schedule v
      where v.tenant_id = p_tenant and v.created_at <= p_at
      order by v.created_at desc, v.seq desc limit 1),
    app.default_service_periods())
$$;

create function app.session_services(p_tenant uuid, p_from date, p_to date)
  returns table (session_id uuid, closed_business_date date, opened_at timestamptz, auto_key text, override_key text, service_key text, overridden boolean)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.id, s.closed_business_date, s.opened_at, k.auto_key, o.service_key, coalesce(o.service_key, k.auto_key), o.service_key is not null
    from public.table_session s
    join public.tenant t on t.id = s.tenant_id
   cross join lateral (select app.business_day_cutoff(p_tenant) as cutoff) c
   cross join lateral (select app.service_key_for(app.service_periods_at(s.tenant_id, s.opened_at),
                                                  (s.opened_at at time zone t.timezone)::time, c.cutoff) as auto_key) k
    left join lateral (select ov.service_key from public.service_override ov
                        where ov.tenant_id = s.tenant_id and ov.table_session_id = s.id
                        order by ov.created_at desc, ov.seq desc limit 1) o on true
   where s.tenant_id = p_tenant and s.closed_at is not null
     and s.closed_business_date between p_from and p_to
$$;

create function app.session_service_one(p_tenant uuid, p_session uuid)
  returns table (auto_key text, override_key text, service_key text, overridden boolean, choices text[])
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select k.auto_key, o.service_key, coalesce(o.service_key, k.auto_key), o.service_key is not null,
         array(select w ->> 'key' from jsonb_array_elements(app.service_windows(v.periods, c.cutoff)) w order by (w ->> 'position')::integer)
    from public.table_session s
    join public.tenant t on t.id = s.tenant_id
   cross join lateral (select app.business_day_cutoff(p_tenant) as cutoff) c
   cross join lateral (select app.service_periods_at(s.tenant_id, s.opened_at) as periods) v
   cross join lateral (select app.service_key_for(v.periods, (s.opened_at at time zone t.timezone)::time, c.cutoff) as auto_key) k
    left join lateral (select ov.service_key from public.service_override ov
                        where ov.tenant_id = s.tenant_id and ov.table_session_id = s.id
                        order by ov.created_at desc, ov.seq desc limit 1) o on true
   where s.tenant_id = p_tenant and s.id = p_session
$$;

create function app.service_labels(p_tenant uuid, p_now timestamptz) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with cur as (
    select w ->> 'key' as k, w ->> 'name' as n, (w ->> 'position')::integer as pos
      from jsonb_array_elements(app.service_windows(app.service_periods_at(p_tenant, p_now), app.business_day_cutoff(p_tenant))) w),
  hist as (
    select e ->> 'key' as k, e ->> 'name' as n, v.created_at as ts, v.seq as sq
      from public.service_schedule v cross join lateral jsonb_array_elements(v.periods) e
     where v.tenant_id = p_tenant and v.created_at <= p_now
    union all
    select e ->> 'key', e ->> 'name', '-infinity'::timestamptz, 0::bigint from jsonb_array_elements(app.default_service_periods()) e),
  latest as (select distinct on (h.k) h.k, h.n from hist h order by h.k, h.ts desc, h.sq desc)
  select coalesce(jsonb_object_agg(x.k, jsonb_build_object('name', x.n, 'position', x.pos)), '{}'::jsonb)
    from (select c.k, c.n, c.pos from cur c
          union all
          select l.k, l.n, null::integer from latest l where l.k not in (select c2.k from cur c2)) x
$$;

revoke all on function app.service_minute(time, time), app.service_windows(jsonb, time), app.service_key_for(jsonb, time, time),
  app.service_periods_at(uuid, timestamptz), app.session_services(uuid, date, date), app.session_service_one(uuid, uuid),
  app.service_labels(uuid, timestamptz) from public, anon, authenticated, service_role;
