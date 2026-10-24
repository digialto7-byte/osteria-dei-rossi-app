-- M16 step 5: the five alert kinds the hourly rules raise (plan §3.2, §3.3; ADR-015). None is cost-bearing: every payload is
-- flat ids, quantities, dates, UTC instants and codes, so it passes app.chef_payload_allowed by construction. Prep, raw-short and
-- expiry go to owner and chef; the purchase alert goes to the owner only (registry default, Q60). Their templates and texts
-- are in src/server/alerts (templates.ts, it.ts, en.ts); the kinds are rows of the registry, never a check constraint.
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience) values
  ('prep_due', false, 'warning', '{owner,chef}'),
  ('prep_raw_short', false, 'warning', '{owner,chef}'),
  ('purchase_due', false, 'warning', '{owner}'),
  ('raw_lot_expiring', false, 'warning', '{owner,chef}'),
  ('batch_expiring', false, 'warning', '{owner,chef}');
