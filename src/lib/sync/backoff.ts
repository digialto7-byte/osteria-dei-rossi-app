import { SYNC_BACKOFF_BASE_MS, SYNC_BACKOFF_MAX_MS } from "@/server/sync/constants";

/**
 * How long to wait after the `failures`-th failed attempt in a row (M20 plan §3.1.7): 1 s, 2 s, 4 s, 8 s, then 15 s, each
 * moved by a random factor between 0,8 and 1,2 so the phones of a venue do not retry in step. `random` is injected.
 */
export function backoffDelay(failures: number, random: () => number): number {
  const exponent = Math.max(0, Math.min(failures, 30) - 1);
  const base = Math.min(SYNC_BACKOFF_MAX_MS, SYNC_BACKOFF_BASE_MS * 2 ** exponent);
  return Math.round(base * (0.8 + 0.4 * random()));
}
