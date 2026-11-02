// A fixed minimum response time for the public sign-in routes (ADR-029, "Timing").
//
// Why: an unknown address answers faster than a known one with a wrong password (Supabase Auth runs bcrypt only
// when the account exists), and the magic-link and code routes differ the same way (a mail is sent only to real
// accounts). Padding every answer to one floor hides that difference.
//
// Which answers are padded is decided in withMinDuration below.
//
// Why 800 ms: a bcrypt check in Auth takes roughly 100 ms, and the round trip from Vercel to Supabase (both EU)
// adds a few hundred ms at the slow end. 800 ms sits above that with margin, and a person typing a password
// does not notice it. An answer that is already slower is returned as it is (never padded further). Supabase's
// own 10-second give-up (src/server/auth/auth-call.ts) stays far above the floor.

export const AUTH_MIN_DURATION_MS = 800;

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The floor for this request. The local e2e stack signs in about 135 times per run, and paying the floor on each
 * pushed the heavy CI job past its cap, so `E2E_AUTH_FLOOR_OFF=1` (set only by playwright.config.ts) turns it off,
 * and only when Supabase runs on this machine. A hosted Supabase (any deployment) always gets the floor, whatever
 * the environment says.
 */
export function authFloorMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  if (env.E2E_AUTH_FLOOR_OFF !== "1") return AUTH_MIN_DURATION_MS;
  try {
    const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
    return LOCAL_HOSTS.has(host) ? 0 : AUTH_MIN_DURATION_MS;
  } catch {
    return AUTH_MIN_DURATION_MS;
  }
}

/** Time and waiting, injectable so tests never really wait. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

async function waitForRest(startedAt: number, floorMs: number, clock: Clock): Promise<void> {
  const remaining = floorMs - (clock.now() - startedAt);
  if (remaining > 0) await clock.sleep(remaining);
}

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
    await waitForRest(startedAt, floorMs, clock);
  }
}

/**
 * Answers that are not padded: the input was rejected before any Auth call (400, 415), or a per-request limit
 * that says nothing about an account (429). A route must never let an account-specific limit out as a 429: the
 * magic-link route turns Supabase's e-mail send limit into its normal 202 (ADR-029, Timing). There is no throttle of our own (plan Q203), so returning these at once also
 * keeps the function time of a flood of bad requests low. Everything else, and every throw, is padded.
 */
const UNPADDED_STATUSES: ReadonlySet<number> = new Set([400, 415, 429]);

/** Wraps a route handler so that every answer that could reveal an account takes at least the floor. */
export function withMinDuration<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
  fixedFloorMs?: number,
  clock: Clock = systemClock,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const floorMs = fixedFloorMs ?? authFloorMs();
    const startedAt = clock.now();
    let response: Response;
    try {
      response = await handler(...args);
    } catch (error) {
      await waitForRest(startedAt, floorMs, clock);
      throw error;
    }
    if (!UNPADDED_STATUSES.has(response.status)) await waitForRest(startedAt, floorMs, clock);
    return response;
  };
}
