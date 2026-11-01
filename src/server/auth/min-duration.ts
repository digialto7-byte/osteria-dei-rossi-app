// A fixed minimum response time for the public sign-in routes (ADR-029, "Timing").
//
// Why: an unknown address answers faster than a known one with a wrong password (Supabase Auth runs bcrypt only
// when the account exists), and the magic-link and code routes differ the same way (a mail is sent only to real
// accounts). Padding every answer to one floor hides that difference.
//
// Why 800 ms: a bcrypt check in Auth takes roughly 100 ms, and the round trip from Vercel to Supabase (both EU)
// adds a few hundred ms at the slow end. 800 ms sits above that with margin, and a person typing a password
// does not notice it. An answer that is already slower is returned as it is (never padded further). Supabase's
// own 10-second give-up (src/server/auth/auth-call.ts) stays far above the floor.

export const AUTH_MIN_DURATION_MS = 800;

/** Time and waiting, injectable so tests never really wait. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Runs `work`, then waits until `floorMs` have passed since the start, on success and on error alike. */
export async function padToMinimum<T>(
  work: () => Promise<T>,
  floorMs: number = AUTH_MIN_DURATION_MS,
  clock: Clock = systemClock,
): Promise<T> {
  const startedAt = clock.now();
  try {
    return await work();
  } finally {
    const remaining = floorMs - (clock.now() - startedAt);
    if (remaining > 0) await clock.sleep(remaining);
  }
}

/** Wraps a route handler so that every answer (200, 4xx, 429, 5xx, or a throw) takes at least the floor. */
export function withMinDuration<Args extends unknown[], R>(
  handler: (...args: Args) => Promise<R>,
  floorMs: number = AUTH_MIN_DURATION_MS,
  clock: Clock = systemClock,
): (...args: Args) => Promise<R> {
  return (...args) => padToMinimum(() => handler(...args), floorMs, clock);
}
