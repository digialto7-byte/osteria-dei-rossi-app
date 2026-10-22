-- M5 step 7: reject_invoice, and the audit trail of the duplicate override (M5 plan §3.1.12, §3.3).
-- reject_invoice follows the same four rules as approve_invoice: role checked first
-- (app.require_invoice_approver: owner, admin), empty search_path, the invoice is looked up with
-- app.tenant_id(), execute for authenticated only.

-- Rejection is final: the guard allows nothing out of rejected, and a rejected invoice leaves the
-- duplicate check, so the same document can be uploaded again. Allowed from review and duplicate.
-- p_reason is optional, trimmed, at most 200 characters (a blank one is stored as null). It is
-- free text typed by the owner: it goes to audit_event only and is never logged.
create function public.reject_invoice(p_invoice uuid, p_reason text default null) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform app.require_invoice_approver();

  if length(v_reason) > 200 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status = 'approved' then
    raise exception 'invoice_already_approved' using errcode = 'P0001';
  elsif v.status = 'rejected' then
    raise exception 'invoice_rejected' using errcode = 'P0001';
  elsif v.status not in ('review', 'duplicate') then
    raise exception 'invoice_not_in_review' using errcode = 'P0001';
  end if;

  update public.invoice set status = 'rejected' where id = v.id;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, reason,
      created_by)
    values (v.tenant_id, 'invoice', v.id, 'invoice.rejected',
            jsonb_build_object('status', v.status), jsonb_build_object('status', 'rejected'),
            v_reason, app.app_user_id());
end
$$;

-- "Non è un doppione" (M4), unchanged except that the decision now leaves an audit row: who, when,
-- and what the invoice pointed at before (M5 replaces the "recorded on the invoice" stopgap).
create or replace function public.review_clear_duplicate(p_invoice uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
begin
  perform app.require_invoice_reviewer();
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status = 'duplicate' then
    update public.invoice
       set status = 'review', duplicate_of = null, duplicate_override = true,
           duplicate_override_by = app.app_user_id(), duplicate_override_at = now()
     where id = p_invoice;
  elsif v.status = 'review' and v.duplicate_warning_of is not null then
    update public.invoice
       set duplicate_warning_of = null, duplicate_override = true,
           duplicate_override_by = app.app_user_id(), duplicate_override_at = now()
     where id = p_invoice;
  else
    raise exception 'not_flagged' using errcode = 'P0001';
  end if;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v.tenant_id, 'invoice', v.id, 'invoice.duplicate_cleared',
            jsonb_build_object('status', v.status, 'duplicate_of', v.duplicate_of,
              'duplicate_warning_of', v.duplicate_warning_of),
            jsonb_build_object('status', 'review', 'duplicate_override', true),
            app.app_user_id());
end
$$;

revoke all on function public.reject_invoice(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reject_invoice(uuid, text) to authenticated;
