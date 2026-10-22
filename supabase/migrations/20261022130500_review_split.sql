-- M4: split and unsplit an invoice line (M4 plan §3.2). A split keeps the parent row (split_at) and
-- adds children (parent_line_id, sub_position); a re-split or unsplit marks old children
-- superseded_at. Nothing is deleted. Same shape as review_update_line: SECURITY DEFINER,
-- search_path = '', role checked first, tenant filtered explicitly, one transaction, writes only
-- invoice and invoice_line.

-- p_children: 2 to 10 objects {qty, line_amount}, qty > 0, line_amount >= 0, at most four decimals.
-- The sums must equal the parent's exactly (numeric arithmetic, no floats).
create function public.review_split_line(p_invoice uuid, p_line uuid, p_children jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  l public.invoice_line;
  e jsonb;
  v_qty numeric;
  v_amount numeric;
  v_sum_qty numeric := 0;
  v_sum_amount numeric := 0;
  v_base int;
begin
  perform app.require_invoice_reviewer();

  if p_children is null or jsonb_typeof(p_children) <> 'array'
     or jsonb_array_length(p_children) not between 2 and 10 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  for e in select jsonb_array_elements(p_children) loop
    if jsonb_typeof(e) <> 'object'
       or exists (select 1 from jsonb_object_keys(e) k where k not in ('qty', 'line_amount'))
       or not (e ? 'qty' and e ? 'line_amount') then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_qty := app.patch_value(e, 'qty', 'number', false)::numeric;
    v_amount := app.patch_value(e, 'line_amount', 'number', false)::numeric;
    if v_qty <= 0 or v_amount < 0 or v_qty <> round(v_qty, 4) or v_amount <> round(v_amount, 4) then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_sum_qty := v_sum_qty + v_qty;
    v_sum_amount := v_sum_amount + v_amount;
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
  if l.parent_line_id is not null then
    raise exception 'split_child_cannot_split' using errcode = 'P0001';
  end if;
  if l.credit_qty <> 0 then
    raise exception 'split_credit_conflict' using errcode = 'P0001';
  end if;
  if v_sum_qty <> l.qty or v_sum_amount <> l.line_amount then
    raise exception 'split_sum_mismatch' using errcode = 'P0001';
  end if;

  update public.invoice_line c
     set superseded_at = now()
   where c.tenant_id = v.tenant_id and c.parent_line_id = l.id and c.superseded_at is null;

  select coalesce(max(c.sub_position), 0) into v_base
    from public.invoice_line c
   where c.tenant_id = v.tenant_id and c.parent_line_id = l.id;

  -- The children inherit stock or non-stock (and the cost centre) from the parent, so splitting a
  -- non-stock line does not turn it into stock lines that need an ingredient.
  insert into public.invoice_line (tenant_id, invoice_id, position, sub_position, parent_line_id,
      raw_description, qty, unit_price, line_amount, vat_rate, unit, lot_code, expiry, is_stock,
      cost_centre_id, field_confidence, extracted, checks, created_by)
    select v.tenant_id, v.id, l.position, v_base + c.ord::int, l.id, l.raw_description, c.qty,
           round(c.amount / c.qty, 4), c.amount, l.vat_rate, l.unit, l.lot_code, l.expiry,
           l.is_stock, l.cost_centre_id, '{}'::jsonb, '{}'::jsonb,
           app.line_checks(c.qty, round(c.amount / c.qty, 4), c.amount, l.vat_rate),
           app.app_user_id()
      from jsonb_array_elements(p_children) with ordinality as j(elem, ord)
     cross join lateral (
       select j.ord, (j.elem ->> 'qty')::numeric as qty, (j.elem ->> 'line_amount')::numeric as amount
     ) c
     order by c.ord;

  update public.invoice_line set split_at = now() where id = l.id;
  perform app.refresh_gate(p_invoice);
end
$$;

create function public.review_unsplit_line(p_invoice uuid, p_line uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  l public.invoice_line;
begin
  perform app.require_invoice_reviewer();
  v := app.lock_review_invoice(p_invoice);
  select * into l
    from public.invoice_line x
   where x.id = p_line and x.invoice_id = p_invoice and x.tenant_id = v.tenant_id
     and x.superseded_at is null
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if l.split_at is null then
    raise exception 'not_split' using errcode = 'P0001';
  end if;

  update public.invoice_line c
     set superseded_at = now()
   where c.tenant_id = v.tenant_id and c.parent_line_id = l.id and c.superseded_at is null;
  update public.invoice_line set split_at = null where id = l.id;
  perform app.refresh_gate(p_invoice);
end
$$;

revoke all on function public.review_split_line(uuid, uuid, jsonb),
  public.review_unsplit_line(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.review_split_line(uuid, uuid, jsonb),
  public.review_unsplit_line(uuid, uuid) to authenticated;
