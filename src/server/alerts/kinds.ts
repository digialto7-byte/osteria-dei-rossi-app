/**
 * The alert kinds the app knows, mirrored from the database registry `app.alert_kind`. A new kind
 * is three edits in one commit (M6 plan §3.5): an insert into the registry, a template in
 * templates.ts and its texts in both catalogues. The integration parity test fails if the SQL and
 * this list differ (tests/integration/alerts.int.ts).
 */
export const ALERT_KINDS = {
  price_variance: { costBearing: true },
  test_alert: { costBearing: false },
  test_alert_kitchen: { costBearing: false },
} as const satisfies Record<string, { costBearing: boolean }>;

export type AlertKind = keyof typeof ALERT_KINDS;

export const ALERT_KIND_NAMES = Object.keys(ALERT_KINDS) as readonly AlertKind[];

export function isAlertKind(kind: string): kind is AlertKind {
  return Object.hasOwn(ALERT_KINDS, kind);
}
