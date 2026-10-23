/**
 * The chef-payload allow-list, mirrored from `app.chef_payload_allowed` (migration
 * 20261026100200_chef_payload_allowlist.sql). An alert that reaches the chef holds ids, quantities, dates,
 * units and codes only: every key, at any depth, ends in _id, _key, _qty, _count, _hours, _days, _date or
 * _at (after a lower-case snake_case stem) or is exactly `unit`; every string value is a uuid, a date, an
 * ISO instant or a code. Tested with the same vector table as pgTAP 091: keep the two in agreement.
 */
const KEY = /^[a-z][a-z0-9_]{0,40}(_id|_key|_qty|_count|_hours|_days|_date|_at)$/;
const TOKENS: readonly RegExp[] = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$/,
  /^[a-z][a-z0-9_]{0,39}$/,
];

function nodeAllowed(node: unknown): boolean {
  if (typeof node === "string") return TOKENS.some((token) => token.test(node));
  if (Array.isArray(node)) return node.every(nodeAllowed);
  if (node !== null && typeof node === "object") {
    return Object.entries(node).every(
      ([key, value]) => (KEY.test(key) || key === "unit") && nodeAllowed(value),
    );
  }
  return true;
}

/** True when `payload` is an object that a chef-audience alert may carry. */
export function chefPayloadAllowed(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return false;
  return nodeAllowed(payload);
}
