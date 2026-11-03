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

/** The nonce the proxy forwarded in `x-nonce`; throws when the proxy did not run, so a page fails closed. */
export function requireNonce(headers: Headers): string {
  const nonce = headers.get("x-nonce");
  if (!nonce || !NONCE_PATTERN.test(nonce)) throw new Error("csp_nonce_missing");
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
