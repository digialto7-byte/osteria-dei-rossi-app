import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

// The session-refresh proxy must not touch the service worker or the manifest: a signed-out request for them would be redirected
// to /login, and the browser would then fail to install the worker (M20 plan §3.6.3). Pages and /api/* stay matched.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("proxy matcher", () => {
  it.each([
    "/sw.js",
    "/manifest.webmanifest",
    "/_next/static/chunks/a.js",
    "/favicon.ico",
    "/logo.png",
  ])("does not match %s", (path) => {
    expect(matcher.test(path)).toBe(false);
  });

  it.each([
    "/",
    "/tavoli",
    "/tavoli/comanda",
    "/api/sync",
    "/api/menu",
    "/login",
    "/pin",
    "/fatture",
  ])("still matches %s", (path) => {
    expect(matcher.test(path)).toBe(true);
  });

  it("excludes only the exact files, not paths that merely start with their names", () => {
    expect(matcher.test("/sw.json")).toBe(true);
    expect(matcher.test("/sw.js/extra")).toBe(true);
    expect(matcher.test("/manifest.webmanifest.bak")).toBe(true);
  });
});
