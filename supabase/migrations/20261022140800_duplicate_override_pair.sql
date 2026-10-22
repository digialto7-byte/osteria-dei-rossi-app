-- M5 code-review fix, round 2: a duplicate override releases only the pair it was given for.
--
-- The bug (regression from round 1, f68b768). "Non è un doppione" set a sticky per-invoice flag
-- (duplicate_override). Round 1 made the approval gate skip every match with the flag, and
-- app.recheck_duplicate has always returned early for an invoice with the flag. So the flag was a
-- decision about "this invoice, whatever it later looks like", not about a pair. Reproduced: X in review
-- as FT 30; Z a different document FT 99; Y really a copy of X, misread as FT 99, so a duplicate of Z.
-- The owner clears Y (correct: Y is not Z) and then corrects Y's number to FT 30. The recheck was
-- skipped, X's gate ignored Y (flag) and Y's gate ignored X (flag): both approved, two payables and double
-- receipts for one document. The same happened with a name-match warning that was cleared and a
-- review_set_supplier that then filled in the VAT. And a round trip date edit on an original O whose copy
-- C had been cleared flipped O to a duplicate of C (the recheck of O found C, which the flag did not hide
-- from the extraction finder).
--
-- The fix. invoice.duplicate_override_of records the invoice the flag was given against (duplicate_of,
-- or duplicate_warning_of for a name warning), set by review_clear_duplicate. duplicate_override and
-- its _by/_at stay as the record. One pair-aware finder (per key kind) is used by the approval gate and by
-- app.recheck_duplicate: X matches a live Y with the same key unless X.duplicate_override_of = Y.id or
-- Y.duplicate_override_of = X.id. Nothing else hides a match, so a flag with no partner (rows cleared
-- before this column, with no audit row to recover it from) releases nothing. recheck_duplicate no longer
-- returns early for an overridden invoice, so a re-keyed invoice is checked again; it can flag the
-- invoice against a different one, and a new "Non è un doppione" then replaces the declared partner
-- (one declared partner per invoice; the old pair is no longer declared, but no longer matches either).
--
-- Not changed: extraction_complete (20261022130300) skips its duplicate check when duplicate_override is
-- true. That branch cannot run for a real invoice: the flag is only written by review_clear_duplicate,
-- on a review or duplicate invoice, and app.invoice_guard allows no way back from review or duplicate to
-- extracting, so extraction always sees a fresh invoice with no declared pair (test 039 pins the guard).
-- A fresh extraction keeps the unfiltered finders, as before.
--
-- Lock interaction. The new foreign key makes review_clear_duplicate(Y) take a KEY SHARE lock on the
-- partner X. That procedure locked its own row FOR UPDATE, which conflicts with KEY SHARE, so two
-- owners clearing X and Y at once (two invoices that warn each other) could wait for each other. It
-- now takes FOR NO KEY UPDATE like every other review procedure (it changes no key column), which does
-- not conflict with KEY SHARE (scripts/test-db-races.sh case clear-vs-clear).
--
-- Also (review NOTE): review_set_supplier (latest definition in 20261022130900, not replaced here) must
-- keep calling app.recheck_duplicate BEFORE app.automap_invoice. The procedure holds its invoice row
-- (FOR NO KEY UPDATE) and takes the duplicate advisory lock first inside the recheck; the own-invoice
-- FOR UPDATE that the automap takes afterwards is on a row the procedure already holds, so it cannot
-- close a cycle with an extraction (which holds the advisory lock and then needs KEY SHARE on the row).
-- Swapping the two calls would take the advisory lock after a lock stronger than that.

alter table public.invoice
  add column duplicate_override_of uuid,
  add constraint invoice_duplicate_override_of_fk foreign key (tenant_id, duplicate_override_of)
    references public.invoice (tenant_id, id),
  add constraint invoice_duplicate_override_of_self_ck check (duplicate_override_of <> id);
comment on column public.invoice.duplicate_override_of is
  'The invoice the owner declared this one not a duplicate of (the duplicate_of or duplicate_warning_of it had when review_clear_duplicate ran). The declaration releases that pair only; it is written by review_clear_duplicate alone.';

-- Rows cleared since M5 left an audit row naming the partner; take the latest for each invoice. Rows
-- cleared in M4 (no audit row) keep null and are checked like any other invoice.
update public.invoice i
   set duplicate_override_of = a.partner
  from (select distinct on (e.entity_id) e.entity_id,
               coalesce(e.before ->> 'duplicate_of', e.before ->> 'duplicate_warning_of')::uuid as partner
          from public.audit_event e
         where e.action = 'invoice.duplicate_cleared'
         order by e.entity_id, e.created_at desc, e.id desc) a
 where i.id = a.entity_id and i.duplicate_override and i.duplicate_override_of is null
   and a.partner is not null;

-- The pair-aware finders. p_exclude is the invoice asking (it is never its own match, and its own
-- declaration and the declarations naming it are the exemptions). The extraction finders
-- app.find_duplicate_invoice_in and app.find_name_duplicate_invoice_in are unchanged.
create or replace function app.find_undeclared_duplicate_invoice_in(
  p_tenant uuid,
  p_vat text,
  p_number text,
  p_date date,
  p_exclude uuid default null
) returns uuid
  language sql stable
  set search_path = ''
as $$
  select i.id
    from public.invoice i
   where p_vat is not null and p_number is not null and p_date is not null
     and i.tenant_id = p_tenant
     and i.supplier_vat = upper(regexp_replace(p_vat, '\s', '', 'g'))
     and i.number = app.normalise_invoice_number(p_number)
     and i.invoice_date = p_date
     and i.status not in ('duplicate', 'rejected')
     and i.id is distinct from p_exclude
     and not coalesce(i.duplicate_override_of = p_exclude, false)
     and not exists (select 1 from public.invoice x
                      where x.id = p_exclude and x.duplicate_override_of = i.id)
   order by i.created_at, i.id
   limit 1
$$;
revoke all on function app.find_undeclared_duplicate_invoice_in(uuid, text, text, date, uuid)
  from public, anon, authenticated;

create function app.find_undeclared_name_duplicate_invoice_in(
  p_tenant uuid,
  p_supplier_name text,
  p_number text,
  p_date date,
  p_exclude uuid default null
) returns uuid
  language sql stable
  set search_path = ''
as $$
  select i.id
    from public.invoice i
   where p_supplier_name is not null and p_number is not null and p_date is not null
     and i.tenant_id = p_tenant
     and i.supplier_vat is null
     and app.normalise_name(i.supplier_name) = app.normalise_name(p_supplier_name)
     and i.number = app.normalise_invoice_number(p_number)
     and i.invoice_date = p_date
     and i.status not in ('duplicate', 'rejected')
     and i.id is distinct from p_exclude
     and not coalesce(i.duplicate_override_of = p_exclude, false)
     and not exists (select 1 from public.invoice x
                      where x.id = p_exclude and x.duplicate_override_of = i.id)
   order by i.created_at, i.id
   limit 1
$$;
revoke all on function app.find_undeclared_name_duplicate_invoice_in(uuid, text, text, date, uuid)
  from public, anon, authenticated;

-- The duplicate decision for an invoice in review whose supplier or header changed (20261022130200's
-- version): the same VAT, number and date as another live invoice moves it to duplicate; with no VAT, a
-- normalised-name match sets or clears the warning. A declared pair is skipped (in either direction),
-- but the invoice is checked whether or not it was ever cleared. The caller holds the invoice lock; the
-- advisory lock serialises two invoices of one key.
create or replace function app.recheck_duplicate(p_invoice uuid) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  v_lock bigint;
  v_dup uuid;
  v_warn uuid;
begin
  select * into v from public.invoice i where i.id = p_invoice;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status <> 'review' then
    return;
  end if;
  v_lock := app.invoice_dup_lock_key(
    v.tenant_id, v.supplier_vat, v.supplier_name, v.number_raw, v.invoice_date);
  if v_lock is not null then
    perform pg_advisory_xact_lock(v_lock);
    if v.supplier_vat is not null then
      v_dup := app.find_undeclared_duplicate_invoice_in(
        v.tenant_id, v.supplier_vat, v.number_raw, v.invoice_date, p_invoice);
    else
      v_warn := app.find_undeclared_name_duplicate_invoice_in(
        v.tenant_id, v.supplier_name, v.number_raw, v.invoice_date, p_invoice);
    end if;
  end if;
  update public.invoice i
     set status = case when v_dup is not null then 'duplicate'::public.invoice_status else i.status end,
         duplicate_of = v_dup,
         duplicate_warning_of = v_warn
   where i.id = p_invoice;
end
$$;
revoke all on function app.recheck_duplicate(uuid) from public, anon, authenticated;

-- Every reason the invoice cannot be approved now, as [{code, lineIds}] in the order of the gates of plan §3.1.4 (approve_invoice raises the first, the preview lists all). Takes no locks and
-- trusts no stored flag: totals and duplicates are computed now. A status other than review has
-- only its status blocker. Raises P0002 for an unknown invoice.
create or replace function app.approval_blockers(p_invoice uuid, p_location uuid) returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  v public.invoice;
  v_tz text;
  v_out jsonb := '[]'::jsonb;
  v_ids jsonb;
  v_credited numeric;
  v_due date;
  g record;
begin
  select * into v from public.invoice i where i.id = p_invoice;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v.status <> 'review' then
    return jsonb_build_array(jsonb_build_object('lineIds', '[]'::jsonb, 'code', case v.status
      when 'approved' then 'invoice_already_approved'
      when 'rejected' then 'invoice_rejected'
      when 'duplicate' then 'duplicate_invoice'
      else 'invoice_not_in_review' end));
  end if;

  -- Pair-aware: a live look-alike blocks unless the owner declared exactly this pair (either way).
  if app.find_undeclared_duplicate_invoice_in(
       v.tenant_id, v.supplier_vat, v.number_raw, v.invoice_date, v.id) is not null then
    v_out := v_out || jsonb_build_object('code', 'duplicate_invoice', 'lineIds', '[]'::jsonb);
  end if;
  if v.duplicate_warning_of is not null
     and v.duplicate_warning_of is distinct from v.duplicate_override_of
     and not exists (select 1 from public.invoice w
                      where w.id = v.duplicate_warning_of and w.duplicate_override_of = v.id) then
    v_out := v_out || jsonb_build_object('code', 'duplicate_warning', 'lineIds', '[]'::jsonb);
  end if;

  select * into g from app.totals_gate(p_invoice);
  if g.flagged then
    v_out := v_out || jsonb_build_object('code', 'total_mismatch', 'lineIds', '[]'::jsonb);
  end if;

  if v.supplier_id is null then
    v_out := v_out || jsonb_build_object('code', 'supplier_required', 'lineIds', '[]'::jsonb);
  end if;

  select t.timezone into v_tz from public.tenant t where t.id = v.tenant_id;
  if v.invoice_date is null then
    v_out := v_out || jsonb_build_object('code', 'invoice_date_required', 'lineIds', '[]'::jsonb);
  elsif v.invoice_date > app.venue_date(now(), v_tz) then
    v_out := v_out || jsonb_build_object('code', 'invoice_date_in_future', 'lineIds', '[]'::jsonb);
  end if;

  select d.due_date into v_due from app.resolve_due_date(p_invoice) d;
  if v_due is null then
    v_out := v_out || jsonb_build_object('code', 'due_date_required', 'lineIds', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(a.line_id order by a.position, a.sub_position), '[]'::jsonb) into v_ids
    from app.approval_lines(p_invoice) a
   where a.is_stock and a.ingredient_id is null;
  if v_ids <> '[]'::jsonb then
    v_out := v_out || jsonb_build_object('code', 'lines_unmapped', 'lineIds', v_ids);
  end if;

  select coalesce(jsonb_agg(a.line_id order by a.position, a.sub_position), '[]'::jsonb) into v_ids
    from app.approval_lines(p_invoice) a
   where a.is_stock and a.ingredient_id is not null and a.base_factor is null
     and a.qty - a.credit_qty > 0;
  if v_ids <> '[]'::jsonb then
    v_out := v_out || jsonb_build_object('code', 'line_base_qty_unavailable', 'lineIds', v_ids);
  end if;

  select coalesce(jsonb_agg(a.line_id order by a.position, a.sub_position), '[]'::jsonb) into v_ids
    from app.approval_lines(p_invoice) a
   where a.credit_qty > 0 and a.credited_amount is null;
  if v_ids <> '[]'::jsonb then
    v_out := v_out || jsonb_build_object('code', 'credit_vat_rate_missing', 'lineIds', v_ids);
  end if;

  select coalesce(sum(a.credited_amount), 0) into v_credited from app.approval_lines(p_invoice) a;
  if v_credited > round(coalesce(v.gross_total, 0), 2) then
    v_out := v_out || jsonb_build_object('code', 'payable_negative', 'lineIds', '[]'::jsonb);
  end if;

  begin
    perform app.resolve_location(v.tenant_id, p_location);
  exception when sqlstate 'P0001' then
    v_out := v_out || jsonb_build_object('code', sqlerrm, 'lineIds', '[]'::jsonb);
  end;

  return v_out;
end
$$;

revoke all on function app.approval_blockers(uuid, uuid) from public, anon, authenticated;

-- "Non è un doppione" (20261022140600's version): also records which invoice the decision was about.
-- FOR NO KEY UPDATE, not FOR UPDATE: see the header (the new foreign key takes KEY SHARE on the partner).
create or replace function public.review_clear_duplicate(p_invoice uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  v_partner uuid;
begin
  perform app.require_invoice_reviewer();
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status = 'duplicate' then
    v_partner := v.duplicate_of;
    update public.invoice
       set status = 'review', duplicate_of = null, duplicate_override = true,
           duplicate_override_of = v_partner,
           duplicate_override_by = app.app_user_id(), duplicate_override_at = now()
     where id = p_invoice;
  elsif v.status = 'review' and v.duplicate_warning_of is not null then
    v_partner := v.duplicate_warning_of;
    update public.invoice
       set duplicate_warning_of = null, duplicate_override = true,
           duplicate_override_of = v_partner,
           duplicate_override_by = app.app_user_id(), duplicate_override_at = now()
     where id = p_invoice;
  else
    raise exception 'not_flagged' using errcode = 'P0001';
  end if;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v.tenant_id, 'invoice', v.id, 'invoice.duplicate_cleared',
            jsonb_build_object('status', v.status, 'duplicate_of', v.duplicate_of,
              'duplicate_warning_of', v.duplicate_warning_of),
            jsonb_build_object('status', 'review', 'duplicate_override', true,
              'duplicate_override_of', v_partner),
            app.app_user_id());
end
$$;
revoke all on function public.review_clear_duplicate(uuid) from public, anon, authenticated, service_role;
grant execute on function public.review_clear_duplicate(uuid) to authenticated;
