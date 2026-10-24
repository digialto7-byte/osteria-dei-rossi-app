import { addDays } from "@/lib/time/venue-date";

// Fixed clocks of the rules suites (integration and Playwright), shared so the two cannot drift apart. Pure: no clock
// is read here.

/** The Monday strictly after the Rome date `today` (YYYY-MM-DD). A calendar date has no zone, so UTC is exact. */
export function nextMondayAfter(today: string): string {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const ahead = (1 - weekday + 7) % 7 || 7;
  return addDays(today, ahead);
}

/** An instant on the Rome date `date` after the 11:00 cut-off: 14:30 in winter, 15:30 in summer. */
export const afternoonOf = (date: string): string => `${date}T13:30:00Z`;

/** An instant around midday on the Rome date `date`: 11:30 in winter, 12:30 in summer. Same date either way. */
export const middayOf = (date: string): string => `${date}T10:30:00Z`;

/** The first candidate date that is not `avoid`. */
export function dayOtherThan(candidates: string[], avoid: string): string {
  const found = candidates.find((candidate) => candidate !== avoid);
  if (found === undefined) throw new Error("no candidate left");
  return found;
}
