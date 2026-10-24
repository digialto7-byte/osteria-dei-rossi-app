-- M17 step 6: open_table and update_table_session (M17 plan §3.1.4, §3.1.5, §3.2; ADR-016).
-- Owner, admin and waiter. Security definer, empty search_path, role first, tenant from app.tenant_id(), user from
-- app.app_user_id(). Errors: 42501 (role), 22023 invalid_request (shape), P0002 table_not_found / session_not_found,
-- P0001 for the business codes: covers_invalid, table_inactive, table_already_open (DETAIL = the open session's public
-- shape as JSON), session_id_conflict (no detail), session_closed.
--
-- Concurrency (AT2): open_table locks the dining_table row first (the lock update_dining_table also takes), so two
-- openings of one table are serialised and the second sees the first's committed session; openings of different tables
-- never wait for each other. The partial unique index table_session_open_uq is the backstop.

-- The public shape of a session. p_with_status adds the derived status.
create function app.table_session_json(p_tenant uuid, p_id uuid, p_with_status boolean) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object(
           'id', s.id,
           'tableId', s.dining_table_id,
           'tableName', s.table_name,
           'covers', s.covers,
           'openedAt', s.opened_at,
           'businessDate', s.business_date,
           'waiter', jsonb_build_object('id', u.id, 'displayName', u.display_name),
           'billRequested', s.bill_requested_at is not null,
           'coperto', case when s.coperto_amount is null then null
                           else jsonb_build_object('perPerson', trim_scale(s.coperto_amount),
                                                   'vatRate', trim_scale(s.coperto_vat_rate),
                                                   'total', trim_scale(s.coperto_total)) end)
         || case when p_with_status
                 then jsonb_build_object('status',
                        (select st.status from app.session_statuses(p_tenant, array[s.id]) st))
                 else '{}'::jsonb end
    from public.table_session s
    join public.app_user u on u.tenant_id = s.tenant_id and u.id = s.opened_by
   where s.tenant_id = p_tenant and s.id = p_id
$$;
revoke all on function app.table_session_json(uuid, uuid, boolean) from public, anon, authenticated, service_role;

create function public.open_table(p_table uuid, p_session uuid, p_covers integer) returns jsonb
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
      detail = app.table_session_json(v_tenant, v_open, false)::text;
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
        detail = coalesce(app.table_session_json(v_tenant, v_open, false)::text, '{}');
    end if;
    raise exception 'session_id_conflict' using errcode = 'P0001';
  end;
  return jsonb_build_object('created', true, 'session', app.table_session_json(v_tenant, p_session, false));
end
$$;

create function public.update_table_session(p_session uuid, p_patch jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  s public.table_session;
  v_covers integer;
  v_bill boolean;
  v_total numeric;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.menu_keys_ok(p_patch, array['covers', 'billRequested'], null);
  if p_patch ? 'covers' then
    v_covers := app.menu_int(p_patch -> 'covers', 1, 99, 'covers_invalid');
  end if;
  if p_patch ? 'billRequested' then
    v_bill := app.menu_bool(p_patch -> 'billRequested');
  end if;

  select x.* into s from public.table_session x
   where x.tenant_id = v_tenant and x.id = p_session
     for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if s.closed_at is not null then
    raise exception 'session_closed' using errcode = 'P0001';
  end if;

  if v_covers is not null and v_covers <> s.covers then
    update public.table_session set covers = v_covers, updated_at = now(), updated_by = v_user
     where tenant_id = v_tenant and id = s.id
     returning coperto_total into v_total;
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
      values (v_tenant, 'table_session', s.id, 'table_session.covers_changed',
        jsonb_build_object('covers', s.covers, 'coperto_total', trim_scale(s.coperto_total)),
        jsonb_build_object('covers', v_covers, 'coperto_total', trim_scale(v_total)), v_user);
  end if;
  if v_bill is not null and v_bill <> (s.bill_requested_at is not null) then
    -- No audit row: the columns record who and when.
    if v_bill then
      update public.table_session
         set bill_requested_at = clock_timestamp(), bill_requested_by = v_user, updated_at = now(), updated_by = v_user
       where tenant_id = v_tenant and id = s.id;
    else
      update public.table_session
         set bill_requested_at = null, bill_requested_by = null, updated_at = now(), updated_by = v_user
       where tenant_id = v_tenant and id = s.id;
    end if;
  end if;
  return jsonb_build_object('session', app.table_session_json(v_tenant, s.id, true));
end
$$;

revoke all on function public.open_table(uuid, uuid, integer), public.update_table_session(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.open_table(uuid, uuid, integer), public.update_table_session(uuid, jsonb) to authenticated;
