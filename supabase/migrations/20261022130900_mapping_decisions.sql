-- M4 round-2 fix: auto-mapping and propagation stop only at a MAPPING decision of the reviewer.
-- Replaces app.line_is_untouched, app.automap_lines and app.automap_invoice of 20261022130800,
-- public.review_update_line of 20261022130400 and public.review_set_supplier of 20261022130600
-- (same signatures and grants). History stays append-only: those files are not edited.
--
-- Why: 130800 treated any reviewed_at stamp or any corrected field as a decision. review_update_line
-- stamps reviewed_at on every action, so a corrected qty or "line checked" blocked propagation of a
-- new mapping and the automap that runs when a supplier is linked. The plan says otherwise (M4 plan
-- §3.1.1: a new mapping reaches the unmapped lines of the same supplier in other review invoices,
-- and linking a supplier re-runs auto-mapping; §3.1.6: credit qty and "line checked" are not
-- corrections).
--
-- The rule, in one place (app.line_is_untouched and app.line_unit_is_open):
--   mapping_decided_at, set by review_update_line when the reviewer
--     - sets or clears the ingredient (ingredient_id in the patch, null or a value),
--     - chooses non-stock, or takes a line from non-stock back to stock;
--   unit_decided_at, set when the reviewer clears or changes the unit (unit in the patch, with a
--     value different from the current one).
--   A line is open to auto-mapping (and propagation) when it has no ingredient, no supplier item, no
--   mapping_source, no stored ingredient or supplier item suggestion, and mapping_decided_at is null.
--   The unit is filled only when unit and suggested_unit are null and unit_decided_at is null.
--   Value edits (qty, unit price, amount, VAT, lot, expiry, credit qty, supplier code) and "line
--   checked" set neither marker. A cleared unit blocks the unit fill only, not the mapping.
-- Split and unsplit set neither marker: a split parent is excluded by split_at and goes back to its
-- earlier state on unsplit; children are never auto-mapped. Re-linking a supplier keeps both markers.
-- Every line written by auto-mapping ends with corrected_fields = app.line_corrected_fields(row).
-- No data is migrated: the M4 migrations are not applied anywhere shared yet.

alter table public.invoice_line
  add column mapping_decided_at timestamptz,
  add column unit_decided_at timestamptz;
comment on column public.invoice_line.mapping_decided_at is
  'When the reviewer set or cleared the ingredient, or chose non-stock (also back to stock). Stops auto-mapping and propagation.';
comment on column public.invoice_line.unit_decided_at is
  'When the reviewer cleared or changed the unit. Stops the automatic unit fill.';

create or replace function app.line_is_untouched(l public.invoice_line) returns boolean
  language sql immutable
  set search_path = ''
as $$
  select l.ingredient_id is null and l.supplier_item_id is null and l.mapping_source is null
     and l.suggested_ingredient_id is null and l.suggested_supplier_item_id is null
     and l.mapping_decided_at is null
$$;

-- The unit can be filled in automatically: none yet, none suggested, and no decision about it.
create function app.line_unit_is_open(l public.invoice_line) returns boolean
  language sql immutable
  set search_path = ''
as $$
  select l.unit is null and l.suggested_unit is null and l.unit_decided_at is null
$$;

-- The unit on a line was put there by an automatic fill (printed unit or the supplier's article)
-- and the reviewer did not decide on it. The re-link clears such units.
create function app.line_unit_came_from_fill(l public.invoice_line) returns boolean
  language sql immutable
  set search_path = ''
as $$
  select l.suggested_unit is not null and l.unit is not distinct from l.suggested_unit
     and l.unit_decided_at is null
$$;

create or replace function public.review_update_line(p_invoice uuid, p_line uuid, p_patch jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  l public.invoice_line;
  k text;
  v_old_source text;
  v_stock boolean;
  v_cc uuid;
  v_ing uuid;
  v_code text;
  v_hash text;
  it public.supplier_item;
  v_pack jsonb;
  v_pc numeric;
  v_ps numeric;
  v_pu text;
  v_pl text;
  v_pack_applied boolean := false;
  v_changed boolean;
  v_propagate uuid;
  v_unit text;
begin
  perform app.require_invoice_reviewer();

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k <> all (array['qty', 'unit_price', 'line_amount', 'vat_rate', 'supplier_code', 'unit',
                       'lot_code', 'expiry', 'is_stock', 'cost_centre_id', 'ingredient_id', 'pack',
                       'credit_qty', 'reviewed']) then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
  end loop;

  v := app.lock_review_invoice(p_invoice);
  select * into l
    from public.invoice_line x
   where x.id = p_line and x.invoice_id = p_invoice and x.tenant_id = v.tenant_id
     and x.superseded_at is null
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if l.split_at is not null then
    raise exception 'line_split' using errcode = 'P0001';
  end if;
  v_old_source := l.mapping_source;

  if p_patch ? 'reviewed' and app.patch_value(p_patch, 'reviewed', 'boolean', false) <> 'true' then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  if p_patch ? 'pack' then
    v_pack := p_patch -> 'pack';
    if jsonb_typeof(v_pack) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_pack) pk
                   where pk not in ('count', 'size', 'unit', 'label'))
       or not (v_pack ? 'count' and v_pack ? 'size' and v_pack ? 'unit') then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_pc := app.patch_value(v_pack, 'count', 'number', false)::numeric;
    v_ps := app.patch_value(v_pack, 'size', 'number', false)::numeric;
    v_pu := app.patch_value(v_pack, 'unit', 'string', false);
    v_pl := case when v_pack ? 'label'
                 then nullif(btrim(app.patch_value(v_pack, 'label', 'string')), '') end;
    if v_pu not in ('kg', 'g', 'l', 'ml', 'pz') then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
  end if;

  -- Extracted values. A split child's amounts are fixed by the split.
  if (p_patch ? 'qty' or p_patch ? 'unit_price' or p_patch ? 'line_amount')
     and l.parent_line_id is not null then
    raise exception 'split_child_locked' using errcode = 'P0001';
  end if;
  if p_patch ? 'qty' then
    l.qty := app.patch_value(p_patch, 'qty', 'number', false)::numeric;
  end if;
  if p_patch ? 'unit_price' then
    l.unit_price := app.patch_value(p_patch, 'unit_price', 'number')::numeric;
  end if;
  if p_patch ? 'line_amount' then
    l.line_amount := app.patch_value(p_patch, 'line_amount', 'number', false)::numeric;
  end if;
  if p_patch ? 'vat_rate' then
    l.vat_rate := app.patch_value(p_patch, 'vat_rate', 'number')::numeric;
  end if;
  if p_patch ? 'supplier_code' then
    l.supplier_code := nullif(btrim(app.patch_value(p_patch, 'supplier_code', 'string')), '');
  end if;
  if p_patch ? 'unit' then
    v_unit := app.patch_value(p_patch, 'unit', 'string');
    -- Cleared or changed: the unit is the reviewer's now and is never filled in again.
    if v_unit is distinct from l.unit then
      l.unit_decided_at := now();
    end if;
    l.unit := v_unit;
  end if;
  if p_patch ? 'lot_code' then
    l.lot_code := nullif(btrim(app.patch_value(p_patch, 'lot_code', 'string')), '');
  end if;
  if p_patch ? 'expiry' then
    l.expiry := app.patch_value(p_patch, 'expiry', 'string')::date;
  end if;

  -- Stock or non-stock. A non-stock line has a cost centre and no ingredient.
  if p_patch ? 'is_stock' then
    v_stock := app.patch_value(p_patch, 'is_stock', 'boolean', false)::boolean;
    -- Non-stock, and non-stock back to stock, are mapping decisions.
    if not v_stock or not l.is_stock then
      l.mapping_decided_at := now();
    end if;
    if v_stock then
      if p_patch ? 'cost_centre_id' and p_patch -> 'cost_centre_id' <> 'null'::jsonb then
        raise exception 'invalid_request' using errcode = 'P0001';
      end if;
      l.is_stock := true;
      l.cost_centre_id := null;
    else
      v_cc := case when p_patch ? 'cost_centre_id'
                   then app.patch_value(p_patch, 'cost_centre_id', 'string')::uuid
                   else l.cost_centre_id end;
      perform app.check_cost_centre(v.tenant_id, v_cc);
      l.is_stock := false;
      l.cost_centre_id := v_cc;
      l.ingredient_id := null;
      l.supplier_item_id := null;
      l.mapping_source := null;
    end if;
  elsif p_patch ? 'cost_centre_id' then
    v_cc := app.patch_value(p_patch, 'cost_centre_id', 'string')::uuid;
    if l.is_stock then
      if v_cc is not null then
        raise exception 'invalid_request' using errcode = 'P0001';
      end if;
    else
      perform app.check_cost_centre(v.tenant_id, v_cc);
      l.cost_centre_id := v_cc;
    end if;
  end if;

  -- Mapping to an ingredient. An original line is remembered per supplier, by its code or else its
  -- description; a split child only records the ingredient.
  if p_patch ? 'ingredient_id' then
    v_ing := app.patch_value(p_patch, 'ingredient_id', 'string')::uuid;
    -- Set or cleared: a mapping decision, whether or not anything was suggested.
    l.mapping_decided_at := now();
    if v_ing is null then
      l.ingredient_id := null;
      l.supplier_item_id := null;
      l.mapping_source := null;
    else
      if not l.is_stock then
        raise exception 'non_stock_has_ingredient' using errcode = 'P0001';
      end if;
      if v.supplier_id is null then
        raise exception 'supplier_required' using errcode = 'P0001';
      end if;
      if l.parent_line_id is null then
        v_code := nullif(btrim(l.supplier_code), '');
        v_hash := app.description_hash(l.raw_description);
        select * into it
          from public.supplier_item si
         where si.tenant_id = v.tenant_id and si.supplier_id = v.supplier_id
           and ((v_code is not null and si.supplier_code = v_code)
                or (v_code is null and si.description_hash = v_hash))
           for update;
        if found then
          if v_pack is not null then
            v_changed := (it.pack_count, it.pack_qty, it.pack_unit::text, it.pack_label)
                         is distinct from (v_pc, v_ps, v_pu, v_pl);
            if v_changed and v_old_source = 'auto' then
              l.pack_corrected := true;
            end if;
            update public.supplier_item
               set ingredient_id = v_ing, is_active = true, pack_count = v_pc, pack_qty = v_ps,
                   pack_unit = v_pu::public.measure_unit, pack_label = v_pl,
                   invoice_unit = coalesce(l.unit, invoice_unit)
             where id = it.id;
          else
            update public.supplier_item
               set ingredient_id = v_ing, is_active = true,
                   invoice_unit = coalesce(l.unit, invoice_unit)
             where id = it.id;
          end if;
        else
          if v_pack is null then
            -- Default pack: one measure unit of the line's unit. Counted packs need an explicit one.
            if l.unit is null or l.unit not in ('kg', 'g', 'l', 'ml', 'pz') then
              raise exception 'pack_required' using errcode = 'P0001';
            end if;
            v_pc := 1;
            v_ps := 1;
            v_pu := l.unit;
            v_pl := null;
          end if;
          insert into public.supplier_item (tenant_id, supplier_id, ingredient_id, supplier_code,
              description_hash, pack_count, pack_qty, pack_unit, pack_label, invoice_unit,
              created_by)
            values (v.tenant_id, v.supplier_id, v_ing, v_code,
              case when v_code is null then v_hash end, v_pc, v_ps, v_pu::public.measure_unit, v_pl,
              l.unit, app.app_user_id())
            returning * into it;
        end if;
        v_pack_applied := v_pack is not null or it.id is not null;
        l.supplier_item_id := it.id;
        v_propagate := it.id;
      else
        if l.unit is null or l.unit not in ('kg', 'g', 'l', 'ml', 'pz') then
          raise exception 'pack_required' using errcode = 'P0001';
        end if;
        l.supplier_item_id := null;
      end if;
      l.ingredient_id := v_ing;
      l.mapping_source := case when v_ing is not distinct from l.suggested_ingredient_id
                               then 'auto' else 'manual' end;
    end if;
  end if;

  -- A pack change on an already mapped line.
  if v_pack is not null and not v_pack_applied then
    if l.supplier_item_id is null then
      raise exception 'not_mapped' using errcode = 'P0001';
    end if;
    select * into it
      from public.supplier_item si
     where si.id = l.supplier_item_id and si.tenant_id = v.tenant_id
       for update;
    if not found then
      raise exception 'not_mapped' using errcode = 'P0001';
    end if;
    v_changed := (it.pack_count, it.pack_qty, it.pack_unit::text, it.pack_label)
                 is distinct from (v_pc, v_ps, v_pu, v_pl);
    if v_changed then
      if l.mapping_source = 'auto' then
        l.pack_corrected := true;
      end if;
      update public.supplier_item
         set pack_count = v_pc, pack_qty = v_ps, pack_unit = v_pu::public.measure_unit,
             pack_label = v_pl
       where id = it.id;
    end if;
  end if;

  -- A short or damaged delivery; M5 computes the payable from it.
  if p_patch ? 'credit_qty' then
    l.credit_qty := app.patch_value(p_patch, 'credit_qty', 'number', false)::numeric;
  end if;
  if l.credit_qty > l.qty then
    raise exception 'credit_qty_exceeds_qty' using errcode = 'P0001';
  end if;

  l.checks := app.line_checks(l.qty, l.unit_price, l.line_amount, l.vat_rate);
  l.corrected_fields := app.line_corrected_fields(l);
  update public.invoice_line
     set qty = l.qty, unit_price = l.unit_price, line_amount = l.line_amount, vat_rate = l.vat_rate,
         supplier_code = l.supplier_code, unit = l.unit, lot_code = l.lot_code, expiry = l.expiry,
         is_stock = l.is_stock, cost_centre_id = l.cost_centre_id, ingredient_id = l.ingredient_id,
         supplier_item_id = l.supplier_item_id, mapping_source = l.mapping_source,
         credit_qty = l.credit_qty, pack_corrected = l.pack_corrected, checks = l.checks,
         mapping_decided_at = l.mapping_decided_at, unit_decided_at = l.unit_decided_at,
         corrected_fields = l.corrected_fields, reviewed_by = app.app_user_id(),
         reviewed_at = now()
   where id = l.id;

  -- The new mapping reaches the same supplier's other invoices in review.
  if v_propagate is not null then
    perform app.propagate_mapping(v_propagate);
  end if;
  perform app.refresh_gate(p_invoice);
end
$$;

create or replace function public.review_set_supplier(p_invoice uuid, p_supplier uuid, p_new jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  i public.invoice;
  s public.supplier;
  k text;
begin
  perform app.require_invoice_reviewer();

  if (p_supplier is null) = (p_new is null) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if p_new is not null then
    if jsonb_typeof(p_new) <> 'object' or not (p_new ? 'name') then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    for k in select jsonb_object_keys(p_new) loop
      if k <> all (array['name', 'vat_number', 'payment_terms_days']) then
        raise exception 'invalid_request' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  v := app.lock_review_invoice(p_invoice);

  if p_new is not null then
    insert into public.supplier (tenant_id, name, vat_number, payment_terms_days, created_by)
      values (v.tenant_id,
        app.patch_value(p_new, 'name', 'string', false),
        case when p_new ? 'vat_number'
             then nullif(btrim(app.patch_value(p_new, 'vat_number', 'string')), '') end,
        case when p_new ? 'payment_terms_days'
             then app.patch_value(p_new, 'payment_terms_days', 'number')::smallint end,
        app.app_user_id())
      returning * into s;
  else
    select * into s
      from public.supplier x
     where x.id = p_supplier and x.tenant_id = v.tenant_id and x.is_active;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  if v.supplier_id is not null and v.supplier_id <> s.id then
    update public.invoice_line l
       set ingredient_id = null, supplier_item_id = null, suggested_ingredient_id = null,
           suggested_supplier_item_id = null, mapping_source = null, pack_corrected = false,
           -- A unit the old supplier's memory filled goes with it (the unit pass below reads the
           -- printed one again). A unit the reviewer decided on stays.
           unit = case when app.line_unit_came_from_fill(l) then null else l.unit end,
           suggested_unit = case when app.line_unit_came_from_fill(l) then null else l.suggested_unit end
     where l.tenant_id = v.tenant_id and l.invoice_id = v.id;
    update public.invoice_line l
       set corrected_fields = app.line_corrected_fields(l)
     where l.tenant_id = v.tenant_id and l.invoice_id = v.id;
  end if;

  i := v;
  i.supplier_id := s.id;
  i.supplier_suggestion_id := null;
  if s.vat_number is not null and s.vat_number is distinct from v.supplier_vat then
    i.supplier_vat := s.vat_number;
  end if;
  i.header_corrected_fields := app.header_corrected_fields(i);
  update public.invoice
     set supplier_id = i.supplier_id, supplier_suggestion_id = i.supplier_suggestion_id,
         supplier_vat = i.supplier_vat, header_corrected_fields = i.header_corrected_fields
   where id = p_invoice;

  perform app.recheck_duplicate(p_invoice);
  perform app.automap_invoice(p_invoice);
end
$$;

-- Maps the untouched, active, original stock lines of one invoice from the supplier's remembered
-- articles (see 20261022130300 for the lookup). p_item restricts it to one article (propagation).
-- Returns the number of lines mapped. Race: see the comment at the UPDATE.
create or replace function app.automap_lines(p_invoice uuid, p_item uuid default null) returns int
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  ids uuid[];
begin
  select * into v from public.invoice i where i.id = p_invoice;
  if not found or v.supplier_id is null then
    return 0;
  end if;
  with hit as (
    select l.id as line_id, m.item_id, m.ingredient_id, m.invoice_unit
      from public.invoice_line l
     cross join lateral (
       select si.id as item_id, si.ingredient_id, si.invoice_unit
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


-- Unit pass: only a line with no unit decision; the mapping state does not matter here.
create or replace function app.automap_invoice(p_invoice uuid) returns int
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  v_supplier uuid;
  v_suggestion uuid;
  ids uuid[];
begin
  select * into v from public.invoice i where i.id = p_invoice;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v.supplier_id is null then
    if v.supplier_vat is not null then
      select s.id into v_supplier
        from public.supplier s
       where s.tenant_id = v.tenant_id and s.vat_number = v.supplier_vat and s.is_active;
      if v_supplier is not null then
        update public.invoice set supplier_id = v_supplier where id = p_invoice;
      end if;
    elsif v.supplier_name is not null then
      select min(s.id::text)::uuid into v_suggestion
        from public.supplier s
       where s.tenant_id = v.tenant_id and s.vat_number is null and s.is_active
         and app.normalise_name(s.name) = app.normalise_name(v.supplier_name)
      having count(*) = 1;
      if v_suggestion is not null then
        update public.invoice set supplier_suggestion_id = v_suggestion where id = p_invoice;
      end if;
    end if;
  end if;

  with written as (
    update public.invoice_line l
       set unit = app.parse_unit_raw(l.unit_raw), suggested_unit = app.parse_unit_raw(l.unit_raw)
     where l.tenant_id = v.tenant_id and l.invoice_id = v.id
       and l.parent_line_id is null and l.split_at is null
       and app.line_unit_is_open(l) and app.parse_unit_raw(l.unit_raw) is not null
    returning l.id
  )
  select coalesce(array_agg(w.id), '{}') into ids from written w;
  update public.invoice_line t
     set corrected_fields = app.line_corrected_fields(t)
   where t.id = any (ids);

  return app.automap_lines(p_invoice);
end
$$;


revoke all on function app.line_unit_is_open(public.invoice_line),
  app.line_unit_came_from_fill(public.invoice_line) from public, anon, authenticated;
-- line_unit_is_open is reached from extraction_complete (service_role, SECURITY INVOKER) through
-- auto-mapping, like line_is_untouched. The other is called only from the definer review_set_supplier.
grant execute on function app.line_unit_is_open(public.invoice_line) to service_role;
