-- M5 step 5: what approving an invoice would post, and why it may not yet (M5 plan §3.1, §3.2,
-- §3.3). One computation for two callers: the read-only preview and approve_invoice both read
-- app.approval_lines and app.approval_blockers, so the numbers shown are the numbers posted.
-- All in schema app, which the Data API does not expose. Execute is revoked from public, anon and
-- authenticated: the definer procedures of the next migrations call these as their owner. They take
-- an invoice id and read the tenant from that invoice row; the procedures only pass an invoice they
-- found with app.tenant_id().

-- One row per active invoice line (not a split parent, not a superseded child), in line order.
-- received_qty and unit_price are in the ingredient base unit and are null when the line is not a
-- convertible stock line; unit_price (EUR per base unit, net of VAT) is also null when nothing is
-- received. credited_amount is the value of the credit including VAT, null when the credit has no
-- VAT rate to price it.
create type app.approval_line as (
  line_id uuid,
  position smallint,
  sub_position smallint,
  is_stock boolean,
  ingredient_id uuid,
  base_unit public.base_unit,
  supplier_item_id uuid,
  unit text,
  qty numeric,
  credit_qty numeric,
  base_factor numeric,
  received_qty numeric,
  unit_price numeric,
  lot_code text,
  expiry date,
  credited_amount numeric
);

create function app.approval_lines(p_invoice uuid) returns setof app.approval_line
  language sql stable
  set search_path = ''
as $$
  select l.id, l.position, l.sub_position, l.is_stock, l.ingredient_id, g.base_unit,
         l.supplier_item_id, l.unit, l.qty, l.credit_qty, c.factor,
         case when l.is_stock and c.factor is not null
              then round((l.qty - l.credit_qty) * c.factor, 4) end,
         case when l.is_stock and c.factor is not null and l.qty > 0
                   and round((l.qty - l.credit_qty) * c.factor, 4) > 0
              then round(l.line_amount / (l.qty * c.factor), 4) end,
         l.lot_code, l.expiry,
         case when l.credit_qty = 0 then 0::numeric
              when l.vat_rate is null then null
              else round(l.credit_qty * l.line_amount / l.qty * (1 + l.vat_rate / 100), 2) end
    from public.invoice i
    join public.invoice_line l on l.tenant_id = i.tenant_id and l.invoice_id = i.id
    left join public.ingredient g on g.tenant_id = l.tenant_id and g.id = l.ingredient_id
    left join public.supplier_item si on si.tenant_id = l.tenant_id and si.id = l.supplier_item_id
   cross join lateral (
     select app.base_factor(l.unit, g.base_unit, si.pack_count, si.pack_qty, si.pack_unit) as factor) c
   where i.id = p_invoice and l.split_at is null and l.superseded_at is null
   order by l.position, l.sub_position
$$;

-- The business date of every receipt, lot and price row of the invoice (plan §3.1.5). The one place
-- the receipt-date variants (V1, V2) change.
create function app.receipt_date(p_invoice uuid) returns date
  language sql stable
  set search_path = ''
as $$
  select i.invoice_date from public.invoice i where i.id = p_invoice
$$;

-- The due date: the invoice's own (extracted or corrected) wins; else the invoice date plus the
-- supplier's payment days; else null with a null source. One row for a known invoice.
create function app.resolve_due_date(p_invoice uuid) returns table (due_date date, source text)
  language sql stable
  set search_path = ''
as $$
  select case when i.due_date is not null then i.due_date
              when s.payment_terms_days is not null and i.invoice_date is not null
              then i.invoice_date + s.payment_terms_days::int end,
         case when i.due_date is not null then 'invoice'
              when s.payment_terms_days is not null and i.invoice_date is not null
              then 'supplier_terms' end
    from public.invoice i
    left join public.supplier s on s.tenant_id = i.tenant_id and s.id = i.supplier_id
   where i.id = p_invoice
$$;

-- The one location of the receipt: the chosen active one, or the only active one. Raises P0001
-- location_not_found (chosen one inactive or not the tenant's), no_location, location_required.
create function app.resolve_location(p_tenant uuid, p_location uuid) returns uuid
  language plpgsql stable
  set search_path = ''
as $$
declare
  v_id uuid;
  v_count int;
begin
  if p_location is not null then
    select x.id into v_id
      from public.location x
     where x.id = p_location and x.tenant_id = p_tenant and x.is_active;
    if not found then
      raise exception 'location_not_found' using errcode = 'P0001';
    end if;
    return v_id;
  end if;
  select count(*), min(x.id::text)::uuid into v_count, v_id
    from public.location x
   where x.tenant_id = p_tenant and x.is_active;
  if v_count = 0 then
    raise exception 'no_location' using errcode = 'P0001';
  elsif v_count > 1 then
    raise exception 'location_required' using errcode = 'P0001';
  end if;
  return v_id;
end
$$;

-- Every reason the invoice cannot be approved now, as [{code, lineIds}] in the order of the gates
-- of plan §3.1.4 (approve_invoice raises the first, the preview lists all). Takes no locks and
-- trusts no stored flag: totals and duplicates are computed now. A status other than review has
-- only its status blocker. Raises P0002 for an unknown invoice.
create function app.approval_blockers(p_invoice uuid, p_location uuid) returns jsonb
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

  if not v.duplicate_override
     and app.find_duplicate_invoice_in(
           v.tenant_id, v.supplier_vat, v.number_raw, v.invoice_date, v.id) is not null then
    v_out := v_out || jsonb_build_object('code', 'duplicate_invoice', 'lineIds', '[]'::jsonb);
  end if;
  if v.duplicate_warning_of is not null and not v.duplicate_override then
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

-- The lines of an approved or rejected invoice always match what was posted (plan §3.1.10): no
-- role, the migration owner included, can change them. Definer, so the status lookup does not
-- depend on the caller's rights.
create function app.invoice_line_frozen() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (select 1 from public.invoice i
              where i.tenant_id = new.tenant_id and i.id = new.invoice_id
                and i.status in ('approved', 'rejected')) then
    raise exception 'invoice_line_frozen' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger invoice_line_frozen
  before update on public.invoice_line
  for each row execute function app.invoice_line_frozen();

revoke all on function
  app.approval_lines(uuid),
  app.receipt_date(uuid),
  app.resolve_due_date(uuid),
  app.resolve_location(uuid, uuid),
  app.approval_blockers(uuid, uuid),
  app.invoice_line_frozen()
  from public, anon, authenticated;
