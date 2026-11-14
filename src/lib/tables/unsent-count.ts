/**
 * The number of lines a tile's session has not sent to the kitchen (BQ-1: `session.unsentCount` of /api/tables), or null when it is not
 * known. The count is advisory (Q-B3): a reply from before the deploy, or from a cache, has no field, and that must show nothing, never
 * "0 to send". Only a non-negative integer is a count. Pure.
 */
export function unsentCountOf(session: unknown): number | null {
  if (typeof session !== "object" || session === null) return null;
  const value = (session as Record<string, unknown>).unsentCount;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
