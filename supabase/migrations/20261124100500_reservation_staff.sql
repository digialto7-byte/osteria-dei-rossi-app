-- Reservations A5 (docs/plans/2026-11-08-reservations.md §3.1.1, §3.2, §3.3, §5 A5): what staff do with a request.
--
--   accept_reservation(id, {tableIds, groupId})    pending -> accepted, with tables, a group or none; queues the accepted e-mail when the contact has an address.
--   decline_reservation(id, {reason})              pending or accepted -> declined; releases the tables; queues the declined e-mail.
--   move_reservation(id, {date, time, serviceKey, party})   pending or accepted, status kept; recomputes the slot and the end; releases the tables.
--   assign_reservation_tables(id, {tableIds, groupId})      accepted or arrived: release and assign again.
--   mark_reservation(id, {mark})                   accepted -> arrived (from its business day on); accepted or arrived -> no_show (from its start on). Waiters too.
--   seat_reservation(id, session)                  accepted or arrived -> seated on an open table session of an assigned table (any table when none is assigned). Waiters too.
--   erase_reservation_contact(id)                  deletes the personal data on request; the booking stays; its queued e-mails are skipped.
-- Owner and admin (app.require_day_closer) for all but mark and seat, which owner, admin and waiter may do (app.require_table_operator); the chef gets 42501 everywhere, before
-- the id or the body is read. Every public function is a thin wrapper over an app.*_at twin that takes p_now (and the caller's role, for the actions in the reply).
-- Each locks the reservation FOR UPDATE; the table assignments then take the per-(tenant, business date) advisory lock, a move also the request lock of its target slot. A request
-- equal to the current state writes nothing: changed false. Errors carry codes only.
-- The reply of each is the detail of the booking (app.reservation_detail_json, built here because every staff function returns it; A6 adds the day view and the public reads on top)
-- plus changed. A Row is one booking, so joinedTo is on each of its tables (the lead table is the table of the seated session, else the lowest position), and the Row names the lead
-- as leadTable: a departure from the plan's single joinedTo key.
-- A move also skips the table-fit rule (staff know their room), beyond the plan's lead and party.

-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers
create function app.reservation_lock(p_tenant uuid, p_id uuid) returns public.reservation
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
begin
  select x.* into r from public.reservation x where x.tenant_id = p_tenant and x.id = p_id for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  return r;
end
$$;

create function app.reservation_tables_lock(p_tenant uuid, p_date date) returns void
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('resv-tables:' || p_tenant::text || ':' || to_char(p_date, 'YYYY-MM-DD'), 0))
$$;

create function app.reservation_release_tables(p_tenant uuid, p_id uuid, p_user uuid, p_now timestamptz) returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.reservation_table set released_at = p_now, released_by = p_user
   where tenant_id = p_tenant and reservation_id = p_id and released_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- The tables of an accept or an assign: {tableIds: [...ordered by position], groupId}. Shape problems are 22023; an unknown, inactive or foreign table (or group), or a table
-- named twice, is P0002 table_not_found; a group with other tableIds is P0001 group_mismatch; a table held by another overlapping booking is P0001 table_taken.
create function app.reservation_pick_tables(p_tenant uuid, p_res public.reservation, p_body jsonb) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_given jsonb := p_body -> 'tableIds';
  v_group uuid;
  v_members uuid[];
  v_ids uuid[] := '{}';
begin
  if jsonb_typeof(v_given) not in ('array', 'null') or jsonb_typeof(p_body -> 'groupId') not in ('string', 'null') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if jsonb_typeof(v_given) = 'array' and (jsonb_array_length(v_given) > 8
     or exists (select 1 from jsonb_array_elements(v_given) e
                 where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if jsonb_typeof(p_body -> 'groupId') = 'string' then
    if (p_body ->> 'groupId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    v_group := (p_body ->> 'groupId')::uuid;
    if not exists (select 1 from public.table_group g where g.tenant_id = p_tenant and g.id = v_group and g.is_active) then
      raise exception 'table_not_found' using errcode = 'P0002';
    end if;
    select array_agg(m.dining_table_id order by m.dining_table_id) into v_members
      from public.table_group_member m where m.tenant_id = p_tenant and m.table_group_id = v_group;
    if jsonb_typeof(v_given) = 'array'
       and (select coalesce(array_agg((e #>> '{}')::uuid order by (e #>> '{}')::uuid), '{}') from jsonb_array_elements(v_given) e) is distinct from v_members then
      raise exception 'group_mismatch' using errcode = 'P0001';
    end if;
    v_ids := v_members;
  elsif jsonb_typeof(v_given) = 'array' then
    v_ids := array(select (e #>> '{}')::uuid from jsonb_array_elements(v_given) e);
    if (select count(distinct x) <> cardinality(v_ids) from unnest(v_ids) x) then
      raise exception 'table_not_found' using errcode = 'P0002';
    end if;
  end if;
  if cardinality(v_ids) > 0 and exists (
       select 1 from unnest(v_ids) x
        where not exists (select 1 from public.dining_table t where t.tenant_id = p_tenant and t.id = x and t.is_active)) then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(v_ids) x
              where x not in (select f.table_id from app.reservation_free_tables(p_tenant, p_res.starts_at, p_res.ends_at, p_res.id) f)) then
    raise exception 'table_taken' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'tableIds', coalesce((select jsonb_agg(t.id order by t.position, t.name collate "C", t.id) from public.dining_table t where t.tenant_id = p_tenant and t.id = any (v_ids)), '[]'::jsonb),
    'groupId', to_jsonb(v_group));
end
$$;

-- True when the current (unreleased) assignment of a booking is exactly p_pick.
create function app.reservation_same_tables(p_tenant uuid, p_id uuid, p_pick jsonb) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce((select array_agg(rt.dining_table_id order by rt.dining_table_id) from public.reservation_table rt
                    where rt.tenant_id = p_tenant and rt.reservation_id = p_id and rt.released_at is null), '{}')
         = coalesce((select array_agg((e #>> '{}')::uuid order by (e #>> '{}')::uuid) from jsonb_array_elements(p_pick -> 'tableIds') e), '{}')
     and (select rt.table_group_id from public.reservation_table rt where rt.tenant_id = p_tenant and rt.reservation_id = p_id and rt.released_at is null and rt.table_group_id is not null limit 1)
         is not distinct from nullif(p_pick ->> 'groupId', '')::uuid
$$;

create function app.reservation_assign(p_tenant uuid, p_user uuid, p_res public.reservation, p_pick jsonb, p_now timestamptz) returns void
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, table_group_id, assigned_at, assigned_by)
    select p_tenant, p_res.id, (e #>> '{}')::uuid, nullif(p_pick ->> 'groupId', '')::uuid, p_now, p_user from jsonb_array_elements(p_pick -> 'tableIds') e
$$;

create function app.reservation_event(p_tenant uuid, p_id uuid, p_kind text, p_data jsonb, p_user uuid, p_now timestamptz) returns void
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  insert into public.reservation_event (tenant_id, reservation_id, kind, data, created_at, created_by) values (p_tenant, p_id, p_kind, p_data, p_now, p_user)
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The detail of a booking, for a role. The status is the effective one (a pending request past its start reads expired). The personal data is null once erased. actions is
-- what the caller may do now; emailStatus is for owner and admin only.
create function app.reservation_row_json(p_tenant uuid, p_id uuid, p_role text, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
  c public.reservation_contact;
  v_has_contact boolean;
  v_tz text;
  v_status text;
  v_today date;
  v_staff boolean := p_role in ('owner', 'admin');
  v_actions text[] := '{}';
  v_tables jsonb;
  v_lead jsonb;
  v_group text;
  v_group_id uuid;
  v_joined boolean;
  v_row jsonb;
begin
  select x.* into r from public.reservation x where x.tenant_id = p_tenant and x.id = p_id;
  if not found then
    return null;
  end if;
  select y.* into c from public.reservation_contact y where y.tenant_id = p_tenant and y.reservation_id = p_id;
  v_has_contact := found;
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_status := case when r.status = 'pending' and p_now >= r.starts_at then 'expired' else r.status::text end;
  v_today := app.business_date(p_tenant, p_now);

  with cur as (
    select rt.dining_table_id as id, t.name, t.position, rt.table_group_id
      from public.reservation_table rt join public.dining_table t on t.tenant_id = rt.tenant_id and t.id = rt.dining_table_id
     where rt.tenant_id = p_tenant and rt.reservation_id = p_id and rt.released_at is null),
  lead as (
    select coalesce((select s.dining_table_id from public.table_session s where s.tenant_id = p_tenant and s.id = r.table_session_id),
                    (select k.id from cur k order by k.position, k.name collate "C", k.id limit 1)) as id)
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name,
                                               'joinedTo', case when k.id = l.id or l.id is null then null
                                                                else (select jsonb_build_object('id', x.id, 'name', x.name) from cur x where x.id = l.id) end)
                            order by k.position, k.name collate "C", k.id), '[]'::jsonb),
         (select jsonb_build_object('id', x.id, 'name', x.name) from cur x where x.id = l.id),
         (select g.name from cur k2 join public.table_group g on g.tenant_id = p_tenant and g.id = k2.table_group_id limit 1),
         (select k2.table_group_id from cur k2 where k2.table_group_id is not null limit 1),
         coalesce(bool_or(k.id <> l.id), false)
    into v_tables, v_lead, v_group, v_group_id, v_joined
    from cur k cross join lead l
   group by l.id;
  v_tables := coalesce(v_tables, '[]'::jsonb);
  v_joined := coalesce(v_joined, false);

  -- Actions, in this order: accept, decline, move, tables, arrived, no_show, seat, split, erase.
  if v_staff and v_status = 'pending' then
    v_actions := array['accept', 'decline', 'move'];
  elsif v_staff and v_status = 'accepted' then
    v_actions := array['decline', 'move', 'tables'];
  elsif v_staff and v_status = 'arrived' then
    v_actions := array['tables'];
  end if;
  if r.status = 'accepted' and v_today >= r.business_date then
    v_actions := v_actions || 'arrived'::text;
  end if;
  if r.status in ('accepted', 'arrived') and p_now >= r.starts_at then
    v_actions := v_actions || 'no_show'::text;
  end if;
  if r.status in ('accepted', 'arrived') and v_today = r.business_date then
    v_actions := v_actions || 'seat'::text;
  end if;
  -- Split only while the tables are joined: the session of the booking is still open (the rule of app.table_joined_to); after it closes there is nothing to split.
  if r.status = 'seated' and v_joined and exists (select 1 from public.table_session s where s.tenant_id = p_tenant and s.id = r.table_session_id and s.closed_at is null) then
    v_actions := v_actions || 'split'::text;
  end if;
  if v_staff and v_has_contact then
    v_actions := v_actions || 'erase'::text;
  end if;

  v_row := jsonb_build_object(
    'id', r.id,
    'time', to_char(r.starts_at at time zone v_tz, 'HH24:MI'),
    'startsAt', r.starts_at,
    'endsAt', r.ends_at,
    'businessDate', r.business_date,
    'serviceKey', r.service_key,
    'party', r.party,
    'status', v_status,
    'source', r.source,
    'name', case when v_has_contact then to_jsonb(c.name) else 'null'::jsonb end,
    'phone', case when v_has_contact then to_jsonb(c.phone) else 'null'::jsonb end,
    'email', case when v_has_contact then to_jsonb(c.email) else 'null'::jsonb end,
    'tables', v_tables,
    'leadTable', coalesce(v_lead, 'null'::jsonb),
    'groupName', to_jsonb(v_group),
    'groupId', to_jsonb(v_group_id),
    'sessionId', to_jsonb(r.table_session_id),
    'actions', to_jsonb(v_actions));
  if v_staff then
    v_row := v_row || jsonb_build_object('emailStatus', (select to_jsonb(e.status) from public.reservation_email e
                                                          where e.tenant_id = p_tenant and e.reservation_id = p_id order by e.created_at desc, e.id desc limit 1));
  end if;
  return v_row;
end
$$;

create function app.reservation_detail_json(p_tenant uuid, p_id uuid, p_role text, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_row jsonb := app.reservation_row_json(p_tenant, p_id, p_role, p_now);
begin
  if v_row is null then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  v_row := v_row || jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.created_at) order by e.seq)
                                                             from public.reservation_event e where e.tenant_id = p_tenant and e.reservation_id = p_id), '[]'::jsonb));
  if p_role in ('owner', 'admin') and v_row ->> 'status' in ('pending', 'accepted') then
    v_row := v_row || jsonb_build_object('suggestion', app.reservation_suggest(p_tenant, p_id));
  end if;
  return v_row;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Accept
create function app.accept_reservation_at(p_tenant uuid, p_user uuid, p_role text, p_id uuid, p_body jsonb, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
  v_pick jsonb;
begin
  perform app.menu_keys_ok(p_body, array['tableIds', 'groupId'], array['tableIds', 'groupId']);
  r := app.reservation_lock(p_tenant, p_id);
  perform app.reservation_tables_lock(p_tenant, r.business_date);
  if r.status = 'accepted' then
    -- A repeated accept with the same tables is a no-op; anything else on an accepted booking is the assign function's job.
    v_pick := app.reservation_pick_tables(p_tenant, r, p_body);
    if app.reservation_same_tables(p_tenant, r.id, v_pick) then
      return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', false);
    end if;
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  if r.status = 'expired' or (r.status = 'pending' and p_now >= r.starts_at) then
    raise exception 'reservation_expired' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  v_pick := app.reservation_pick_tables(p_tenant, r, p_body);
  update public.reservation set status = 'accepted', updated_at = p_now where tenant_id = p_tenant and id = r.id;
  perform app.reservation_assign(p_tenant, p_user, r, v_pick, p_now);
  perform app.reservation_event(p_tenant, r.id, 'accepted', jsonb_build_object('tableIds', v_pick -> 'tableIds', 'groupId', v_pick -> 'groupId'), p_user, p_now);
  insert into public.reservation_email (tenant_id, reservation_id, kind, next_attempt_at)
    select p_tenant, r.id, 'accepted', p_now from public.reservation_contact c where c.tenant_id = p_tenant and c.reservation_id = r.id and c.email is not null;
  return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', true);
end
$$;

-- Decline
create function app.decline_reservation_at(p_tenant uuid, p_user uuid, p_role text, p_id uuid, p_body jsonb, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
begin
  perform app.menu_keys_ok(p_body, array['reason'], array['reason']);
  if jsonb_typeof(p_body -> 'reason') <> 'string' or (p_body ->> 'reason') not in ('full', 'closed', 'other') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  r := app.reservation_lock(p_tenant, p_id);
  if r.status = 'declined' then
    return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', false);
  end if;
  if r.status not in ('pending', 'accepted') then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  perform app.reservation_tables_lock(p_tenant, r.business_date);
  update public.reservation set status = 'declined', updated_at = p_now where tenant_id = p_tenant and id = r.id;
  perform app.reservation_release_tables(p_tenant, r.id, p_user, p_now);
  perform app.reservation_event(p_tenant, r.id, 'declined', jsonb_build_object('reason', p_body ->> 'reason'), p_user, p_now);
  -- Staff may still clear a request whose start has passed (it reads expired), but the guest is not told after the fact.
  if p_now < r.starts_at then
    insert into public.reservation_email (tenant_id, reservation_id, kind, next_attempt_at)
      select p_tenant, r.id, 'declined', p_now from public.reservation_contact c where c.tenant_id = p_tenant and c.reservation_id = r.id and c.email is not null;
  end if;
  return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', true);
end
$$;

-- Move
create function app.move_reservation_at(p_tenant uuid, p_user uuid, p_role text, p_id uuid, p_body jsonb, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
  v_date date;
  v_service text;
  v_time time;
  v_party integer;
  v_tz text;
  v_start timestamptz;
  v_stay integer;
  v_reason text;
begin
  perform app.menu_keys_ok(p_body, array['date', 'time', 'serviceKey', 'party'], array['date', 'time', 'serviceKey', 'party']);
  v_date := case when jsonb_typeof(p_body -> 'date') = 'string' then app.reservation_date(p_body ->> 'date') end;
  if v_date is null then perform app.request_invalid('date'); end if;
  if jsonb_typeof(p_body -> 'time') <> 'string' or (p_body ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform app.request_invalid('time'); end if;
  v_time := (p_body ->> 'time')::time;
  v_service := case when jsonb_typeof(p_body -> 'serviceKey') = 'string' then p_body ->> 'serviceKey' end;
  if v_service is null or v_service !~ '^[a-z][a-z0-9_]{1,31}$' then perform app.request_invalid('service'); end if;
  v_party := app.reservation_int(p_body -> 'party', 1, 99);
  if v_party is null then perform app.request_invalid('party'); end if;

  r := app.reservation_lock(p_tenant, p_id);
  if r.status not in ('pending', 'accepted') then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_start := (v_date + v_time) at time zone v_tz;
  if v_start = r.starts_at and v_service = r.service_key and v_party = r.party then
    return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', false);
  end if;
  perform app.reservation_tables_lock(p_tenant, r.business_date);
  perform pg_advisory_xact_lock(hashtextextended('resv:' || p_tenant::text || ':' || to_char(v_date, 'YYYY-MM-DD') || ':' || v_service, 0));
  -- Staff may move inside the lead time, above the online maximum, and past the table fit; the other rules hold.
  v_reason := app.reservation_slot_reason(p_tenant, v_date, v_service, v_time, v_party, p_now, array['lead', 'party', 'no_fit'], r.id);
  if v_reason is null and v_start <= p_now then
    v_reason := 'lead';
  end if;
  if v_reason is not null then
    raise exception 'slot_unavailable' using errcode = 'P0001', detail = jsonb_build_object('reason', v_reason)::text;
  end if;
  v_stay := (app.reservation_settings_row(p_tenant) ->> 'stay_minutes')::integer;
  update public.reservation
     set business_date = app.business_date(p_tenant, v_start), service_key = v_service, starts_at = v_start, ends_at = v_start + make_interval(mins => v_stay),
         party = v_party, updated_at = p_now
   where tenant_id = p_tenant and id = r.id;
  perform app.reservation_release_tables(p_tenant, r.id, p_user, p_now);
  perform app.reservation_event(p_tenant, r.id, 'moved',
    jsonb_build_object('from', jsonb_build_object('startsAt', r.starts_at, 'serviceKey', r.service_key, 'party', r.party),
                       'to', jsonb_build_object('startsAt', v_start, 'serviceKey', v_service, 'party', v_party)), p_user, p_now);
  return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', true);
end
$$;

-- Assign tables
create function app.assign_reservation_tables_at(p_tenant uuid, p_user uuid, p_role text, p_id uuid, p_body jsonb, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
  v_pick jsonb;
begin
  perform app.menu_keys_ok(p_body, array['tableIds', 'groupId'], array['tableIds', 'groupId']);
  r := app.reservation_lock(p_tenant, p_id);
  if r.status not in ('accepted', 'arrived') then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  perform app.reservation_tables_lock(p_tenant, r.business_date);
  -- "Keep current" is answered before the pick is validated, so it stays a no-op when the assigned group has since been
  -- deactivated (the pick would refuse it). Only well-formed ids reach the comparison; anything else is validated below.
  if jsonb_typeof(p_body -> 'tableIds') = 'array'
     and not exists (select 1 from jsonb_array_elements(p_body -> 'tableIds') e
                      where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     and (jsonb_typeof(p_body -> 'groupId') = 'null'
          or (jsonb_typeof(p_body -> 'groupId') = 'string' and (p_body ->> 'groupId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
     and exists (select 1 from public.reservation_table rt where rt.tenant_id = p_tenant and rt.reservation_id = r.id and rt.released_at is null)
     and app.reservation_same_tables(p_tenant, r.id, p_body) then
    return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', false);
  end if;
  v_pick := app.reservation_pick_tables(p_tenant, r, p_body);
  if app.reservation_same_tables(p_tenant, r.id, v_pick) then
    return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', false);
  end if;
  perform app.reservation_release_tables(p_tenant, r.id, p_user, p_now);
  perform app.reservation_assign(p_tenant, p_user, r, v_pick, p_now);
  update public.reservation set updated_at = p_now where tenant_id = p_tenant and id = r.id;
  perform app.reservation_event(p_tenant, r.id, 'tables_assigned', jsonb_build_object('tableIds', v_pick -> 'tableIds', 'groupId', v_pick -> 'groupId'), p_user, p_now);
  return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', true);
end
$$;

-- Mark arrived or no-show
create function app.mark_reservation_at(p_tenant uuid, p_user uuid, p_role text, p_id uuid, p_body jsonb, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
  v_mark text;
begin
  perform app.menu_keys_ok(p_body, array['mark'], array['mark']);
  if jsonb_typeof(p_body -> 'mark') <> 'string' or (p_body ->> 'mark') not in ('arrived', 'no_show') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_mark := p_body ->> 'mark';
  r := app.reservation_lock(p_tenant, p_id);
  if r.status::text = v_mark then
    return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', false);
  end if;
  if v_mark = 'arrived' then
    if r.status <> 'accepted' then
      raise exception 'status_invalid' using errcode = 'P0001';
    end if;
    if app.business_date(p_tenant, p_now) < r.business_date then
      raise exception 'too_early' using errcode = 'P0001';
    end if;
  else
    if r.status not in ('accepted', 'arrived') then
      raise exception 'status_invalid' using errcode = 'P0001';
    end if;
    if p_now < r.starts_at then
      raise exception 'too_early' using errcode = 'P0001';
    end if;
  end if;
  update public.reservation set status = v_mark::public.reservation_status, updated_at = p_now where tenant_id = p_tenant and id = r.id;
  perform app.reservation_event(p_tenant, r.id, v_mark, '{}'::jsonb, p_user, p_now);
  return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', true);
end
$$;

-- Seat on an open table session, on the booking's own business day only (too_early before it, not_today after it).
-- Lock order: the reservation row, then the session row FOR SHARE (close_table takes the session FOR UPDATE and no reservation lock), then the dining_table rows of the booking's
-- unreleased assignment FOR UPDATE in id order: the same row lock open_table takes first on its table. open_table takes no reservation or session lock after it, so no cycle.
-- Under that lock a non-lead table that already has a session of its own (open_table won the race, or it was opened earlier) is released from the booking with a tables_split
-- event, the same event as the split action: the party at that table is another party's (plan 5c: only a table without a session of its own is joined to the lead).
create function app.seat_reservation_at(p_tenant uuid, p_user uuid, p_role text, p_id uuid, p_session uuid, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
  s public.table_session;
  v_split uuid[];
begin
  r := app.reservation_lock(p_tenant, p_id);
  if r.status = 'seated' and r.table_session_id is not distinct from p_session and p_session is not null then
    return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', false);
  end if;
  if r.status not in ('accepted', 'arrived') then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  if app.business_date(p_tenant, p_now) < r.business_date then
    raise exception 'too_early' using errcode = 'P0001';
  end if;
  if app.business_date(p_tenant, p_now) > r.business_date then
    raise exception 'not_today' using errcode = 'P0001';
  end if;
  select x.* into s from public.table_session x where x.tenant_id = p_tenant and x.id = p_session for share;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.reservation_table rt where rt.tenant_id = p_tenant and rt.reservation_id = r.id and rt.released_at is null)
     and not exists (select 1 from public.reservation_table rt where rt.tenant_id = p_tenant and rt.reservation_id = r.id and rt.released_at is null and rt.dining_table_id = s.dining_table_id) then
    raise exception 'table_not_assigned' using errcode = 'P0001';
  end if;
  if s.closed_at is not null then
    raise exception 'session_closed' using errcode = 'P0001';
  end if;
  perform 1 from public.dining_table d
   where d.tenant_id = p_tenant
     and d.id in (select rt.dining_table_id from public.reservation_table rt where rt.tenant_id = p_tenant and rt.reservation_id = r.id and rt.released_at is null)
   order by d.id
     for update;
  v_split := array(
    select rt.dining_table_id from public.reservation_table rt
     where rt.tenant_id = p_tenant and rt.reservation_id = r.id and rt.released_at is null and rt.dining_table_id <> s.dining_table_id
       and exists (select 1 from public.table_session o where o.tenant_id = p_tenant and o.dining_table_id = rt.dining_table_id and o.closed_at is null)
     order by rt.dining_table_id);
  update public.reservation set status = 'seated', table_session_id = s.id, updated_at = p_now where tenant_id = p_tenant and id = r.id;
  perform app.reservation_event(p_tenant, r.id, 'seated', jsonb_build_object('sessionId', s.id, 'tableId', s.dining_table_id), p_user, p_now);
  if cardinality(v_split) > 0 then
    update public.reservation_table set released_at = p_now, released_by = p_user
     where tenant_id = p_tenant and reservation_id = r.id and released_at is null and dining_table_id = any (v_split);
    perform app.reservation_event(p_tenant, r.id, 'tables_split', jsonb_build_object('tableIds', to_jsonb(v_split)), p_user, p_now);
  end if;
  return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', true);
end
$$;

-- Erase the personal data on request
create function app.erase_reservation_contact_at(p_tenant uuid, p_user uuid, p_role text, p_id uuid, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
  v_n integer;
begin
  r := app.reservation_lock(p_tenant, p_id);
  perform set_config('app.contact_delete', 'on', true);
  delete from public.reservation_contact where tenant_id = p_tenant and reservation_id = r.id;
  get diagnostics v_n = row_count;
  perform set_config('app.contact_delete', '', true);
  if v_n > 0 then
    update public.reservation_email set status = 'skipped', lease_until = null, error_code = 'contact_erased'
     where tenant_id = p_tenant and reservation_id = r.id and status in ('queued', 'sending', 'failed');
    perform app.reservation_event(p_tenant, r.id, 'contact_erased', '{}'::jsonb, p_user, p_now);
  end if;
  return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', v_n > 0);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Public wrappers: the role gate first, then the twin with the real clock.
create function public.accept_reservation(p_id uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.accept_reservation_at(app.tenant_id(), app.app_user_id(), app.role()::text, p_id, p_body, clock_timestamp());
end
$$;

create function public.decline_reservation(p_id uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.decline_reservation_at(app.tenant_id(), app.app_user_id(), app.role()::text, p_id, p_body, clock_timestamp());
end
$$;

create function public.move_reservation(p_id uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.move_reservation_at(app.tenant_id(), app.app_user_id(), app.role()::text, p_id, p_body, clock_timestamp());
end
$$;

create function public.assign_reservation_tables(p_id uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.assign_reservation_tables_at(app.tenant_id(), app.app_user_id(), app.role()::text, p_id, p_body, clock_timestamp());
end
$$;

create function public.mark_reservation(p_id uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_table_operator();
  return app.mark_reservation_at(app.tenant_id(), app.app_user_id(), app.role()::text, p_id, p_body, clock_timestamp());
end
$$;

create function public.seat_reservation(p_id uuid, p_session uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_table_operator();
  return app.seat_reservation_at(app.tenant_id(), app.app_user_id(), app.role()::text, p_id, p_session, clock_timestamp());
end
$$;

create function public.erase_reservation_contact(p_id uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.erase_reservation_contact_at(app.tenant_id(), app.app_user_id(), app.role()::text, p_id, clock_timestamp());
end
$$;

revoke all on function app.reservation_lock(uuid, uuid), app.reservation_tables_lock(uuid, date), app.reservation_release_tables(uuid, uuid, uuid, timestamptz),
  app.reservation_pick_tables(uuid, public.reservation, jsonb), app.reservation_same_tables(uuid, uuid, jsonb),
  app.reservation_assign(uuid, uuid, public.reservation, jsonb, timestamptz), app.reservation_event(uuid, uuid, text, jsonb, uuid, timestamptz),
  app.reservation_row_json(uuid, uuid, text, timestamptz), app.reservation_detail_json(uuid, uuid, text, timestamptz),
  app.accept_reservation_at(uuid, uuid, text, uuid, jsonb, timestamptz), app.decline_reservation_at(uuid, uuid, text, uuid, jsonb, timestamptz),
  app.move_reservation_at(uuid, uuid, text, uuid, jsonb, timestamptz), app.assign_reservation_tables_at(uuid, uuid, text, uuid, jsonb, timestamptz),
  app.mark_reservation_at(uuid, uuid, text, uuid, jsonb, timestamptz), app.seat_reservation_at(uuid, uuid, text, uuid, uuid, timestamptz),
  app.erase_reservation_contact_at(uuid, uuid, text, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.accept_reservation(uuid, jsonb), public.decline_reservation(uuid, jsonb), public.move_reservation(uuid, jsonb),
  public.assign_reservation_tables(uuid, jsonb), public.mark_reservation(uuid, jsonb), public.seat_reservation(uuid, uuid), public.erase_reservation_contact(uuid)
  from public, anon, service_role;
grant execute on function public.accept_reservation(uuid, jsonb), public.decline_reservation(uuid, jsonb), public.move_reservation(uuid, jsonb),
  public.assign_reservation_tables(uuid, jsonb), public.mark_reservation(uuid, jsonb), public.seat_reservation(uuid, uuid), public.erase_reservation_contact(uuid) to authenticated;
