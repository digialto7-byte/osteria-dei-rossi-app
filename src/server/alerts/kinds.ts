/**
 * The alert kinds the app knows, mirrored from the database registry `app.alert_kind`. A new kind
 * is three edits in one commit (M6 plan §3.5): an insert into the registry, a template in
 * templates.ts and its texts in both catalogues. The integration parity test fails if the SQL and
 * this list differ (tests/integration/alerts.int.ts).
 */
export const ALERT_KINDS = {
  device_locked: { costBearing: false },
  ledger_drift: { costBearing: false },
  negative_stock: { costBearing: false },
  payable_due_7d: { costBearing: true },
  payable_due_today: { costBearing: true },
  payable_overdue_3d: { costBearing: true },
  payables_weekly_digest: { costBearing: true },
  price_variance: { costBearing: true },
  test_alert: { costBearing: false },
  test_alert_kitchen: { costBearing: false },
} as const satisfies Record<string, { costBearing: boolean }>;

export type AlertKind = keyof typeof ALERT_KINDS;

export const ALERT_KIND_NAMES = Object.keys(ALERT_KINDS) as readonly AlertKind[];

export function isAlertKind(kind: string): kind is AlertKind {
  return Object.hasOwn(ALERT_KINDS, kind);
}
