-- M15 step 3: adjust_batch and discard_batch (M15 plan §3.1.2, §3.1.3, §3.1.5, §3.1.11, §3.1.12, §3.2; ADR-014).
-- Each is SECURITY DEFINER with an empty search_path, checks the role FIRST (owner, admin or chef; the waiter never),
-- takes the tenant from app.tenant_id() and the user from app.app_user_id(), filters every query by the tenant, and is
-- executable by `authenticated` only. They take one batch row lock, read the remaining portions in a new statement
-- AFTER the lock (a second caller waits, then sees what the first committed: plan T2), write one movement and settle
-- the batch state in the same transaction. No answer carries a value: the € of a discard is computed at read time by
-- the owner/admin report (waste_costs, step 7) from the frozen batch cost (founder Q16 = project V6).

-- Adjust = one `count` movement of the difference between what was counted and what the ledger expects. Counting the
-- expected figure writes nothing. Allowed in any state: a count above 0 reopens a finished or discarded batch.
create function public.adjust_batch(p_batch uuid, p_counted numeric) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_tz text;
  v_expected numeric;
  v_delta numeric;
  v_move uuid;
  v_state public.batch_state;
  v_remaining numeric;
begin
  perform app.require_batch_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  if p_counted is null or p_counted < 0 or p_counted > 10000 or round(p_counted, 4) <> p_counted then
    raise exception 'count_invalid' using errcode = 'P0001';
  end if;
  if p_batch is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;

  perform app.lock_batch_rows(v_tenant, array[p_batch]);
  v_expected := app.batch_remaining(v_tenant, p_batch);
  v_delta := p_counted - v_expected;

  if v_delta <> 0 then
    select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
    insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on,
                                       created_by)
      values (v_tenant, p_batch, 'count', v_delta, null, 'batch_adjust', gen_random_uuid(),
              app.venue_date(now(), v_tz), v_user)
      returning id into v_move;
    v_state := app.batch_settle_state(v_tenant, p_batch, 'adjust');
  else
    select b.state into v_state from public.batch b where b.tenant_id = v_tenant and b.id = p_batch;
  end if;
  v_remaining := app.batch_remaining(v_tenant, p_batch);

  return jsonb_build_object('batchId', p_batch, 'movementId', v_move, 'delta', v_delta,
                            'portionsRemaining', v_remaining, 'state', v_state);
end
$$;

-- Discard = one `waste` movement of -portions with a reason. 0 < portions <= remaining (4 decimals at most).
create function public.discard_batch(p_batch uuid, p_portions numeric, p_reason text) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_tz text;
  v_remaining numeric;
  v_move uuid;
  v_state public.batch_state;
begin
  perform app.require_batch_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  if p_portions is null or p_portions <= 0 or p_portions > 10000 or round(p_portions, 4) <> p_portions then
    raise exception 'portions_invalid' using errcode = 'P0001';
  end if;
  if p_reason is null or not (p_reason = any (app.batch_waste_reason_codes())) then
    raise exception 'reason_invalid' using errcode = 'P0001';
  end if;
  if p_batch is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;

  perform app.lock_batch_rows(v_tenant, array[p_batch]);
  v_remaining := app.batch_remaining(v_tenant, p_batch);
  if p_portions > v_remaining then
    raise exception 'portions_insufficient' using errcode = 'P0001';
  end if;

  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on,
                                     created_by)
    values (v_tenant, p_batch, 'waste', -p_portions, p_reason, 'batch_discard', gen_random_uuid(),
            app.venue_date(now(), v_tz), v_user)
    returning id into v_move;
  v_state := app.batch_settle_state(v_tenant, p_batch, 'discard');

  return jsonb_build_object('batchId', p_batch, 'movementId', v_move, 'portions', p_portions, 'reasonCode', p_reason,
                            'portionsRemaining', app.batch_remaining(v_tenant, p_batch), 'state', v_state);
end
$$;

revoke all on function public.adjust_batch(uuid, numeric), public.discard_batch(uuid, numeric, text)
  from public, anon, authenticated, service_role;
grant execute on function public.adjust_batch(uuid, numeric), public.discard_batch(uuid, numeric, text)
  to authenticated;
