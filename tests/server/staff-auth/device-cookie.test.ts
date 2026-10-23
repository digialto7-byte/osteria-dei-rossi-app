import { describe, expect, it } from "vitest";
import {
  clearDeviceCookie,
  readDeviceToken,
  serializeDeviceCookie,
} from "@/server/staff-auth/device-cookie";

const TOKEN = "A".repeat(43);

describe("device cookie (ADR-010 decision 3)", () => {
  it("is a __Host- cookie: HttpOnly, Secure, SameSite=Strict, Path=/, 400 days, no Domain", () => {
    const header = serializeDeviceCookie(TOKEN);
    const parts = header.split("; ");
    expect(parts[0]).toBe(`__Host-odr_device=${TOKEN}`);
    expect(parts).toEqual(
      expect.arrayContaining([
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
        "Path=/",
        "Max-Age=34560000",
      ]),
    );
    expect(header).not.toMatch(/domain/i);
  });

  it("clearing expires it at once with the same flags", () => {
    const header = clearDeviceCookie();
    expect(header.startsWith("__Host-odr_device=;")).toBe(true);
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Path=/");
    expect(header).toContain("Secure");
    expect(header).toContain("HttpOnly");
    expect(header).not.toMatch(/domain/i);
  });

  it("refuses to serialise anything that is not a device token", () => {
    expect(() => serializeDeviceCookie("a; Domain=evil.test")).toThrow();
    expect(() => serializeDeviceCookie("")).toThrow();
  });

  it("reads the token from the Cookie header among other cookies", () => {
    const request = new Request("http://localhost/api/x", {
      headers: { cookie: `a=1; __Host-odr_device=${TOKEN}; sb-x-auth-token=zzz` },
    });
    expect(readDeviceToken(request)).toBe(TOKEN);
  });

  it.each([
    ["no cookie header", undefined],
    ["another cookie", "a=1"],
    ["an empty value", "__Host-odr_device="],
    ["a short value", "__Host-odr_device=abc"],
    ["a malformed value", `__Host-odr_device=${"!".repeat(43)}`],
    ["a lookalike name", `odr_device=${TOKEN}`],
  ])("returns null for %s", (_label, cookie) => {
    const request = new Request("http://localhost/api/x", {
      headers: cookie === undefined ? {} : { cookie },
    });
    expect(readDeviceToken(request)).toBeNull();
  });
});
