import { describe, expect, it } from "vitest";
import { consolePagePath, hostKind, servedOnHost } from "@/lib/platform/host";

describe("hostKind", () => {
  it("is console only when the host equals CONSOLE_HOST, port included", () => {
    expect(hostKind("127.0.0.1:3000", "127.0.0.1:3000")).toBe("console");
    expect(hostKind("localhost:3000", "127.0.0.1:3000")).toBe("app");
    expect(hostKind("127.0.0.1:3001", "127.0.0.1:3000")).toBe("app");
    expect(hostKind("127.0.0.1", "127.0.0.1:3000")).toBe("app");
    expect(hostKind("console.example.com.evil.test", "console.example.com")).toBe("app");
  });

  it("is app when there is no Host header", () => {
    expect(hostKind(null, "127.0.0.1:3000")).toBe("app");
  });

  it("is always app while CONSOLE_HOST is unset", () => {
    expect(hostKind("127.0.0.1:3000", undefined)).toBe("app");
  });
});

describe("servedOnHost", () => {
  it.each(["/console", "/console/", "/console/locali", "/api/platform", "/api/platform/tenants"])(
    "app host: %s is not served",
    (path) => {
      expect(servedOnHost("app", path)).toBe(false);
    },
  );

  it.each(["/", "/tavoli", "/consolle", "/consoles/x", "/api/platformx", "/api/auth/mfa/account"])(
    "app host: %s is served",
    (path) => {
      expect(servedOnHost("app", path)).toBe(true);
    },
  );

  it.each([
    "/api/platform/tenants",
    "/api/platform/tenants/abc/open",
    "/api/auth/mfa/account",
    "/api/auth/mfa/account/factors",
    "/api/auth/mfa/account/factors/abc/verify",
    "/api/health",
  ])("console host: %s passes", (path) => {
    expect(servedOnHost("console", path)).toBe(true);
  });

  it.each([
    "/api/menu",
    "/api/auth/pin",
    "/api/auth/device",
    "/api/auth/mfa",
    "/api/auth/mfa/accounts",
    "/api/auth/mfa/challenge",
    "/api/health/deep",
    "/api/healthz",
    "/api/platformx",
    "/api/cron/reservation-mail",
    "/api",
    "/console",
    "/console/",
    "/console/locali",
  ])("console host: %s is not served", (path) => {
    expect(servedOnHost("console", path)).toBe(false);
  });
});

describe("servedOnHost: console pages", () => {
  it.each(["/", "/login", "/locali/abc", "/registro", "/consolle"])(
    "console host: %s is served",
    (path) => {
      expect(servedOnHost("console", path)).toBe(true);
    },
  );
});

describe("consolePagePath", () => {
  it("puts the visible path under /console; the root is /console", () => {
    expect(consolePagePath("/")).toBe("/console");
    expect(consolePagePath("/registro")).toBe("/console/registro");
    expect(consolePagePath("/locali/abc")).toBe("/console/locali/abc");
  });
});
