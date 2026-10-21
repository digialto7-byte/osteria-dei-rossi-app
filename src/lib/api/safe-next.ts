const PROBE_ORIGIN = "http://same-origin.invalid";
// Browsers strip tab/newline/CR before resolving a URL, which can turn "/\t/x" into "//x".
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Returns `next` only when it is a same-origin relative path; anything else becomes "/".
 * Prevents open redirects from the magic-link callback (plan §3.11.3).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  if (CONTROL_CHARS.test(next)) return "/";
  const resolved = new URL(next, PROBE_ORIGIN);
  if (resolved.origin !== PROBE_ORIGIN) return "/";
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
