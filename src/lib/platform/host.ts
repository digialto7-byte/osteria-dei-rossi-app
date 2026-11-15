export type HostKind = "app" | "console";

/**
 * The console host is the one whose Host header (name and port) equals CONSOLE_HOST. Unset CONSOLE_HOST: every host is the app (Q-P12).
 * The header, not `request.nextUrl.host`: NextURL rewrites 127.0.0.1 to localhost, and the local console host is 127.0.0.1:3000.
 * The header is the caller's to set; the boundary is Postgres, not the host (R3).
 */
export function hostKind(host: string | null, consoleHost: string | undefined): HostKind {
  return consoleHost !== undefined && host === consoleHost ? "console" : "app";
}

const under = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/** Console pages live under `/console` inside the app (Q-P11); the platform API is `/api/platform/**`. */
export const isConsolePath = (pathname: string) => under(pathname, "/console");
const isPlatformApi = (pathname: string) => under(pathname, "/api/platform");

/** What the console host's API shows: the platform API, the account second factor, and the health check. */
function isConsoleApi(pathname: string): boolean {
  return (
    isPlatformApi(pathname) ||
    under(pathname, "/api/auth/mfa/account") ||
    pathname === "/api/health"
  );
}

/** The internal URL path of a console page: the visible `/<p>` is `/console/<p>`, so `/` is `/console` (Q-P11). */
export const consolePagePath = (visiblePath: string) =>
  visiblePath === "/" ? "/console" : `/console${visiblePath}`;

/**
 * The path as a person or an attacker may have spelled it, for the host decision only: each segment decoded once, repeated slashes
 * collapsed. Null for a malformed escape, which `servedOnHost` answers with 404 (defence in depth: Next does not route encoded names).
 */
export function normalisePath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = pathname.split("/").map(decodeURIComponent).join("/");
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  return decoded.replace(/\/{2,}/g, "/");
}

/** False means the proxy answers 404 (plan §3.5). A typed `/console/**` on the console host would become `/console/console/**`. */
export function servedOnHost(kind: HostKind, rawPathname: string): boolean {
  const pathname = normalisePath(rawPathname);
  if (pathname === null) return false;
  if (kind === "app") return !isConsolePath(pathname) && !isPlatformApi(pathname);
  if (pathname === "/api" || pathname.startsWith("/api/")) return isConsoleApi(pathname);
  return !isConsolePath(pathname);
}
