-- M25c step 4 (docs/plans/2026-11-01-m25c-services.md §3.1.4, §3.2, §3.3; ADR-031): moving a table to another service.
--
--   app.set_session_service_at   the writer, with a "now" the tests fix (null = clock_timestamp() after the lock). Order: shape (22023) -> the session row FOR SHARE (P0002
--                                session_not_found, also for another tenant's id) -> finality (P0001 service_day_final) -> the key is one of the version in force at the opening
--                                (P0001 service_unknown) -> compare with the current state -> insert an override row or nothing.
--   public.set_session_service   thin wrapper: app.require_day_closer() first (owner, admin; 42501 for anyone else, before the session is looked up).
-- An override is an appended row (service_key null = back to automatic); the latest by (created_at, seq) wins. Moves are allowed while the session is open, or closed and
-- not final: the day is final at its cut-off end + app.kpi_finalise_grace() (the instant daily_kpi freezes). The session row is locked FOR SHARE like the line writers, so a
-- move waits for a running close (FOR UPDATE) and then sees closed_at. Nothing else is locked: there is no lock cycle. created_by is stored and never returned.

create function app.set_session_service_at(p_tenant uuid, p_user uuid, p_session uuid, p_body jsonb, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_closed_at timestamptz;
  v_cbd date;
  v_found boolean;
  v_now timestamptz;
  v_key text;
  v_cur record;
  v_changed boolean;
  v_effective text;
  v_source text;
begin
  perform app.menu_keys_ok(p_body, array['serviceKey'], array['serviceKey']);
  if jsonb_typeof(p_body -> 'serviceKey') not in ('string', 'null') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_key := p_body ->> 'serviceKey';

  select s.closed_at, s.closed_business_date into v_closed_at, v_cbd
    from public.table_session s
   where s.tenant_id = p_tenant and s.id = p_session
     for share;
  v_found := found;
  if not v_found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  v_now := coalesce(p_now, clock_timestamp());
  if v_closed_at is not null and v_now >= app.kpi_cutoff_end(p_tenant, v_cbd) + app.kpi_finalise_grace() then
    raise exception 'service_day_final' using errcode = 'P0001';
  end if;

  select c.auto_key, c.service_key, c.overridden, c.choices into v_cur from app.session_service_one(p_tenant, p_session) c;
  if v_key is not null and v_key <> all (v_cur.choices) then
    raise exception 'service_unknown' using errcode = 'P0001';
  end if;

  if v_key is null then
    v_changed := v_cur.overridden;
  else
    v_changed := v_key is distinct from v_cur.service_key;
  end if;
  if v_changed then
    insert into public.service_override (tenant_id, table_session_id, service_key, created_at, created_by)
      values (p_tenant, p_session, v_key, v_now, p_user);
    v_effective := coalesce(v_key, v_cur.auto_key);
    v_source := case when v_key is null then 'auto' else 'override' end;
  else
    v_effective := v_cur.service_key;
    v_source := case when v_cur.overridden then 'override' else 'auto' end;
  end if;
  return jsonb_build_object('changed', v_changed,
                            'session', jsonb_build_object('sessionId', p_session, 'serviceKey', v_effective, 'source', v_source));
end
$$;

create function public.set_session_service(p_session uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.set_session_service_at(app.tenant_id(), app.app_user_id(), p_session, p_body, null);
end
$$;

revoke all on function app.set_session_service_at(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.set_session_service(uuid, jsonb) from public, anon, service_role;
grant execute on function public.set_session_service(uuid, jsonb) to authenticated;
