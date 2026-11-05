// The staging app host is behind Vercel Authentication. The timing runs (perf-order-entry, perf-dashboard-4g) get through it with
// Vercel's "Protection Bypass for Automation" secret, sent as `x-vercel-protection-bypass`. It comes from the environment only
// (VERCEL_AUTOMATION_BYPASS_SECRET, a secret of the GitHub environment `staging`). Unset or blank sends nothing extra. The value is
// never printed, logged or put in a report.
export const BYPASS_HEADER = "x-vercel-protection-bypass";

type Env = Record<string, string | undefined>;

/** `{ "x-vercel-protection-bypass": <secret> }` when the secret is set and not blank (trimmed), else `{}`. */
export function bypassHeaders(env: Env): Record<string, string> {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  return secret ? { [BYPASS_HEADER]: secret } : {};
}

/** A request's own headers plus the bypass header, if any. The input is not changed. */
export function withBypass(headers: Record<string, string>, env: Env): Record<string, string> {
  return { ...headers, ...bypassHeaders(env) };
}

// Browser contexts do not use `extraHTTPHeaders` (it would send the secret to every origin, Supabase included): see addBypassRoute
// in perf-4g.ts, which adds the header for the app origin only.
