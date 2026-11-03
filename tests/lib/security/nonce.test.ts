import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NONCE_PATTERN, createNonce, nonceFromCsp, requireNonce } from "@/lib/security/nonce";

const N = "AAAAAAAAAAAAAAAAAAAAAA==";

describe("createNonce", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives 1,000 pairwise distinct 16-byte base64 values", () => {
    const values = Array.from({ length: 1000 }, () => createNonce());
    expect(new Set(values).size).toBe(1000);
    for (const n of values) {
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(n).toMatch(NONCE_PATTERN);
      expect(Buffer.from(n, "base64").length).toBe(16);
    }
  });

  it("draws 16 bytes from crypto.getRandomValues", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    createNonce();
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0]![0] as Uint8Array;
    expect(arg).toBeInstanceOf(Uint8Array);
    expect(arg.length).toBe(16);
  });
});

describe("requireNonce", () => {
  it("returns the x-nonce header", () => {
    expect(requireNonce(new Headers({ "x-nonce": N }))).toBe(N);
  });

  it("throws csp_nonce_missing when absent or malformed", () => {
    expect(() => requireNonce(new Headers())).toThrow("csp_nonce_missing");
    expect(() => requireNonce(new Headers({ "x-nonce": "abc" }))).toThrow("csp_nonce_missing");
    expect(() => requireNonce(new Headers({ "x-nonce": "x' 'unsafe-inline" }))).toThrow(
      "csp_nonce_missing",
    );
  });
});

describe("nonceFromCsp", () => {
  it("reads the nonce of a page policy", () => {
    expect(
      nonceFromCsp(`default-src 'self'; script-src 'self' 'nonce-${N}' 'strict-dynamic'`),
    ).toBe(N);
  });

  it("is null for a static policy and for null", () => {
    expect(nonceFromCsp("default-src 'self'; script-src 'self'")).toBeNull();
    expect(nonceFromCsp(null)).toBeNull();
  });

  it("ignores a nonce outside script-src", () => {
    expect(nonceFromCsp(`script-src 'self'; style-src 'nonce-${N}'`)).toBeNull();
  });
});

describe("ADR-028 file", () => {
  it("is named for the nonce design, and the static-csp name is gone", () => {
    expect(existsSync(join(process.cwd(), "docs/adr/adr-028-nonce-csp-in-proxy.md"))).toBe(true);
    expect(existsSync(join(process.cwd(), "docs/adr/adr-028-static-csp.md"))).toBe(false);
  });
});
