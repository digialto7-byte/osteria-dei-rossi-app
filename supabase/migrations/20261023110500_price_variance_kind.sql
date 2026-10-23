-- M8 step 7: the alert kind price_variance (M8 plan §3.1.9; M6 plan §3.5). An approval that moves an
-- ingredient's price beyond the tenant's threshold raises one such alert per ingredient (step 8).
-- Cost-bearing, so the registry and the alert table forbid a chef audience; the default audience is
-- the owner alone (founder decision: the owner is the only recipient). The template in
-- src/server/alerts/templates.ts and its texts go in with this migration (the M6 rule).
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
  values ('price_variance', true, 'warning', '{owner}');
