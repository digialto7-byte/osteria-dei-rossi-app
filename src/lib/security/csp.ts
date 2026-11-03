import { readPublicEnv, type Deployment } from "../env";
import { NONCE_PATTERN } from "./nonce";

export type CspInput = {
  supabaseOrigin: string;
  deployment: Deployment;
  dev: boolean;
  /** A page's per-request nonce, or null for the static policy of non-pages (`/api/*`, `/sw.js`, the manifest). */
  nonce: string | null;
};

/** The origin of an http(s) URL; anything else throws, so a bad build setting never reaches a header. */
function originOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("csp_invalid_origin");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("csp_invalid_origin");
  return parsed.origin;
}

/**
 * The Content-Security-Policy of ADR-028. A page (`nonce` set) gets `'nonce-<n>' 'strict-dynamic'`; the static policy
 * (`nonce: null`) gets `script-src 'self'`. `'unsafe-inline'` is never in script-src; `'unsafe-eval'` only under `next dev`.
 * The browser calls only /api/*, so connect-src is 'self'. The nonce is validated, so nothing can be injected into the header.
 */
export function buildCsp({ supabaseOrigin, deployment, dev, nonce }: CspInput): string {
  const supabase = originOf(supabaseOrigin);
  if (nonce !== null && !NONCE_PATTERN.test(nonce)) throw new Error("csp_invalid_nonce");
  const scriptSrc = [
    "script-src 'self'",
    ...(nonce === null ? [] : [`'nonce-${nonce}'`, "'strict-dynamic'"]),
    ...(dev ? ["'unsafe-eval'"] : []),
  ].join(" ");
  const directives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${supabase}`,
    `frame-src ${supabase}`,
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // On http://localhost it would rewrite the local Storage URLs to https.
  if (deployment === "production" || deployment === "preview")
    directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

const DEPLOYMENTS: readonly Deployment[] = ["production", "preview", "development"];

/** The page policy for one request, built at runtime from the environment (the proxy calls this). */
export function cspForRequest(nonce: string, source?: Record<string, string | undefined>): string {
  const env = source ?? process.env;
  const raw = env.VERCEL_ENV;
  let deployment: Deployment = "development";
  if (raw) {
    if (!DEPLOYMENTS.includes(raw as Deployment)) throw new Error("csp_invalid_deployment");
    deployment = raw as Deployment;
  }
  return buildCsp({
    supabaseOrigin: readPublicEnv(source).supabaseUrl,
    deployment,
    dev: env.NODE_ENV === "development",
    nonce,
  });
}
