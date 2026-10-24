-- M13 step 7: the ledger_drift alert kind (M13 plan §3.1.10, §3.2; ADR-012). Raised by the nightly invariant check
-- (step 8), at most once per tenant per Rome day. Not cost-bearing, severity critical, audience the owner only (M6:
-- in the app, the owner reads every alert, admin reads none). The payload holds check codes, counts and sample ids,
-- never a name or an amount. A kind is three edits in one commit (M6 rule): this registry row, the template in
-- src/server/alerts/templates.ts and its texts in both catalogues.
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
  values ('ledger_drift', false, 'critical', '{owner}');
