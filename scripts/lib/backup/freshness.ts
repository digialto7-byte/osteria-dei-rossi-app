// The weekly restore check proves the daily job ran: the newest copy must be at most 36 hours old (plan §3.1.5.2). It is also
// a second pause signal for a Supabase Free project.

export const MAX_BACKUP_AGE_HOURS = 36;

/** Throws backup_missing for no copy, backup_stale for one older than 36 hours (or dated in the future or unreadable). */
export function assertFresh(newest: { createdTime: string } | null, now: Date): void {
  if (newest === null) throw new Error("backup_missing");
  const ageMs = now.getTime() - Date.parse(newest.createdTime);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_BACKUP_AGE_HOURS * 3_600_000) {
    throw new Error("backup_stale");
  }
}
