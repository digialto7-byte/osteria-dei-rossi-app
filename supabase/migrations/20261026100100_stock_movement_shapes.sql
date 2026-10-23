-- M12 step 1b: shape checks per movement type, the waste reason codes, the reversal guard and the
-- operation index (M12 plan §3.1.2, §3.2; ADR-011). No table is added. Every comparison on the type uses
-- type::text (plan §6 T1). The M5 receipt check and the M5 unique indexes stay as they are.

-- The eight waste reason codes (PRD 2.5). The TS list in src/server/stock/reasons.ts is pinned to the
-- same literal list by pgTAP 090 and reasons.test.ts.
create function app.stock_reason_codes() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array['spoilage', 'expired', 'over_production', 'plating_error', 'staff_meal', 'comp',
               'breakage', 'count_correction']
$$;
revoke all on function app.stock_reason_codes() from public, anon, authenticated, service_role;

-- Consumption and waste take stock out (qty < 0); only a reversal (reverses_id set) adds it back.
alter table public.stock_movement
  add constraint stock_movement_outflow_sign_ck check (
    type::text not in ('consumption', 'waste')
    or (reverses_id is null and qty < 0)
    or (reverses_id is not null and qty > 0)),
  -- A waste has one of the eight reasons; no other type has a reason.
  add constraint stock_movement_reason_ck check (
    (type::text = 'waste') = (reason_code is not null)
    and (reason_code is null or reason_code = any (app.stock_reason_codes()))),
  -- Every non-receipt row belongs to an operation: a ref_type and a ref_id (receipts keep the M5 check).
  add constraint stock_movement_ref_ck check (
    type::text = 'receipt'
    or (ref_type is not null and ref_type ~ '^[a-z_]{1,40}$' and ref_id is not null)),
  -- A transfer moves stock between locations; it has no price.
  add constraint stock_movement_transfer_ck check (
    type::text <> 'transfer'
    or (coalesce(ref_type in ('transfer', 'reversal'), false) and unit_cost is null)),
  add constraint stock_movement_count_ck check (
    type::text <> 'count' or coalesce(ref_type in ('count_session', 'reversal'), false));

-- A reversal row must mirror its original exactly: same tenant, ingredient, location, lot, type, reason
-- and unit_cost, the opposite quantity, and the original is not itself a reversal. Defence in depth: a
-- future procedure bug cannot write a reversal that does not mirror its original. A second reversal of the
-- same row is stopped by the unique index stock_movement_reverses_uq (M5).
create function app.stock_movement_reversal_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  o public.stock_movement;
begin
  select * into o
    from public.stock_movement m
   where m.tenant_id = new.tenant_id and m.id = new.reverses_id;
  if not found
     or o.reverses_id is not null
     or o.ingredient_id <> new.ingredient_id
     or o.location_id <> new.location_id
     or o.raw_lot_id is distinct from new.raw_lot_id
     or o.type <> new.type
     or o.reason_code is distinct from new.reason_code
     or o.unit_cost is distinct from new.unit_cost
     or o.qty <> -new.qty then
    raise exception 'reversal_mismatch' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.stock_movement_reversal_guard() from public, anon, authenticated, service_role;

create trigger stock_movement_reversal_guard
  before insert on public.stock_movement
  for each row when (new.reverses_id is not null)
  execute function app.stock_movement_reversal_guard();

-- Reading an operation: all rows with the same (ref_type, ref_id).
create index stock_movement_ref_idx on public.stock_movement (tenant_id, ref_type, ref_id);
