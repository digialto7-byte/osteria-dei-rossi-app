-- M9 step 10: the payable alert kinds (M9 plan §3.2, §3.5; ADR-009). The rules that raise them are in
-- 20261024100300_payable_rules.sql; their templates and texts are in src/server/alerts (the M6 rule: a kind
-- is a registry row, a template and both texts in one commit).
--
-- All four are cost-bearing (they show euro amounts), so the registry, the alert table and
-- app.raise_alert refuse a chef audience, and the default audience is the owner alone (founder decision of
-- 2026-10-23: in-app alerts only, the owner the only recipient; no email).
--   payable_due_7d          7 days before the due date                  (info)
--   payable_due_today       on the due date                             (warning)
--   payable_overdue_3d      3 days after the due date                   (critical)
--   payables_weekly_digest  one per ISO week, unpaid payables by supplier (info)
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience) values
  ('payable_due_7d', true, 'info', '{owner}'),
  ('payable_due_today', true, 'warning', '{owner}'),
  ('payable_overdue_3d', true, 'critical', '{owner}'),
  ('payables_weekly_digest', true, 'info', '{owner}');
