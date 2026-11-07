/** A CSP nonce: 16 random bytes, base64 encoded (22 characters and `==`). */
export const NONCE_PATTERN = /^[A-Za-z0-9+/]{22}==$/;

/** A fresh 128-bit nonce from the platform's CSPRNG (ADR-028). One per page request. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The nonce the proxy forwarded, or null when there is no `x-nonce` at all (a path the proxy skips: its matcher excludes
 * static assets and images, so a missing `/foo.png` renders not-found without it). A header that is present but empty or
 * malformed still throws `csp_nonce_missing`: the proxy always overwrites it, so that is tampering or a bug.
 */
export function nonceOrNull(headers: Headers): string | null {
  const nonce = headers.get("x-nonce");
  if (nonce === null) return null;
  if (!NONCE_PATTERN.test(nonce)) throw new Error("csp_nonce_missing");
  return nonce;
}

/** The `'nonce-…'` value in a policy's script-src, or null (static policy, no policy, or a malformed value). */
export function nonceFromCsp(csp: string | null): string | null {
  if (!csp) return null;
  const script = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src "));
  const match = script?.match(/'nonce-([^']+)'/);
  return match?.[1] ?? null;
}
