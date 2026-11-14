import { SANDBOX_CSP } from "../security-headers";
import { nonceFromCsp } from "./nonce";

export type Expect = "local" | "preview" | "production";
/** A fixed fake id: the signed-out request is refused with a 401 that still carries the config headers. */
export const ORIGINAL_PATH = "/api/invoices/00000000-0000-4000-8000-000000000000/original";
/** The e-invoice original's policy (defined once, next to the other header values). */
export { SANDBOX_CSP };
export type CheckedPath = "/login" | "/api/health" | "/sw.js" | typeof ORIGINAL_PATH;
export type Finding = { path: CheckedPath; header: string; problem: string };

type Replies = {
  "/login": [Headers, Headers];
  "/api/health": Headers;
  "/sw.js": Headers;
  [ORIGINAL_PATH]: Headers;
};

// The policy each path must carry: a page one (nonce), the static one, or exactly the sandbox.
type PolicyKind = "page" | "static" | "sandbox";
const POLICY_OF: Record<CheckedPath, PolicyKind> = {
  "/login": "page",
  "/api/health": "static",
  "/sw.js": "static",
  [ORIGINAL_PATH]: "sandbox",
};

const CSP = "content-security-policy";
const HSTS = "strict-transport-security";
const MIN_HSTS_SECONDS = 31_536_000;
const MIN_NONCE_BYTES = 16;
const STYLE_NOTE = "style-src unsafe-inline (ADR-028)";

// Directives that must be present exactly, on every checked response (ADR-028).
const REQUIRED_DIRECTIVES = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "connect-src 'self'",
];

const PLAIN_HEADERS: [string, string][] = [
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["x-frame-options", "DENY"],
];

function nonceBytes(nonce: string): number {
  try {
    return atob(nonce).length;
  } catch {
    return 0;
  }
}

/**
 * The header rules of ADR-028 on the replies for `/login` (twice), `/api/health`, `/sw.js` and the e-invoice original. Pure: the caller
 * fetches. Findings name the path, the header and a short problem code, never a header value or a nonce.
 */
export function checkHeaders(
  replies: Replies,
  expectation: Expect,
): { findings: Finding[]; notes: string[] } {
  const findings: Finding[] = [];
  const notes: string[] = [];
  const add = (path: CheckedPath, header: string, problem: string) => {
    if (!findings.some((f) => f.path === path && f.header === header && f.problem === problem)) {
      findings.push({ path, header, problem });
    }
  };

  const checkOne = (path: CheckedPath, h: Headers): string | null => {
    for (const [name, expected] of PLAIN_HEADERS) {
      const value = h.get(name);
      if (value === null) add(path, name, "missing");
      else if (value !== expected) add(path, name, "unexpected");
    }

    if (expectation === "production") {
      const hsts = h.get(HSTS);
      if (hsts === null) add(path, HSTS, "missing");
      else {
        const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0);
        if (maxAge < MIN_HSTS_SECONDS) add(path, HSTS, "max_age_short");
        if (!/includeSubDomains/i.test(hsts)) add(path, HSTS, "include_subdomains_missing");
      }
    }

    const csp = h.get(CSP);
    if (csp === null) {
      add(path, CSP, "csp_missing");
      return null;
    }
    // The runtime joins repeated headers with ", ": a policy never contains that, so two policies were sent.
    if (csp.includes(", ")) {
      add(path, CSP, "multiple_csp");
      return null;
    }

    if (POLICY_OF[path] === "sandbox") {
      if (csp !== SANDBOX_CSP) add(path, CSP, "csp_not_sandbox");
      return null;
    }

    const directives = csp.split(";").map((d) => d.trim());
    for (const required of REQUIRED_DIRECTIVES) {
      if (!directives.includes(required)) add(path, CSP, `missing_${required.split(" ")[0]}`);
    }
    if (csp.includes("'unsafe-eval'")) add(path, CSP, "unsafe_eval");

    const style = directives.find((d) => d.startsWith("style-src "));
    if (style?.split(" ").includes("'unsafe-inline'") && !notes.includes(STYLE_NOTE)) {
      notes.push(STYLE_NOTE);
    }

    const script = directives.find((d) => d.startsWith("script-src "));
    if (!script) {
      add(path, CSP, "script_src_missing");
      return null;
    }
    const tokens = script.split(" ").slice(1);
    if (tokens.includes("'unsafe-inline'")) add(path, CSP, "script_unsafe_inline");
    if (tokens.some((t) => !t.startsWith("'"))) add(path, CSP, "script_origin");
    const nonce = nonceFromCsp(csp);

    if (POLICY_OF[path] === "page") {
      if (nonce === null) add(path, CSP, "nonce_missing");
      else if (nonceBytes(nonce) < MIN_NONCE_BYTES) add(path, CSP, "nonce_short");
      if (!tokens.includes("'strict-dynamic'")) add(path, CSP, "strict_dynamic_missing");
      if (!tokens.includes("'self'")) add(path, CSP, "self_missing");
    } else if (tokens.length !== 1 || tokens[0] !== "'self'") {
      add(path, CSP, "script_src_not_self_only");
    }
    return nonce;
  };

  const [first, second] = replies["/login"];
  const nonceA = checkOne("/login", first);
  const nonceB = checkOne("/login", second);
  if (nonceA !== null && nonceA === nonceB) add("/login", CSP, "nonce_reused");
  checkOne("/api/health", replies["/api/health"]);
  checkOne("/sw.js", replies["/sw.js"]);
  checkOne(ORIGINAL_PATH, replies[ORIGINAL_PATH]);

  return { findings, notes };
}
