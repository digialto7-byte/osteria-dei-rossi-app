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

/** For `browser.newContext(...)`: `extraHTTPHeaders` when the secret is set (page and `context.request` both send it), else nothing. */
export function bypassContextOptions(env: Env): { extraHTTPHeaders?: Record<string, string> } {
  const headers = bypassHeaders(env);
  return Object.keys(headers).length > 0 ? { extraHTTPHeaders: headers } : {};
}
