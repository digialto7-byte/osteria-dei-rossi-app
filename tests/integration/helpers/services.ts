import type { DayServices } from "@/server/services/output";

// Helpers of the M25c integration suite (fake data only). Tables open at the real clock, so the suite never expects a time-derived key: it reads the key
// of each table from /api/day-close/services and moves tables with overrides.

type Session = DayServices["sessions"][number];

/** A key the session can be moved to other than the one it has now (the version in force always offers at least two). */
export function otherChoice(session: Session): string {
  const other = session.choices.find((key) => key !== session.serviceKey);
  if (!other) throw new Error("the table has only one service to choose from");
  return other;
}

/** Euro amounts as whole cents, so a sum of replies compares exactly. */
export const cents = (amount: number): number => Math.round(amount * 100);

/** The sessions of a day reply by id. */
export function byId(day: DayServices): Map<string, Session> {
  return new Map(day.sessions.map((s) => [s.sessionId, s]));
}
