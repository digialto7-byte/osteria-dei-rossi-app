-- M3 review note: the extraction can read the buyer's VAT number as the supplier's. The worker now
-- nulls a supplier VAT equal to the tenant's own and stores the gate flag `supplier_is_buyer`.
-- The flag list is a CHECK, so it is replaced here (the earlier migration is already applied).
alter table public.invoice
  drop constraint invoice_gate_flags_ck,
  add constraint invoice_gate_flags_ck check (
    gate_flags <@ array['total_mismatch', 'low_confidence', 'supplier_is_buyer']);
