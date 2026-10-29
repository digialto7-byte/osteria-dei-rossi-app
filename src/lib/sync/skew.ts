import { tn } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { CLOCK_SKEW_WARN_MS } from "@/server/sync/constants";

/**
 * The warning for a phone whose clock is off by more than a minute (M20 plan §3.1.7). `skewMs` is the phone's time minus the
 * server's: positive means the phone is ahead. A wrong clock makes a waiter lose last-write-wins to colleagues, or have stamped
 * writes refused when it is ahead; the person is told to fix it. Null when the clock is fine or unknown.
 */
export function skewNotice(skewMs: number | null, locale: Locale = DEFAULT_LOCALE): string | null {
  if (skewMs === null || Math.abs(skewMs) <= CLOCK_SKEW_WARN_MS) return null;
  const minutes = Math.max(1, Math.round(Math.abs(skewMs) / 60_000));
  return tn(skewMs > 0 ? "sync.skew.ahead" : "sync.skew.behind", minutes, locale);
}
