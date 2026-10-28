import { describe, expect, it } from "vitest";
import {
  isInsecureLoopback,
  sessionCookieOptions,
  sessionCookieOptionsFromHeaders,
} from "@/lib/supabase/cookies";

describe("isInsecureLoopback", () => {
  it.each(["localhost", "127.0.0.1", "[::1]", "::1", "LOCALHOST"])(
    "http on %s is the one insecure case",
    (host) => {
      expect(isInsecureLoopback("http:", host)).toBe(true);
      expect(isInsecureLoopback("http", host)).toBe(true);
    },
  );

  it.each(["localhost", "127.0.0.1", "[::1]"])("https on %s stays secure", (host) => {
    expect(isInsecureLoopback("https:", host)).toBe(false);
  });

  it.each([
    "example.test",
    "10.0.0.1",
    "192.168.1.5",
    "localhost.evil.test",
    "evil-localhost",
    "127.0.0.1.nip.io",
    "127.0.0.2",
    "0.0.0.0",
    "",
  ])("http on %s stays secure", (host) => {
    expect(isInsecureLoopback("http:", host)).toBe(false);
  });

  it("any other protocol stays secure", () => {
    expect(isInsecureLoopback("ftp:", "localhost")).toBe(false);
    expect(isInsecureLoopback("", "localhost")).toBe(false);
  });
});

describe("sessionCookieOptions", () => {
  it("is Secure, HttpOnly, SameSite=Lax, Path=/ over https", () => {
    expect(sessionCookieOptions(new URL("https://app.example.test/"))).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it.each(["http://localhost:3000/", "http://127.0.0.1:3000/", "http://[::1]:3000/"])(
    "drops only Secure on plain-http loopback %s",
    (url) => {
      expect(sessionCookieOptions(new URL(url))).toMatchObject({
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
      });
    },
  );

  it.each(["http://example.test/", "http://10.0.0.1:3000/", "http://localhost.evil.test/"])(
    "keeps Secure on plain-http %s",
    (url) => {
      expect(sessionCookieOptions(new URL(url)).secure).toBe(true);
    },
  );
});

describe("sessionCookieOptionsFromHeaders", () => {
  const from = (init: Record<string, string>) => sessionCookieOptionsFromHeaders(new Headers(init));

  it("treats a direct request to localhost (no forwarded proto) as plain http", () => {
    expect(from({ host: "localhost:3000" }).secure).toBe(false);
    expect(from({ host: "127.0.0.1:3000" }).secure).toBe(false);
    expect(from({ host: "[::1]:3000" }).secure).toBe(false);
  });

  it("keeps Secure when the forwarded proto is https, even on localhost", () => {
    expect(from({ host: "localhost:3000", "x-forwarded-proto": "https" }).secure).toBe(true);
  });

  it("uses the first value of a forwarded proto list", () => {
    expect(from({ host: "localhost", "x-forwarded-proto": "http, https" }).secure).toBe(false);
    expect(from({ host: "localhost", "x-forwarded-proto": "https, http" }).secure).toBe(true);
  });

  it("never relaxes a non-loopback host, whatever the forwarded proto says", () => {
    expect(from({ host: "app.example.test", "x-forwarded-proto": "http" }).secure).toBe(true);
    expect(from({ host: "app.example.test" }).secure).toBe(true);
    expect(from({ host: "localhost.evil.test:3000" }).secure).toBe(true);
  });

  it("stays Secure with no host header or a malformed one", () => {
    expect(from({}).secure).toBe(true);
    expect(from({ host: "local host:::" }).secure).toBe(true);
  });
});
