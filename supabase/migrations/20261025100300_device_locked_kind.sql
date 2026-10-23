-- M11 step 4: the device_locked alert kind (M11 plan §3.1.11; the M6 kind table). One commit with its
-- template and texts (src/server/alerts), as the M6 rule requires.
--
-- Raised only inside pin_login_finish (20261025100400_pin_login.sql) through app.try_raise_alert when a
-- device reaches 20 failed PIN attempts in 60 minutes. There is no hourly rule, so app.alert_rules_body and
-- app.run_alert_rules are not touched. Not cost-bearing, but owner only by audience: the chef never sees it,
-- and admin and waiter read no alerts. The payload carries the device label and counts, never a staff name.
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience) values
  ('device_locked', false, 'warning', '{owner}');
