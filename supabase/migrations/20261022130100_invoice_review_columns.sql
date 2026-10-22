-- M4: review columns on invoice and invoice_line, and supplier_item.invoice_unit (M4 plan §3.2).
-- Nothing here widens a grant: authenticated keeps SELECT only on invoice_line and no UPDATE on
-- invoice, invoice_line or supplier_item.invoice_unit. Every write goes through the review
-- procedures (definer, later migrations), so a reviewer can never set corrected_fields or the
-- suggestions directly. Rows are never deleted: a split keeps its parent (split_at) and a re-split
-- marks old children superseded_at.

-- The units a line or a remembered article can be invoiced in (conf = whole purchase packs).
-- Kept as a literal list in each check, like the other enumerations in this schema.

alter table public.invoice
  add column supplier_id uuid,
  -- A name-only match: needs one tap from the reviewer (M2 founder rule: a name match only warns).
  add column supplier_suggestion_id uuid,
  add column header_corrected_fields text[] not null default '{}',
  add column duplicate_override_by uuid references public.app_user (id),
  add column duplicate_override_at timestamptz,
  add constraint invoice_supplier_fk foreign key (tenant_id, supplier_id)
    references public.supplier (tenant_id, id),
  add constraint invoice_supplier_suggestion_fk foreign key (tenant_id, supplier_suggestion_id)
    references public.supplier (tenant_id, id),
  add constraint invoice_header_corrected_fields_ck check (header_corrected_fields <@ array[
    'number_raw', 'invoice_date', 'due_date', 'net_total', 'vat_total', 'gross_total', 'supplier_vat']),
  -- Whoever clears a duplicate flag is recorded with the time. Older writers (M3) set
  -- duplicate_override without a record, so only the actor is tied to the time.
  add constraint invoice_duplicate_override_ck
    check (duplicate_override_by is null or duplicate_override_at is not null);

-- Propagation of a new mapping looks up the other invoices of a supplier that are in review.
create index invoice_supplier_status_idx on public.invoice (tenant_id, supplier_id, status);

alter table public.invoice_line
  add column sub_position smallint not null default 0,
  add column parent_line_id uuid,
  add column split_at timestamptz,
  add column superseded_at timestamptz,
  -- The unit used for the base-quantity preview (and, from M5, for the receipt), and the unit the
  -- auto-mapping proposed (the fixed baseline the correction metric compares against).
  add column unit text,
  add column suggested_unit text,
  add column ingredient_id uuid,
  add column supplier_item_id uuid,
  add column suggested_ingredient_id uuid,
  add column suggested_supplier_item_id uuid,
  add column mapping_source text,
  add column is_stock boolean not null default true,
  add column cost_centre_id uuid,
  -- A short or damaged delivery recorded by the reviewer; M5 computes the payable from it.
  add column credit_qty numeric(12,4) not null default 0,
  add column corrected_fields text[] not null default '{}',
  add column corrected boolean generated always as (cardinality(corrected_fields) > 0) stored,
  add column pack_corrected boolean not null default false,
  add column reviewed_by uuid references public.app_user (id),
  add column reviewed_at timestamptz;

-- Self FK target, then the position key gains the sub-position.
alter table public.invoice_line
  add constraint invoice_line_tenant_id_id_uq unique (tenant_id, id),
  drop constraint invoice_line_position_uq,
  add constraint invoice_line_position_uq
    unique (tenant_id, invoice_id, position, sub_position);

alter table public.invoice_line
  add constraint invoice_line_parent_fk foreign key (tenant_id, parent_line_id)
    references public.invoice_line (tenant_id, id),
  add constraint invoice_line_ingredient_fk foreign key (tenant_id, ingredient_id)
    references public.ingredient (tenant_id, id),
  add constraint invoice_line_supplier_item_fk foreign key (tenant_id, supplier_item_id)
    references public.supplier_item (tenant_id, id),
  add constraint invoice_line_suggested_ingredient_fk foreign key (tenant_id, suggested_ingredient_id)
    references public.ingredient (tenant_id, id),
  add constraint invoice_line_suggested_supplier_item_fk
    foreign key (tenant_id, suggested_supplier_item_id)
    references public.supplier_item (tenant_id, id),
  add constraint invoice_line_cost_centre_fk foreign key (tenant_id, cost_centre_id)
    references public.cost_centre (tenant_id, id),

  add constraint invoice_line_sub_position_ck check (sub_position >= 0),
  add constraint invoice_line_child_ck check ((parent_line_id is null) = (sub_position = 0)),
  add constraint invoice_line_split_at_ck check (split_at is null or parent_line_id is null),
  add constraint invoice_line_superseded_at_ck
    check (superseded_at is null or parent_line_id is not null),
  add constraint invoice_line_unit_ck check (unit in ('kg', 'g', 'l', 'ml', 'pz', 'conf')),
  add constraint invoice_line_suggested_unit_ck
    check (suggested_unit in ('kg', 'g', 'l', 'ml', 'pz', 'conf')),
  add constraint invoice_line_mapping_source_ck check (
    (ingredient_id is null) = (mapping_source is null)
    and coalesce(mapping_source in ('auto', 'manual'), true)),
  -- Non-stock lines are booked to a cost centre and carry no ingredient; stock lines carry none.
  add constraint invoice_line_non_stock_ck check (is_stock or cost_centre_id is not null),
  add constraint invoice_line_non_stock_unmapped_ck
    check (is_stock or (ingredient_id is null and supplier_item_id is null)),
  add constraint invoice_line_stock_no_cost_centre_ck check (not is_stock or cost_centre_id is null),
  add constraint invoice_line_credit_qty_ck check (credit_qty >= 0 and credit_qty <= qty),
  add constraint invoice_line_corrected_fields_ck check (corrected_fields <@ array[
    'qty', 'unit_price', 'line_amount', 'vat_rate', 'supplier_code', 'lot_code', 'expiry', 'unit',
    'ingredient', 'pack']);

-- The unit this article is invoiced in; written only by the review procedure (no new grant).
alter table public.supplier_item
  add column invoice_unit text,
  add constraint supplier_item_invoice_unit_ck
    check (invoice_unit in ('kg', 'g', 'l', 'ml', 'pz', 'conf'));
