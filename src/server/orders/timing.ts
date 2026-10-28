// The Server-Timing header of the order routes (M18 plan §3.4, §3.9): where the time of one call goes, so the AT7
// measurement can tell the session check (`auth`) from the database call (`rpc`). Durations only; no value, id or name.

export interface ApiTiming {
  startedAt: number;
  authDoneAt: number;
}

const defaultNow = () => performance.now();

const one = (ms: number) => (Number.isFinite(ms) && ms > 0 ? ms : 0).toFixed(1);

export function formatServerTiming(parts: { auth: number; rpc: number; total: number }): string {
  return `auth;dur=${one(parts.auth)}, rpc;dur=${one(parts.rpc)}, total;dur=${one(parts.total)}`;
}

/** Runs the database call and returns its result with the header for the response. A failure passes through. */
export async function measured<T>(
  timing: ApiTiming,
  run: () => Promise<T>,
  now: () => number = defaultNow,
): Promise<{ result: T; header: string }> {
  const rpcStart = now();
  const result = await run();
  const end = now();
  return {
    result,
    header: formatServerTiming({
      auth: timing.authDoneAt - timing.startedAt,
      rpc: end - rpcStart,
      total: end - timing.startedAt,
    }),
  };
}

/** A JSON response with the Server-Timing header. */
export function timedJson(body: unknown, header: string, status = 200): Response {
  return Response.json(body, { status, headers: { "server-timing": header } });
}
