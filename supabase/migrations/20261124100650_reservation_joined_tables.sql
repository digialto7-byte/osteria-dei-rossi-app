-- Reservations A7b (docs/plans/2026-11-08-reservations.md §5c, founder Q-R6 = V4): the tables of a combined booking are joined to its lead while it is seated, and a split action.
--
--   app.table_joined_to(tenant, table)   the lead table when the table is joined: it is still assigned (not released) to a SEATED reservation whose session is OPEN on another table, and
--                                        has no open session of its own; else null. The lock ends by itself when the lead session closes (close_table is not touched).
--   public.tables_list                   REPLACED on purpose (create or replace, same signature, grants and security as 20261031100600): a joined table shows status "joined" and no
--                                        session, plus joinedTo {id, name}; every other tile is byte for byte what it was (no joinedTo key).
--   public.open_table                    REPLACED on purpose (create or replace, same signature, grants and security as 20261031100500): after the existing checks, a joined table is
--                                        P0001 table_joined. The offline apply_op calls this same function, so the replay path refuses it the same way; the outcome is rejected because app.sync_conflict_codes() (pinned in pgTAP 212 and 222) decides what counts as a conflict, and table_joined is not among its codes.
--   app.split_reservation_tables_at / public.split_reservation_tables(reservation, tables default null)   owner, admin, waiter (app.require_table_operator): releases the given tables, or
--                                        every non-lead table when null, from a SEATED booking's assignment. status_invalid when it is not seated; lead_table when the lead is named;
--                                        table_not_assigned for a table that was never assigned to it; changed false when nothing is left to release. Event tables_split with the ids.
-- Everything else of open_table and tables_list below is the text of the M17 migrations. Both md5 pins (pgTAP 214, 222, 229, 286, 296) are re-pinned on purpose to these bodies; every
-- M17 to M21 case of those functions stays green. The lead is the table of the booking's session (the table the waiter opened), which is the lowest-position table by default.

create function app.table_joined_to(p_tenant uuid, p_table uuid) returns uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.dining_table_id
    from public.reservation_table rt
    join public.reservation r on r.tenant_id = rt.tenant_id and r.id = rt.reservation_id
    join public.table_session s on s.tenant_id = r.tenant_id and s.id = r.table_session_id
   where rt.tenant_id = p_tenant and rt.dining_table_id = p_table and rt.released_at is null
     and r.status = 'seated' and s.closed_at is null and s.dining_table_id <> p_table
     and not exists (select 1 from public.table_session o where o.tenant_id = p_tenant and o.dining_table_id = p_table and o.closed_at is null)
   limit 1
$$;
revoke all on function app.table_joined_to(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.open_table(p_table uuid, p_session uuid, p_covers integer) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  t public.dining_table;
  x public.table_session;
  v_open uuid;
  v_opened timestamptz;
  v_amount numeric;
  v_vat numeric;
  v_con text;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  if p_session is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_covers is null or p_covers < 1 or p_covers > 99 then
    raise exception 'covers_invalid' using errcode = 'P0001';
  end if;

  select d.* into t from public.dining_table d
   where d.tenant_id = v_tenant and d.id = p_table
     for update;
  if not found then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;

  -- The client's id: a replay, a collision with another table or tenant, or a closed session.
  select s.* into x from public.table_session s where s.id = p_session;
  if found then
    if x.tenant_id <> v_tenant or x.dining_table_id <> t.id then
      raise exception 'session_id_conflict' using errcode = 'P0001';
    end if;
    if x.closed_at is not null then
      raise exception 'session_closed' using errcode = 'P0001';
    end if;
    return jsonb_build_object('created', false, 'session', app.table_session_json(v_tenant, x.id, false));
  end if;

  if not t.is_active then
    raise exception 'table_inactive' using errcode = 'P0001';
  end if;
  select s.id into v_open from public.table_session s
   where s.tenant_id = v_tenant and s.dining_table_id = t.id and s.closed_at is null;
  if found then
    raise exception 'table_already_open' using errcode = 'P0001',
      detail = jsonb_build_object('sessionId', v_open)::text;
  end if;
  -- A table of a seated combined booking belongs to the party at the lead table until that session closes (reservations A7b).
  if app.table_joined_to(v_tenant, t.id) is not null then
    raise exception 'table_joined' using errcode = 'P0001';
  end if;

  v_opened := clock_timestamp();
  select c.amount, c.vat_rate into v_amount, v_vat from app.coperto_settings(v_tenant) c;
  begin
    insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by,
                                      business_date, coperto_amount, coperto_vat_rate, created_by, updated_by)
      values (p_session, v_tenant, t.id, t.name, p_covers, v_opened, v_user,
              app.business_date(v_tenant, v_opened), v_amount, v_vat, v_user, v_user);
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'table_session_open_uq' then
      select s.id into v_open from public.table_session s
       where s.tenant_id = v_tenant and s.dining_table_id = t.id and s.closed_at is null;
      raise exception 'table_already_open' using errcode = 'P0001',
        detail = jsonb_build_object('sessionId', v_open)::text;
    end if;
    raise exception 'session_id_conflict' using errcode = 'P0001';
  end;
  return jsonb_build_object('created', true, 'session', app.table_session_json(v_tenant, p_session, false));
end
$$;

create or replace function public.tables_list() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_today date;
begin
  perform app.require_service_reader();
  v_tenant := app.tenant_id();
  v_today := app.business_date(v_tenant, clock_timestamp());
  return jsonb_build_object(
    'businessDate', v_today,
    'tables', coalesce((
      with shown as (
        select distinct on (s.dining_table_id) s.*
          from public.table_session s
         where s.tenant_id = v_tenant and (s.closed_at is null or s.business_date = v_today)
         order by s.dining_table_id, (s.closed_at is null) desc, s.opened_at desc, s.id desc
      ), st as (
        select * from app.session_statuses(v_tenant, array(select h.id from shown h))
      )
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'position', t.position,
               'status', case when jt.lead_id is not null and (h.id is null or h.closed_at is not null) then 'joined'
                              when h.id is null then 'free' else st.status end,
               'session', case when h.id is null or (jt.lead_id is not null and h.closed_at is not null) then null else jsonb_build_object(
                   'id', h.id,
                   'covers', h.covers,
                   'openedAt', h.opened_at,
                   'openedToday', h.business_date = v_today,
                   'waiter', jsonb_build_object('id', u.id, 'displayName', u.display_name),
                   'billRequested', h.bill_requested_at is not null,
                   'coperto', case when h.coperto_amount is null then null
                                   else jsonb_build_object('perPerson', trim_scale(h.coperto_amount),
                                                           'vatRate', trim_scale(h.coperto_vat_rate),
                                                           'total', trim_scale(h.coperto_total)) end) end)
               || case when jt.lead_id is not null and (h.id is null or h.closed_at is not null)
                       then jsonb_build_object('joinedTo', jsonb_build_object('id', jt.lead_id, 'name', jt.lead_name)) else '{}'::jsonb end
               order by t.position, t.name collate "C", t.id)
        from public.dining_table t
        left join shown h on h.dining_table_id = t.id
        left join st on st.table_session_id = h.id
        left join public.app_user u on u.tenant_id = h.tenant_id and u.id = h.opened_by
        left join lateral (select j.lead_id, d.name as lead_name
                             from (select app.table_joined_to(v_tenant, t.id) as lead_id) j
                             left join public.dining_table d on d.tenant_id = v_tenant and d.id = j.lead_id) jt on true
       where t.tenant_id = v_tenant and t.is_active
    ), '[]'::jsonb));
end
$$;

-- Split: the booking keeps its lead table; the others go back to Sala.
create function app.split_reservation_tables_at(p_tenant uuid, p_user uuid, p_role text, p_id uuid, p_tables uuid[], p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
  v_lead uuid;
  v_ids uuid[];
begin
  r := app.reservation_lock(p_tenant, p_id);
  if r.status <> 'seated' then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  select s.dining_table_id into v_lead from public.table_session s where s.tenant_id = p_tenant and s.id = r.table_session_id;
  if p_tables is not null then
    if v_lead = any (p_tables) then
      raise exception 'lead_table' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(p_tables) x
                where not exists (select 1 from public.reservation_table rt where rt.tenant_id = p_tenant and rt.reservation_id = r.id and rt.dining_table_id = x)) then
      raise exception 'table_not_assigned' using errcode = 'P0001';
    end if;
  end if;
  perform app.reservation_tables_lock(p_tenant, r.business_date);
  v_ids := array(
    select rt.dining_table_id from public.reservation_table rt
     where rt.tenant_id = p_tenant and rt.reservation_id = r.id and rt.released_at is null and rt.dining_table_id is distinct from v_lead
       and (p_tables is null or rt.dining_table_id = any (p_tables))
     order by rt.dining_table_id);
  if cardinality(v_ids) > 0 then
    update public.reservation_table set released_at = p_now, released_by = p_user
     where tenant_id = p_tenant and reservation_id = r.id and released_at is null and dining_table_id = any (v_ids);
    update public.reservation set updated_at = p_now where tenant_id = p_tenant and id = r.id;
    perform app.reservation_event(p_tenant, r.id, 'tables_split', jsonb_build_object('tableIds', to_jsonb(v_ids)), p_user, p_now);
  end if;
  return app.reservation_detail_json(p_tenant, r.id, p_role, p_now) || jsonb_build_object('changed', cardinality(v_ids) > 0);
end
$$;

create function public.split_reservation_tables(p_reservation uuid, p_tables uuid[] default null) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_table_operator();
  return app.split_reservation_tables_at(app.tenant_id(), app.app_user_id(), app.role()::text, p_reservation, p_tables, clock_timestamp());
end
$$;

revoke all on function app.split_reservation_tables_at(uuid, uuid, text, uuid, uuid[], timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.split_reservation_tables(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.split_reservation_tables(uuid, uuid[]) to authenticated;
-- create or replace keeps the owner and the grants of open_table and tables_list (authenticated only); restated here so the file shows them.
revoke all on function public.open_table(uuid, uuid, integer), public.tables_list() from public, anon, service_role;
grant execute on function public.open_table(uuid, uuid, integer), public.tables_list() to authenticated;
