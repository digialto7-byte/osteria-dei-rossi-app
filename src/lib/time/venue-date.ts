import { VENUE_TIME_ZONE } from "@/lib/time/format";

const yearFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: VENUE_TIME_ZONE,
  year: "numeric",
});

/** Calendar year of an instant in venue time (Europe/Rome), e.g. for storage folders. */
export function venueYear(instant: Date): number {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("venueYear: invalid date");
  }
  return Number(yearFormatter.format(instant));
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: VENUE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date ("2026-10-26") of an instant in venue time (Europe/Rome). */
export function venueDate(instant: Date): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("venueDate: invalid date");
  }
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const DAY_MS = 86_400_000;
const dayNumber = (isoDate: string) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);

/** A calendar date plus whole days ("2026-10-26", -29 is "2026-09-27"). No zone is involved. */
export function addDays(isoDate: string, days: number): string {
  return new Date((dayNumber(isoDate) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** How many calendar days from `from` to `to`, both included; 0 when `to` is before `from`. */
export function daysInclusive(from: string, to: string): number {
  return Math.max(0, dayNumber(to) - dayNumber(from) + 1);
}
