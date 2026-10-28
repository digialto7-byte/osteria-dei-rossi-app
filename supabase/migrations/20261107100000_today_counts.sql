-- UX plan B1 (docs/plans/2026-10-28-ux-flows.md, P1-1; ADR-020): the counts behind GET /api/today.
--
-- public.today_counts() is SECURITY INVOKER with an empty search_path, so row level security applies to the caller; the
-- tenant comes from app.tenant_id() and is filtered explicitly as well. Owner and admin get invoices, payables,
-- batches, the open count and the set-up steps; the chef gets batches and the open count only (RLS would show the chef
-- zero invoices and payables, which is not the same as "none", so those keys are left out); the waiter is refused.
-- Counts only: no money, no names, no ids.
--
-- Two predicates are shared with the lists so the counts cannot drift from what the screens show:
-- - app.payable_is_overdue is the 'overdue' flag of payable_item (payable_list, payable_detail, supplier_statement);
--   payable_item is redefined below to call it, with the same output as before;
-- - app.use_by_is_pending answers "is useByState expired or due_soon" by calling app.use_by_state, the function
--   batch_list uses. app.use_by_state and app.venue_date stay closed to the API roles (pgTAP 033, 121, 127 pin that), so
--   the wrapper is SECURITY DEFINER: a pure function of its two arguments that reads no table, so running it as its
--   owner exposes nothing. today_counts itself is INVOKER.

create function app.payable_is_overdue(p_status public.payable_status, p_due_date date, p_today date) returns boolean
  language sql immutable
  set search_path = ''
as $$
  select p_status <> 'paid' and p_due_date < p_today
$$;

create or replace function app.payable_item(
  p_payable public.payable, p_invoice_number text, p_invoice_date date, p_supplier_name text,
  p_today date
) returns jsonb
  language sql immutable
  set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_payable.id,
    'invoiceId', p_payable.invoice_id,
    'invoiceNumber', p_invoice_number,
    'invoiceDate', p_invoice_date,
    'supplierId', p_payable.supplier_id,
    'supplierName', p_supplier_name,
    'amount', p_payable.amount,
    'dueDate', p_payable.due_date,
    'status', p_payable.status,
    'paidOn', p_payable.paid_on,
    'daysToDue', p_payable.due_date - p_today,
    'overdue', app.payable_is_overdue(p_payable.status, p_payable.due_date, p_today))
$$;

create function app.use_by_is_pending(p_use_by timestamptz, p_now timestamptz) returns boolean
  language sql immutable
  security definer
  set search_path = ''
as $$
  select app.use_by_state(p_use_by, p_now) in ('expired', 'due_soon')
$$;

revoke all on function app.payable_is_overdue(public.payable_status, date, date),
  app.use_by_is_pending(timestamptz, timestamptz) from public, anon, service_role;
grant execute on function app.payable_is_overdue(public.payable_status, date, date),
  app.use_by_is_pending(timestamptz, timestamptz) to authenticated;

create function public.today_counts() returns jsonb
  language plpgsql stable
  security invoker
  set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_role text := coalesce((select app.role())::text, '');
  v_now timestamptz := now();
  v_today date;
  v_out jsonb;
begin
  if v_tenant is null or v_role not in ('owner', 'admin', 'chef') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  v_out := jsonb_build_object(
    'batchesUseBy', (
      select count(*)::int
        from public.batch b
        left join public.v_batch_portions p on p.tenant_id = b.tenant_id and p.batch_id = b.id
       where b.tenant_id = v_tenant
         and app.use_by_is_pending(b.use_by, v_now)
         and coalesce(p.portions_remaining, 0) > 0),
    'countOpen', exists (
      select 1 from public.count_session c where c.tenant_id = v_tenant and c.status = 'open'));

  if v_role = 'chef' then
    return v_out;
  end if;

  -- The venue's calendar day, as app.venue_date computes it (that helper is closed to the API roles).
  select (v_now at time zone t.timezone)::date into v_today from public.tenant t where t.id = v_tenant;

  return v_out || jsonb_build_object(
    'invoicesToReview', (
      select count(*)::int from public.invoice i
       where i.tenant_id = v_tenant and i.status in ('review', 'duplicate', 'extraction_failed')),
    'payablesOverdue', (
      select count(*)::int from public.payable p
       where p.tenant_id = v_tenant and app.payable_is_overdue(p.status, p.due_date, v_today)),
    'payablesUnpaid', (
      select count(*)::int from public.payable p where p.tenant_id = v_tenant and p.status <> 'paid'),
    'setup', jsonb_build_object(
      'hasLocations', exists (select 1 from public.location x where x.tenant_id = v_tenant and x.is_active),
      'hasSuppliers', exists (select 1 from public.supplier x where x.tenant_id = v_tenant and x.is_active),
      'hasIngredients', exists (select 1 from public.ingredient x where x.tenant_id = v_tenant and x.is_active),
      'hasApprovedInvoice', exists (
        select 1 from public.invoice x where x.tenant_id = v_tenant and x.status = 'approved'),
      -- Staff means a chef or a waiter: the owner (and the admin) exist from day one.
      'hasStaff', exists (
        select 1 from public.app_user x
         where x.tenant_id = v_tenant and x.is_active and x.role in ('chef', 'waiter')),
      'hasDevice', exists (
        select 1 from public.venue_device x where x.tenant_id = v_tenant and x.revoked_at is null),
      'hasTables', exists (select 1 from public.dining_table x where x.tenant_id = v_tenant and x.is_active),
      'hasMenuItems', exists (select 1 from public.menu_item x where x.tenant_id = v_tenant and x.is_active)));
end
$$;

revoke all on function public.today_counts() from public, anon, service_role;
grant execute on function public.today_counts() to authenticated;
