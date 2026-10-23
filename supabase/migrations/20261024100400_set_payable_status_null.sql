-- M9 review fix: set_payable_status refuses a null status with invalid_request (P0001, API 400).
-- Before, a null status passed every check (each comparison with null is not true) and failed at the
-- UPDATE with 23502, which the API reports as a 500.
--
-- 20261024100000 and 20261024100100 are committed, so they are not edited: this migration replaces the
-- function with `create or replace` (same signature, so the grants of 20261024100000 stay) and is
-- the body of 20261024100100 (audit rows stamped with clock_timestamp()) plus the one check below.
-- The role check is still the first statement; search_path, security definer and the grants are unchanged.

create or replace function public.set_payable_status(
  p_payable uuid,
  p_status public.payable_status,
  p_paid_on date default null,
  p_reason text default null,
  p_reversal boolean default false
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_reason text;
  v_p public.payable%rowtype;
  v_tz text;
  v_action text;
  v_new_paid_on date;
begin
  perform app.require_payables_writer();

  -- A null status is a bad request (400), not a NOT NULL violation of payable.status (23502, 500).
  -- After the role check, so a role that may not write still gets 42501 first.
  if p_status is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  if p_reason is not null and length(btrim(p_reason)) > 200 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  v_reason := nullif(btrim(p_reason), '');
  if p_reason is not null and v_reason is null and not coalesce(p_reversal, false) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  select p.* into v_p
    from public.payable p
   where p.id = p_payable and p.tenant_id = v_tenant
     for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;

  -- Paid date rules (plan §3.1.2): required for paid, refused otherwise, never in the future.
  if p_status = 'paid' and p_paid_on is null then
    raise exception 'paid_on_required' using errcode = 'P0001';
  end if;
  if p_status <> 'paid' and p_paid_on is not null then
    raise exception 'paid_on_not_allowed' using errcode = 'P0001';
  end if;
  if p_paid_on > app.venue_date(now(), v_tz) then
    raise exception 'paid_on_future' using errcode = 'P0001';
  end if;

  if coalesce(p_reversal, false) then
    if v_p.status <> 'paid' then
      raise exception 'payable_not_paid' using errcode = 'P0001';
    end if;
    if p_status <> 'open' then
      raise exception 'reversal_target_invalid' using errcode = 'P0001';
    end if;
    if v_reason is null then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;
    v_action := 'payable.payment_reversed';
  else
    if p_status = v_p.status and p_paid_on is not distinct from v_p.paid_on then
      return jsonb_build_object('payableId', v_p.id, 'status', v_p.status,
                                'paidOn', v_p.paid_on, 'changed', false);
    end if;
    if v_p.status = 'paid' then
      raise exception 'payable_paid_locked' using errcode = 'P0001';
    end if;
    if not (p_status = any (app.payable_allowed_targets(v_p.status))) then
      raise exception 'payable_transition_invalid' using errcode = 'P0001';
    end if;
    v_action := 'payable.status_changed';
  end if;

  v_new_paid_on := case when p_status = 'paid' then p_paid_on end;

  perform set_config('app.payable_transition', 'on', true);
  update public.payable
     set status = p_status,
         paid_on = v_new_paid_on,
         paid_at = case when p_status = 'paid' then clock_timestamp() end
   where id = v_p.id;
  perform set_config('app.payable_transition', '', true);

  -- clock_timestamp(), not the transaction's now(): the history of a payable is ordered by this
  -- column, and a transaction that started earlier can take the row lock later.
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, reason,
                                  created_at, created_by)
  values (v_tenant, 'payable', v_p.id, v_action,
          jsonb_build_object('status', v_p.status, 'paid_on', v_p.paid_on),
          jsonb_build_object('status', p_status, 'paid_on', v_new_paid_on),
          v_reason, clock_timestamp(), app.app_user_id());

  return jsonb_build_object('payableId', v_p.id, 'status', p_status, 'paidOn', v_new_paid_on,
                            'changed', true);
end
$$;

-- create or replace keeps the owner and the ACL; restated so the intent is visible and a fresh clone
-- ends in the same state whatever the earlier file did.
revoke all on function public.set_payable_status(uuid, public.payable_status, date, text, boolean)
  from public, anon, service_role;
grant execute on function public.set_payable_status(uuid, public.payable_status, date, text, boolean)
  to authenticated;
