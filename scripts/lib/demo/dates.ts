// Demo data (docs/plans/2026-10-24-demo-data.md §3.1.8): every fixture date is an offset from "today in Rome".
// Calendar arithmetic on the date, never milliseconds, so a daylight-saving change cannot shift a day.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const romeFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date (YYYY-MM-DD) in Europe/Rome at this instant. */
export function romeToday(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error("romeToday: invalid date");
  const parts = Object.fromEntries(romeFormat.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** `isoDate` plus `n` calendar days (negative allowed). */
export function addDays(isoDate: string, n: number): string {
  if (!Number.isInteger(n)) throw new Error("addDays: n must be an integer");
  const match = ISO_DATE.exec(isoDate);
  if (!match) throw new Error("addDays: expected a date as YYYY-MM-DD");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error("addDays: expected a date as YYYY-MM-DD");
  }
  return new Date(Date.UTC(year, month - 1, day + n)).toISOString().slice(0, 10);
}
