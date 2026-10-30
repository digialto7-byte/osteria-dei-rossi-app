import { describe, expect, it } from "vitest";
import { OFFLINE_CACHE_PATHS } from "@/lib/api/offline-cache";
import { SW_TIMEOUT_MS } from "@/server/sync/constants";
import { SOURCE } from "./sw-harness";

// The worker is hand-written and ships as served: these checks read its text (M20 plan step 16, ADR-022).
describe("public/sw.js source", () => {
  it.each([
    ["eval(", /\beval\s*\(/],
    ["new Function", /new\s+Function\b/],
    ["importScripts", /importScripts/],
    ["a string timer", /set(Timeout|Interval)\s*\(\s*["'`]/],
    ["skipWaiting", /skipWaiting/],
    ["document.write", /document\.write/],
    ["an import or export statement (it is a classic script)", /^\s*(import|export)\s/m],
  ])("has no %s", (_name, pattern) => {
    expect(SOURCE).not.toMatch(pattern);
  });

  it("its four API paths are the ones the routes mark cacheable (OFFLINE_CACHE_PATHS)", () => {
    const m = /const API_PATHS = \[([^\]]*)\]/.exec(SOURCE);
    expect(m, "API_PATHS not found").not.toBeNull();
    const paths = [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(paths).toEqual([...OFFLINE_CACHE_PATHS]);
  });

  it("its timeout is SW_TIMEOUT_MS", () => {
    const m = /const SW_TIMEOUT_MS = ([0-9_]+);/.exec(SOURCE);
    expect(m, "SW_TIMEOUT_MS not found").not.toBeNull();
    expect(Number(m![1]!.replaceAll("_", ""))).toBe(SW_TIMEOUT_MS);
  });

  it("only GET requests are ever answered, and only the header-marked 200s are stored", () => {
    expect(SOURCE).toMatch(/request\.method !== "GET"/);
    expect(SOURCE).toMatch(/x-offline-cache/);
  });

  it("holds no tenant or user data: no name, no email, no key", () => {
    expect(SOURCE).not.toMatch(/Cameriere|Titolare|@example|supabase|apikey|api_key/i);
  });
});
