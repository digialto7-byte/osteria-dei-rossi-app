-- Opening stock, step 4 (docs/plans/2026-11-18-opening-stock.md §3.1, M2): the shape of an `opening` ledger row. One CHECK, no other change to stock_movement
-- (columns, indexes, triggers and the other CHECKs stay as they are). It compares type::text, as 20261026100100 does, so it does not depend on the enum value of the
-- previous migration being committed in the same transaction.
--   * an opening row (a carico: the stock a venue already holds on its first day) is unlotted, has no reason, and carries a unit cost that is stated: not null, 0 or more;
--   * it is either the carico itself (qty > 0, ref_type 'opening', reverses_id null) or its mirror (qty < 0, ref_type 'reversal', reverses_id set); a mirror must also pass
--     app.stock_movement_reversal_guard (same ingredient, location, null lot, type, null reason and equal unit_cost, opposite qty);
--   * the first branch stops any other type from borrowing ref_type 'opening';
--   * reason_code is null and ref_id is not null are already required by stock_movement_reason_ck and stock_movement_ref_ck; they are repeated here only where the shape depends on them.
-- Nothing writes an opening row yet (the booking procedure comes in a later step). The CHECK is added with the table's existing rows validated: none has type opening.
alter table public.stock_movement
  add constraint stock_movement_opening_ck check (
    (type::text <> 'opening' and coalesce(ref_type, '') <> 'opening')
    or (type::text = 'opening'
        and raw_lot_id is null
        and reason_code is null
        and unit_cost is not null and unit_cost >= 0
        and ((reverses_id is null and ref_type = 'opening' and qty > 0)
             or (reverses_id is not null and ref_type = 'reversal' and qty < 0))));
