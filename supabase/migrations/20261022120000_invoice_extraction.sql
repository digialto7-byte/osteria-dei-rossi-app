-- M3: extraction columns on invoice and the invoice_line table (plan §3.5.1, M3 plan §3).
-- Owner/admin read them through the existing table SELECT and RLS. Nothing here widens a grant:
-- the columns are written only by the extraction procedures (service role, next migration).

alter table public.invoice
  add column due_date date,
  add column payment_terms text,
  add column net_total numeric(12,4),
  add column vat_total numeric(12,4),
  add column gross_total numeric(12,4),
  -- Σ line_amount + vat_total − gross_total, in euros; null when a total is missing.
  add column totals_diff numeric(12,4),
  add column gate_flags text[] not null default '{}',
  add column field_confidence jsonb,
  -- The validated, normalised model output. The raw output of a rejected response is never stored.
  add column extraction_json jsonb,
  -- The model ID used (from EXTRACTION_MODEL_ID), for traceability of model changes.
  add column extraction_model text,
  add column attempts smallint not null default 0,
  add column next_attempt_at timestamptz,
  add column extraction_started_at timestamptz,
  add column extracted_at timestamptz,
  -- Lease id of the running extraction; only the service-role procedures use it.
  add column claim_token uuid,
  add column extraction_error text,
  add constraint invoice_payment_terms_ck check (length(payment_terms) between 1 and 200),
  add constraint invoice_totals_ck check (
    net_total between 0 and 10000000 and vat_total between 0 and 10000000
    and gross_total between 0 and 10000000),
  add constraint invoice_gate_flags_ck check (gate_flags <@ array['total_mismatch', 'low_confidence']),
  add constraint invoice_extraction_model_ck check (length(extraction_model) between 1 and 100),
  add constraint invoice_attempts_ck check (attempts between 0 and 10),
  add constraint invoice_extraction_error_ck check (extraction_error in (
    'provider_timeout', 'provider_unavailable', 'provider_rate_limited', 'provider_auth',
    'provider_rejected', 'refused', 'output_truncated', 'schema_invalid',
    'file_mismatch', 'storage_unavailable', 'store_failed', 'lease_expired'));

-- The worker looks for waiting invoices and stale leases.
create index invoice_extract_queue_idx
  on public.invoice (status, next_attempt_at)
  where status in ('received', 'extracting');

create table public.invoice_line (
  id uuid primary key default gen_random_uuid(),
  -- No default: the extraction procedure runs as the service role and sets it explicitly.
  tenant_id uuid not null,
  invoice_id uuid not null,
  position smallint not null,
  raw_description text not null,
  supplier_code text,
  qty numeric(12,4) not null,
  -- As printed on the invoice; mapped to measure_unit in M4.
  unit_raw text,
  unit_price numeric(12,4),
  line_amount numeric(12,4) not null,
  vat_rate numeric(5,2),
  lot_code text,
  expiry date,
  field_confidence jsonb not null,
  checks text[] not null default '{}',
  -- What the model returned for this line (the M4 correction baseline).
  extracted jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_user (id),
  constraint invoice_line_invoice_fk foreign key (tenant_id, invoice_id)
    references public.invoice (tenant_id, id),
  constraint invoice_line_position_uq unique (tenant_id, invoice_id, position),
  constraint invoice_line_position_ck check (position >= 1),
  constraint invoice_line_description_ck check (length(raw_description) between 1 and 500),
  constraint invoice_line_supplier_code_ck check (length(supplier_code) between 1 and 64),
  constraint invoice_line_qty_ck check (qty >= 0),
  constraint invoice_line_unit_raw_ck check (length(unit_raw) between 1 and 20),
  constraint invoice_line_unit_price_ck check (unit_price >= 0),
  constraint invoice_line_amount_ck check (line_amount >= 0),
  constraint invoice_line_vat_rate_ck check (vat_rate between 0 and 100),
  constraint invoice_line_lot_code_ck check (length(lot_code) between 1 and 64),
  constraint invoice_line_checks_ck check (checks <@ array['amount_mismatch', 'vat_rate_unexpected'])
);

alter table public.invoice_line enable row level security;

revoke all on public.invoice_line from anon, authenticated;
revoke delete, truncate on public.invoice_line from service_role;
grant select on public.invoice_line to authenticated;

create policy invoice_line_select on public.invoice_line
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
