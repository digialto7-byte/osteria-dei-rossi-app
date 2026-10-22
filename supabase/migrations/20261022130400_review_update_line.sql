-- M4: public.review_update_line, the one procedure behind every line action of the review screen
-- (M4 plan §3.2, §3.3). SECURITY DEFINER with search_path = '': authenticated has no UPDATE
-- on invoice, invoice_line or supplier_item, so a reviewer cannot write corrected_fields or the
-- suggestions directly. The role is checked first, the tenant comes from app.tenant_id(), every query
-- filters by tenant (a definer bypasses RLS), and the whole call is one transaction. It writes only
-- invoice, invoice_line and supplier_item: no ledger, no approval, never supplier_item.last_price.

-- Reads one value of the patch, checking its JSON type; a wrong type is invalid_request.
create function app.patch_value(
  p_patch jsonb, p_key text, p_type text, p_nullable boolean default true
) returns text
  language plpgsql immutable
  set search_path = ''
as $$
declare
  t text := jsonb_typeof(p_patch -> p_key);
begin
  if t = 'null' and p_nullable then
    return null;
  end if;
  if t is distinct from p_type then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  return p_patch ->> p_key;
end
$$;

-- A non-stock line needs an active cost centre of the tenant. An id from another tenant is left
-- to the composite foreign key (23503) when the line is written.
create function app.check_cost_centre(p_tenant uuid, p_cost_centre uuid) returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if p_cost_centre is null or exists (
       select 1 from public.cost_centre c
        where c.tenant_id = p_tenant and c.id = p_cost_centre and not c.is_active) then
    raise exception 'cost_centre_required' using errcode = 'P0001';
  end if;
end
$$;

-- p_patch keys (all optional, at least one): qty, unit_price, line_amount, vat_rate, supplier_code,
-- unit, lot_code, expiry, is_stock, cost_centre_id, ingredient_id (null = unmap), pack {count, size,
-- unit, label}, credit_qty, reviewed (true).
create function public.review_update_line(p_invoice uuid, p_line uuid, p_patch jsonb)
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
    l.unit := app.patch_value(p_patch, 'unit', 'string');
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

revoke all on function app.patch_value(jsonb, text, text, boolean),
  app.check_cost_centre(uuid, uuid) from public, anon, authenticated;
revoke all on function public.review_update_line(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.review_update_line(uuid, uuid, jsonb) to authenticated;
