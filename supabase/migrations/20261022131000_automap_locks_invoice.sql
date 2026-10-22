-- M4 round-3 fix: auto-mapping and propagation lock the invoice they write to.
-- Replaces app.automap_lines of 20261022130900 (same signature and grants). History stays
-- append-only: no earlier file is edited.
--
-- Bug: automap_lines read the invoice without a lock, and its UPDATE re-checked only the line's own
-- columns. Two facts the matching rested on were never re-checked: the invoice's supplier and the
-- line's code (or description hash) against the item. So, with two sessions:
--   relink: the reviewer moved invoice 2 from supplier A to B (which clears the lines and so makes
--           them "untouched") while propagation for A's item ran: a line of B's invoice ended up
--           mapped to A's item;
--   code:   the reviewer changed a line's supplier_code (a value edit with no marker) while
--           propagation ran: a line with code ZZ-404 ended up mapped to the MAN-1 item.
--
-- Fix, two layers:
--   1. The target invoice is locked FOR UPDATE before any line is read, and its status and supplier
--      are read under that lock. Every review procedure (app.lock_review_invoice) takes the same
--      lock first, so after our lock nothing can change the supplier, the status or the lines until
--      we commit; and if one of them holds it, we never read the old state.
--   2. The UPDATE's WHERE re-checks the invoice (supplier, and status for propagation) and that the
--      line's code or hash still matches the item. This is for any writer that does not hold the
--      invoice lock; a joined row is not re-fetched after a lock wait, but the line being updated is.
--
-- Locking mode, and why (deadlock analysis):
--   - Own invoice (p_item is null: extraction completion, supplier link): plain FOR UPDATE. The
--     caller already holds this lock, so it never waits and cannot join a cycle.
--   - Propagation to other invoices (p_item given): FOR UPDATE SKIP LOCKED. Propagation never waits
--     for another invoice. A wait would deadlock: owner 1 holds invoice 1 (review_update_line) and
--     the item row, then propagates to invoice 2; owner 2 holds invoice 2 and waits for that item
--     row. With SKIP LOCKED the invoice that someone else is working on is left out, which is
--     correct and cheap: its reviewer is looking at it, sees the line unmapped, and maps it
--     (propagation is best-effort; the mapping itself is committed with the caller). Lines are only
--     written under the invoice lock and every writer of lines takes that lock first, so the line
--     UPDATE does not wait either. No ordering by id is needed because nothing waits.
--   - Skipped is not "mapped later": a skipped line stays untouched and unmapped until the next
--     propagation, supplier link or manual mapping. This is the accepted trade-off.
--
-- The two-session cases (relink, code change, deadlock) are run by scripts/test-db-races.sh, in CI.

create or replace function app.automap_lines(p_invoice uuid, p_item uuid default null) returns int
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  it public.supplier_item;
  ids uuid[];
begin
  if p_item is null then
    -- Own invoice. The caller holds the lock already; this only makes the guarantee explicit.
    -- Callers run it on an invoice in review or duplicate (just extracted, or being reviewed); the
    -- status check keeps a direct call from remapping an approved or rejected invoice.
    select * into v from public.invoice i where i.id = p_invoice for update;
    if not found or v.supplier_id is null or v.status not in ('review', 'duplicate') then
      return 0;
    end if;
  else
    select * into it from public.supplier_item si where si.id = p_item;
    if not found then
      return 0;
    end if;
    -- Propagation target: still in review, still the item's supplier, and not being worked on.
    select * into v
      from public.invoice i
     where i.id = p_invoice and i.tenant_id = it.tenant_id
       and i.supplier_id = it.supplier_id and i.status = 'review'
       for update skip locked;
    if not found then
      return 0;
    end if;
  end if;

  with hit as (
    select l.id as line_id, m.item_id, m.item_code, m.item_hash, m.ingredient_id, m.invoice_unit
      from public.invoice_line l
     cross join lateral (
       select si.id as item_id, si.supplier_code as item_code, si.description_hash as item_hash,
              si.ingredient_id, si.invoice_unit
         from public.supplier_item si
         join public.ingredient g on g.tenant_id = si.tenant_id and g.id = si.ingredient_id
        where si.tenant_id = v.tenant_id and si.supplier_id = v.supplier_id
          and si.is_active and g.is_active
          and ((l.supplier_code is not null and si.supplier_code = l.supplier_code)
               or si.description_hash = app.description_hash(l.raw_description))
        -- Code match first. coalesce: a hash-keyed item compares to null, and DESC sorts nulls first.
        order by coalesce(si.supplier_code = l.supplier_code, false) desc, si.id
        limit 1) m
     where l.tenant_id = v.tenant_id and l.invoice_id = v.id
       and l.parent_line_id is null and l.split_at is null
       and l.is_stock and app.line_is_untouched(l)
       and (p_item is null or m.item_id = p_item)
  ),
  written as (
    update public.invoice_line t
       set ingredient_id = h.ingredient_id,
           supplier_item_id = h.item_id,
           suggested_ingredient_id = h.ingredient_id,
           suggested_supplier_item_id = h.item_id,
           mapping_source = 'auto',
           -- A unit parsed from the printed one stays; otherwise the article's remembered unit, but
           -- only on a line whose unit nobody decided (a cleared or changed unit stays as it is).
           unit = case when app.line_unit_is_open(t) then h.invoice_unit else t.unit end,
           suggested_unit = case when app.line_unit_is_open(t) then h.invoice_unit
                                 else t.suggested_unit end
      from hit h
     -- The eligibility conditions are repeated here on purpose: when the row is locked by another
     -- transaction, Postgres re-checks only this WHERE on the new row version, not the hit CTE.
     where t.id = h.line_id
       and t.parent_line_id is null and t.split_at is null
       and t.is_stock and app.line_is_untouched(t)
       -- The line still matches the item it is written to (code first, else description).
       and ((t.supplier_code is not null and t.supplier_code = h.item_code)
            or h.item_hash = app.description_hash(t.raw_description))
       -- The invoice still has the supplier (and, for propagation, is still in review). We hold its
       -- lock, so this reads the committed state; it is a redundant guard, not a substitute for the
       -- lock (a joined row is not re-read after a lock wait).
       and exists (select 1 from public.invoice i
                    where i.id = t.invoice_id and i.supplier_id = v.supplier_id
                      and (p_item is null or i.status = 'review'))
    returning t.id
  )
  select coalesce(array_agg(w.id), '{}') into ids from written w;
  -- The statement above sees the old rows, so the correction list is recomputed after it.
  update public.invoice_line t
     set corrected_fields = app.line_corrected_fields(t)
   where t.id = any (ids);
  return coalesce(cardinality(ids), 0);
end
$$;

comment on function app.automap_lines(uuid, uuid) is
  'Maps untouched lines of one invoice from the supplier memory. Locks the invoice first; propagation (p_item given) skips an invoice another transaction holds.';
