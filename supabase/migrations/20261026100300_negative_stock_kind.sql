-- M12 step 3: the negative_stock alert kind (M12 plan §3.1.7, §3.2; ADR-011). Not cost-bearing; default
-- audience owner and chef (M6 founder decision: the chef may receive quantity-only kitchen alerts). The
-- payload holds ids, a quantity and a unit only; app.raise_alert enforces that for the chef (20261026100200).
-- A kind is three edits in one commit (M6 rule): this registry row, the template in
-- src/server/alerts/templates.ts and its texts in both catalogues.
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
  values ('negative_stock', false, 'warning', '{owner,chef}');
