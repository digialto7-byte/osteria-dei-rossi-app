-- P2-7, lead decision 2026-11-14 (ADR-044, "Statistics-independent automap"): replaces app.automap_lines of 20261022131000 (same
-- signature, grants, locking and UPDATE). History stays append-only: no earlier file is edited.
--
-- Problem: the article lookup was one correlated subquery per line with an OR over code and description hash, ordered and
-- limited. Without fresh statistics on supplier_item (a catalogue that grew since its last autoanalyze, or rows of the same
-- transaction), Postgres seq-scanned the supplier's whole catalogue for each line and computed the line's description hash for
-- each catalogue row: lines x articles. A file of 10 bodies x 200 lines against 5 000 articles took about 52 s on PG16 (1.03 s
-- with analyzed statistics), past the 8 s statement_timeout `authenticated` has on Supabase.
--
-- Fix: only the lookup changes. The eligible lines are read once, each description hashed once; the supplier's usable articles
-- whose code or description occurs on the invoice are then found by ONE statement (an array match on the two unique keys of
-- supplier_item), so the work is bounded by one pass over that supplier's catalogue per invoice, whatever the statistics; each
-- line then takes its article from that small set, code first. Same result as before: at most one article matches each key, the
-- code's article wins when it is usable, inactive articles and articles of inactive ingredients are skipped (so the
-- description's article applies when the code's one cannot), and p_item still keeps only that article. The UPDATE with its
-- re-checks, the invoice lock and the corrected_fields pass are unchanged. pgTAP 366 pins the time and the semantics; 022 and
-- the race cases run unchanged.

create or replace function app.automap_lines(p_invoice uuid, p_item uuid default null) returns int
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  it public.supplier_item;
  ids uuid[];
  v_lines uuid[];
  v_codes text[];
  v_hashes text[];
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

  -- The eligible lines, read once, with each description hashed once. The three arrays are filled by one aggregate scan, so
  -- they stay aligned position by position.
  select coalesce(array_agg(l.id), '{}'), coalesce(array_agg(l.supplier_code), '{}'),
         coalesce(array_agg(app.description_hash(l.raw_description)), '{}')
    into v_lines, v_codes, v_hashes
    from public.invoice_line l
   where l.tenant_id = v.tenant_id and l.invoice_id = v.id
     and l.parent_line_id is null and l.split_at is null
     and l.is_stock and app.line_is_untouched(l);

  -- `cand`: the supplier's usable articles whose code or description occurs on the invoice, found by one statement over the
  -- supplier's catalogue (an array match on its unique keys); whatever plan the statistics lead to, that is at most one pass
  -- per invoice, never one per line. Inactive articles and articles of inactive ingredients are left out here, so the
  -- description's article applies when the code's one cannot. `hit`: per line, at most one article, its code's first, else its
  -- description's (each is a unique key of supplier_item, so each kind has at most one).
  with cand as materialized (
    select si.id as item_id, si.supplier_code as item_code, si.description_hash as item_hash, si.ingredient_id, si.invoice_unit
      from public.supplier_item si
      join public.ingredient g on g.tenant_id = si.tenant_id and g.id = si.ingredient_id
     where si.tenant_id = v.tenant_id and si.supplier_id = v.supplier_id
       and (si.supplier_code = any (v_codes) or si.description_hash = any (v_hashes))
       and si.is_active and g.is_active
  ),
  own as (
    select o.line_id, o.code, o.hash from unnest(v_lines, v_codes, v_hashes) as o (line_id, code, hash)
  ),
  hit as (
    select o.line_id, m.item_id, m.item_code, m.item_hash, m.ingredient_id, m.invoice_unit
      from own o
     cross join lateral (
       select c.item_id, c.item_code, c.item_hash, c.ingredient_id, c.invoice_unit
         from cand c
        where c.item_code = o.code or c.item_hash = o.hash
        -- Code first. coalesce: a line without a code compares to null, and DESC sorts nulls first.
        order by coalesce(c.item_code = o.code, false) desc
        limit 1) m
     where p_item is null or m.item_id = p_item
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
