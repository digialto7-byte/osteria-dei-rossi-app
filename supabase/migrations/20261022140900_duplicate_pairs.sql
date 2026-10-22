-- M5 code-review fix, round 3 (founder decision A): a duplicate decision is made per pair, and the
-- approval gate recomputes the look-alikes instead of trusting a stored pointer.
--
-- The bug (140800:201-206). For an invoice without a VAT number (name match) the gate trusted the single
-- stored duplicate_warning_of. Extraction warns against the earliest look-alike only. X, Y and W share a
-- supplier name, number and date; Y and W both warn of X. review_clear_duplicate(Y) and (W) both
-- succeeded (each against X), after which all three had no blocker and all three approved: 3 payables for
-- a document that may be one, and the owner was never shown Y against W.
--
-- The rule (founder, option A). A name match stays a warning the owner can override, but per pair:
--   * both gates (duplicate_invoice for a VAT match, duplicate_warning for a name match) block on any live
--     look-alike (status not duplicate or rejected) that is not covered by a declared pair;
--   * review_clear_duplicate declares the pair it was asked about and then re-points the invoice to the
--     next undeclared look-alike (created_at, id), or clears the pointer when there is none, so the owner
--     confirms every pair; the gates recompute, so a look-alike that appeared later is covered too.
--
-- Storage decision: a pair table, not one more column. invoice.duplicate_override_of (140800) holds ONE
-- declared partner per invoice. Re-pointing breaks it: after Y is cleared against X, Y's warning becomes W;
-- clearing Y against W would have to overwrite the column and the X exemption would be lost (Y blocked
-- by X again). One column cannot hold the set of pairs a three-way match needs, so
-- public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by, decided_at) holds one
-- row per decision, unique as an unordered pair (a decision on (Y, X) is also one on (X, Y); no second
-- row for the reverse), with composite foreign keys to invoice. It is append-only like the ledgers (the
-- same app.append_only triggers, for every role), has RLS SELECT for owner/admin of the tenant only, and
-- nobody holds INSERT, UPDATE, DELETE or TRUNCATE on it: only review_clear_duplicate (SECURITY DEFINER)
-- writes it. The VAT path and the name path use the same store and the same function
-- (app.undeclared_look_alike), so the two cannot diverge.
--
-- The per-invoice columns are kept consistently, as the record and a screen hint:
--   * duplicate_override, _by, _at and duplicate_override_of still say "the last decision on this invoice,
--     and against whom"; review_clear_duplicate writes them with the pair, nothing reads them as a gate.
--   * duplicate_of / duplicate_warning_of / status = duplicate are the stored pointer to the next
--     undeclared look-alike (extraction sets the earliest for a fresh invoice, which is the same thing:
--     a fresh invoice has no declared pair; recheck_duplicate and review_clear_duplicate keep it so).
--   * Decisions made before this migration are migrated: the table is back-filled from
--     duplicate_override_of and from every invoice.duplicate_cleared audit row (the partner is named in
--     after.duplicate_override_of, or in before.duplicate_of / duplicate_warning_of for older rows), and a
--     stored warning that points at a pair declared that way is re-pointed to the next undeclared
--     look-alike (or cleared). A bare M4 flag with no partner stays what it was: nothing is declared, both
--     sides are blocked, and "Non è un doppione" resolves it (it no longer needs a stored pointer).
-- The partner's own row is never written by a clear (its pointer may stay one step behind until it is
-- looked at; the gates do not read it). Writing it would make two owners clearing X and Y at once lock
-- each other's rows in opposite order.
--
-- Extraction (extraction_complete, M3) is unchanged and still uses the unfiltered finders: it only runs
-- for a fresh invoice (the status guard has no way back to extracting), which has no declared pair, so its
-- stored duplicate_of / duplicate_warning_of equals the first undeclared look-alike the gates compute.
--
-- Locks. review_clear_duplicate keeps its lock (FOR NO KEY UPDATE on its own row, 140800) and takes no
-- advisory lock: the gates recompute under approve_invoice's advisory lock, so a clear needs no
-- serialisation with extraction (the stored pointer is a hint). It adds three things to what it holds:
--   * KEY SHARE on the partner and on the next look-alike (the foreign keys of the pair row and of the
--     re-pointed pointer). KEY SHARE conflicts only with FOR UPDATE; the partner's row is held by others
--     only FOR NO KEY UPDATE (approve, reject, every review procedure) or, for the own-row upgrade in
--     automap_invoice, by a session that waits for nothing this procedure holds. An invoice still
--     extracting has no key yet, so it is never a look-alike (extraction_complete holds FOR UPDATE on it).
--   * the unique pair index: two clears of the same pair (X cleared against Y and Y against X at once)
--     make the second wait for the first to commit, then do nothing for the pair (on conflict do nothing).
--     The first never waits for the second, so it is a wait, not a cycle.
--   * no write to the partner's row, so two owners clearing X and Y never take each other's row lock.
-- Checked in scripts/test-db-races.sh: clear-vs-clear (crossed pair) and clear-repoint (the X/Y/W repro,
-- two owners at once; the mutation FOR UPDATE makes the second clear wait).

create table public.invoice_duplicate_decision (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  invoice_id uuid not null,
  other_id uuid not null,
  decided_by uuid not null references public.app_user (id),
  decided_at timestamptz not null default now(),
  constraint invoice_duplicate_decision_invoice_fk foreign key (tenant_id, invoice_id)
    references public.invoice (tenant_id, id),
  constraint invoice_duplicate_decision_other_fk foreign key (tenant_id, other_id)
    references public.invoice (tenant_id, id),
  constraint invoice_duplicate_decision_distinct_ck check (invoice_id <> other_id)
);
comment on table public.invoice_duplicate_decision is
  'The owner declared invoice_id and other_id two different documents (Non è un doppione). One row per unordered pair; append-only; written by review_clear_duplicate alone.';
create unique index invoice_duplicate_decision_pair_uq
  on public.invoice_duplicate_decision (tenant_id, least(invoice_id, other_id), greatest(invoice_id, other_id));
create index invoice_duplicate_decision_invoice_idx on public.invoice_duplicate_decision (tenant_id, invoice_id);
create index invoice_duplicate_decision_other_idx on public.invoice_duplicate_decision (tenant_id, other_id);

alter table public.invoice_duplicate_decision enable row level security;
revoke all on public.invoice_duplicate_decision from anon, authenticated, service_role;
grant select on public.invoice_duplicate_decision to authenticated;
create policy invoice_duplicate_decision_select on public.invoice_duplicate_decision
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

create trigger invoice_duplicate_decision_append_only
  before update or delete on public.invoice_duplicate_decision
  for each row execute function app.append_only();
create trigger invoice_duplicate_decision_no_truncate
  before truncate on public.invoice_duplicate_decision
  for each statement execute function app.append_only_truncate();

-- Decisions made before this table existed (see the header).
insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by, decided_at)
  select distinct on (s.tenant_id, least(s.invoice_id, s.other_id), greatest(s.invoice_id, s.other_id))
         s.tenant_id, s.invoice_id, s.other_id, s.decided_by, s.decided_at
    from (
      select i.tenant_id, i.id as invoice_id, i.duplicate_override_of as other_id,
             i.duplicate_override_by as decided_by, i.duplicate_override_at as decided_at
        from public.invoice i
       where i.duplicate_override_of is not null and i.duplicate_override_by is not null
      union all
      select e.tenant_id, e.entity_id,
             coalesce(e.after ->> 'duplicate_override_of', e.before ->> 'duplicate_of',
                      e.before ->> 'duplicate_warning_of')::uuid,
             e.created_by, e.created_at
        from public.audit_event e
       where e.action = 'invoice.duplicate_cleared'
    ) s
   where s.other_id is not null and s.other_id <> s.invoice_id and s.decided_at is not null
   order by s.tenant_id, least(s.invoice_id, s.other_id), greatest(s.invoice_id, s.other_id), s.decided_at;

comment on column public.invoice.duplicate_override_of is
  'The invoice the owner''s latest "Non è un doppione" on this one was about. A record only: the declared pairs are in invoice_duplicate_decision, and nothing reads this column as a gate.';

-- Is the pair declared, either way round?
create function app.duplicate_pair_declared(p_tenant uuid, p_a uuid, p_b uuid) returns boolean
  language sql stable
  set search_path = ''
as $$
  select exists (select 1
                   from public.invoice_duplicate_decision d
                  where d.tenant_id = p_tenant
                    and ((d.invoice_id = p_a and d.other_id = p_b)
                      or (d.invoice_id = p_b and d.other_id = p_a)))
$$;
revoke all on function app.duplicate_pair_declared(uuid, uuid, uuid) from public, anon, authenticated;

-- The pair-aware finders (140800's signatures), now over the pair table. p_exclude is the invoice asking.
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
     and not app.duplicate_pair_declared(p_tenant, p_exclude, i.id)
   order by i.created_at, i.id
   limit 1
$$;
revoke all on function app.find_undeclared_duplicate_invoice_in(uuid, text, text, date, uuid)
  from public, anon, authenticated;

create or replace function app.find_undeclared_name_duplicate_invoice_in(
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
     and not app.duplicate_pair_declared(p_tenant, p_exclude, i.id)
   order by i.created_at, i.id
   limit 1
$$;
revoke all on function app.find_undeclared_name_duplicate_invoice_in(uuid, text, text, date, uuid)
  from public, anon, authenticated;

-- The one place that picks the key kind: the first live look-alike of the invoice that the owner has not
-- declared a different document (VAT match for an invoice with a VAT number, else name match). The gates,
-- review_clear_duplicate and the screen's hint all use it. Null when there is none.
create function app.undeclared_look_alike(p_invoice uuid) returns uuid
  language sql stable
  set search_path = ''
as $$
  select case when i.supplier_vat is not null
              then app.find_undeclared_duplicate_invoice_in(
                     i.tenant_id, i.supplier_vat, i.number_raw, i.invoice_date, i.id)
              else app.find_undeclared_name_duplicate_invoice_in(
                     i.tenant_id, i.supplier_name, i.number_raw, i.invoice_date, i.id)
         end
    from public.invoice i
   where i.id = p_invoice
$$;
revoke all on function app.undeclared_look_alike(uuid) from public, anon, authenticated;

-- Stored warnings that point at a pair declared before this migration: the next undeclared look-alike, or none.
update public.invoice i
   set duplicate_warning_of = app.undeclared_look_alike(i.id)
 where i.status = 'review' and i.duplicate_warning_of is not null
   and app.duplicate_pair_declared(i.tenant_id, i.id, i.duplicate_warning_of);

-- Every reason the invoice cannot be approved now, as [{code, lineIds}] in the order of the gates of plan §3.1.4 (approve_invoice raises the first, the preview lists all). Takes no locks and
-- trusts no stored flag or pointer: totals and duplicates are computed now. A status other than review has
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

  -- Both duplicate gates recompute the live look-alikes the owner has not declared (a pair in
  -- invoice_duplicate_decision, either way round). No stored pointer is trusted: duplicate_warning_of and
  -- duplicate_of are a hint for the screen, not the gate. A VAT invoice is blocked with duplicate_invoice,
  -- an invoice without VAT (name match) with duplicate_warning.
  if app.undeclared_look_alike(p_invoice) is not null then
    v_out := v_out || jsonb_build_object(
      'code', case when v.supplier_vat is not null then 'duplicate_invoice' else 'duplicate_warning' end,
      'lineIds', '[]'::jsonb);
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

-- "Non è un doppione" (140800's version): declares the pair, then re-points the invoice to the next
-- undeclared look-alike. The look-alike asked about is the first undeclared one (the one the gates name):
--   * status duplicate, or review with a live undeclared look-alike (a name warning, or an invoice cleared
--     in M4 with no partner, or one whose copy arrived later): the pair is recorded;
--   * a stored pointer whose partner is no longer a live look-alike (rejected since): the pointer is
--     cleared, no pair is recorded (nothing live is left to declare);
--   * otherwise not_flagged.
-- Then duplicate_of + status (VAT) or duplicate_warning_of (no VAT) point to the next undeclared
-- look-alike, or are cleared. FOR NO KEY UPDATE on the invoice; no advisory lock, and the partner's row is
-- not written (see the header).
create or replace function public.review_clear_duplicate(p_invoice uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  v_partner uuid;
  v_next uuid;
begin
  perform app.require_invoice_reviewer();
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status not in ('review', 'duplicate') then
    raise exception 'not_flagged' using errcode = 'P0001';
  end if;

  v_partner := app.undeclared_look_alike(p_invoice);
  if v_partner is null and v.status = 'review'
     and v.duplicate_warning_of is null and v.duplicate_of is null then
    raise exception 'not_flagged' using errcode = 'P0001';
  end if;

  if v_partner is not null then
    insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by)
      values (v.tenant_id, p_invoice, v_partner, app.app_user_id())
      on conflict do nothing;
  end if;
  v_next := app.undeclared_look_alike(p_invoice);

  update public.invoice
     set status = case when v.supplier_vat is not null and v_next is not null
                       then 'duplicate'::public.invoice_status else 'review'::public.invoice_status end,
         duplicate_of = case when v.supplier_vat is not null then v_next end,
         duplicate_warning_of = case when v.supplier_vat is null then v_next end,
         duplicate_override = true,
         duplicate_override_of = coalesce(v_partner, v.duplicate_of, v.duplicate_warning_of),
         duplicate_override_by = app.app_user_id(), duplicate_override_at = now()
   where id = p_invoice;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v.tenant_id, 'invoice', v.id, 'invoice.duplicate_cleared',
            jsonb_build_object('status', v.status, 'duplicate_of', v.duplicate_of,
              'duplicate_warning_of', v.duplicate_warning_of),
            jsonb_build_object(
              'status', case when v.supplier_vat is not null and v_next is not null then 'duplicate' else 'review' end,
              'duplicate_override', true,
              'duplicate_override_of', coalesce(v_partner, v.duplicate_of, v.duplicate_warning_of),
              'next_look_alike', v_next),
            app.app_user_id());
end
$$;
revoke all on function public.review_clear_duplicate(uuid) from public, anon, authenticated, service_role;
grant execute on function public.review_clear_duplicate(uuid) to authenticated;
