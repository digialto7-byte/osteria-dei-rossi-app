-- M9 step 1: payable status (M9 plan §3.1 and §3.2; ADR-009). The owner's paid date, a guard that
-- lets status and paid date change only inside public.set_payable_status, the transition matrix,
-- and the procedure itself. Every change writes one audit_event row in the same transaction.

-- The paid date is a calendar date entered by the owner. paid_at stays: when the payment was
-- recorded. Existing rows are all 'open', so the check holds.
alter table public.payable add column paid_on date;
alter table public.payable
  add constraint payable_paid_on_ck check ((status = 'paid') = (paid_on is not null));

-- M5's guard, tightened: due_date is immutable (no M9 path changes it), and status, paid_on and
-- paid_at change only while public.set_payable_status holds the transaction-local flag, for every
-- role, the migration owner included.
create or replace function app.payable_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.invoice_id is distinct from old.invoice_id
     or new.supplier_id is distinct from old.supplier_id
     or new.gross_amount is distinct from old.gross_amount
     or new.credited_amount is distinct from old.credited_amount
     or new.amount is distinct from old.amount
     or new.due_date is distinct from old.due_date
     or new.due_date_source is distinct from old.due_date_source
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'payable_immutable' using errcode = 'P0001';
  end if;
  if (new.status is distinct from old.status
      or new.paid_on is distinct from old.paid_on
      or new.paid_at is distinct from old.paid_at)
     and coalesce(current_setting('app.payable_transition', true), '') <> 'on' then
    raise exception 'payable_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- The audit lists widen (one migration each, see 20261022140000_audit_event.sql). M8's value
-- 'tenant.settings_changed' (and entity 'tenant') is kept on purpose: this runs correctly both
-- before and after M8 is merged.
alter table public.audit_event
  drop constraint audit_event_entity_type_check,
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_entity_type_check
    check (entity_type in ('invoice', 'ingredient', 'recipe', 'tenant', 'payable')),
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed',
                      'payable.payment_reversed'));

-- Payables are money: owner and admin read and write; chef, waiter and no claims get 42501.
create function app.require_payables_writer() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if coalesce((select app.role())::text, '') not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
end
$$;
create function app.require_payables_reader() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if coalesce((select app.role())::text, '') not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
end
$$;

-- The ordinary transitions (plan §3.1.3). Leaving 'paid' is a reversal with a reason, not here.
create function app.payable_allowed_targets(p_status public.payable_status)
  returns public.payable_status[]
  language sql immutable
  set search_path = ''
as $$
  select case p_status
    when 'open' then array['scheduled', 'paid', 'disputed']::public.payable_status[]
    when 'scheduled' then array['open', 'paid', 'disputed']::public.payable_status[]
    when 'disputed' then array['open', 'scheduled', 'paid']::public.payable_status[]
    else array[]::public.payable_status[]
  end
$$;

revoke all on function app.require_payables_writer(), app.require_payables_reader(),
  app.payable_allowed_targets(public.payable_status)
  from public, anon, authenticated, service_role;

-- The one way a payable's status changes. Single transaction: row lock, validation, update, audit.
create function public.set_payable_status(
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

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, reason,
                                  created_by)
  values (v_tenant, 'payable', v_p.id, v_action,
          jsonb_build_object('status', v_p.status, 'paid_on', v_p.paid_on),
          jsonb_build_object('status', p_status, 'paid_on', v_new_paid_on),
          v_reason, app.app_user_id());

  return jsonb_build_object('payableId', v_p.id, 'status', p_status, 'paidOn', v_new_paid_on,
                            'changed', true);
end
$$;
revoke all on function public.set_payable_status(uuid, public.payable_status, date, text, boolean)
  from public, anon, service_role;
grant execute on function public.set_payable_status(uuid, public.payable_status, date, text, boolean)
  to authenticated;
