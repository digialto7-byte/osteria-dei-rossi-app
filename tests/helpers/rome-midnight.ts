// Guard for suites that raise the same alert twice and expect one row: the dedup key holds the Europe/Rome
// business date (plan 3.1.4), so two calls on either side of 00:00 in Rome make two rows. Midnight is never
// inside a DST change (those happen at 02:00 and 03:00 local), so the wall clock is enough.
const ROME = "Europe/Rome";

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ROME,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Minutes from `now` to the next 00:00 in Europe/Rome (1440 right at midnight). */
export function minutesToRomeMidnight(now: Date = new Date()): number {
  const part = (type: string) =>
    Number(clockFormat.formatToParts(now).find((p) => p.type === type)?.value);
  const sinceMidnight = part("hour") * 60 + part("minute") + part("second") / 60;
  return 24 * 60 - sinceMidnight;
}

/** The venue calendar date of `now` (YYYY-MM-DD), the alert's business date. */
export function romeDate(now: Date = new Date()): string {
  return dateFormat.format(now);
}

interface WaitOptions {
  /** Wait only when midnight is closer than this many minutes. */
  thresholdMinutes?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * If Rome midnight is under `thresholdMinutes` (default 2) away, sleeps until just after it, so the
 * dedup assertions that follow cannot straddle two business dates. Returns the milliseconds waited.
 */
export async function waitPastRomeMidnight({
  thresholdMinutes = 2,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: WaitOptions = {}): Promise<number> {
  const minutes = minutesToRomeMidnight(now());
  if (minutes >= thresholdMinutes) return 0;
  const ms = Math.ceil(minutes * 60_000) + 1_000;
  await sleep(ms);
  return ms;
}
