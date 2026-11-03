import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BYPASS_HEADER,
  bypassContextOptions,
  bypassHeaders,
  withBypass,
} from "../../scripts/lib/perf-bypass";

// The staging host is behind Vercel Authentication, so the timing runs send the "Protection Bypass for Automation" secret as
// `x-vercel-protection-bypass` when VERCEL_AUTOMATION_BYPASS_SECRET is set. Set, unset and blank; the value is never printed.
const FAKE = "bypass-not-a-secret";
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("bypassHeaders", () => {
  it("is the one header with the secret's value when it is set", () => {
    expect(BYPASS_HEADER).toBe("x-vercel-protection-bypass");
    expect(bypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: FAKE })).toEqual({
      "x-vercel-protection-bypass": FAKE,
    });
  });

  it("is empty when it is unset", () => {
    expect(bypassHeaders({})).toEqual({});
    expect(bypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: undefined })).toEqual({});
  });

  it("is empty when it is blank (an unset secret expands to an empty string in a workflow)", () => {
    expect(bypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: "" })).toEqual({});
    expect(bypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: "   \n" })).toEqual({});
  });

  it("trims the value, so a pasted newline cannot break the header", () => {
    expect(bypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: `  ${FAKE}\n` })).toEqual({
      "x-vercel-protection-bypass": FAKE,
    });
  });
});

describe("withBypass", () => {
  it("adds the header to the request's own headers and keeps them", () => {
    const own = { accept: "application/json", cookie: "a=b" };
    expect(withBypass(own, { VERCEL_AUTOMATION_BYPASS_SECRET: FAKE })).toEqual({
      ...own,
      "x-vercel-protection-bypass": FAKE,
    });
  });

  it("returns the request's headers unchanged when unset or blank, and does not change its input", () => {
    const own = { accept: "application/json" };
    expect(withBypass(own, {})).toEqual(own);
    expect(withBypass(own, { VERCEL_AUTOMATION_BYPASS_SECRET: "" })).toEqual(own);
    withBypass(own, { VERCEL_AUTOMATION_BYPASS_SECRET: FAKE });
    expect(own).toEqual({ accept: "application/json" });
  });
});

describe("bypassContextOptions (Playwright)", () => {
  it("sets extraHTTPHeaders when the secret is set", () => {
    expect(bypassContextOptions({ VERCEL_AUTOMATION_BYPASS_SECRET: FAKE })).toEqual({
      extraHTTPHeaders: { "x-vercel-protection-bypass": FAKE },
    });
  });

  it("has no extraHTTPHeaders key at all when unset or blank: nothing extra is sent", () => {
    expect(bypassContextOptions({})).toEqual({});
    expect(bypassContextOptions({ VERCEL_AUTOMATION_BYPASS_SECRET: " " })).toEqual({});
    expect("extraHTTPHeaders" in bypassContextOptions({})).toBe(false);
  });
});

describe("the three staging callers use it", () => {
  it("the order-entry script adds it to every request to the app", () => {
    const script = read("scripts/perf/order-entry.ts");
    expect(script).toContain('from "../lib/perf-bypass"');
    expect(script).toMatch(/withBypass\(\s*\{[^}]*accept: "application\/json"/);
  });

  it("the dashboard script's browser contexts carry it", () => {
    const script = read("scripts/perf/dashboard-4g.ts");
    expect(script).toContain('from "../lib/perf-bypass"');
    expect(script).toContain("...bypassContextOptions(process.env)");
  });

  it("the Playwright perf spec's contexts carry it", () => {
    const spec = read("e2e/perf/dashboard-4g.spec.ts");
    expect(spec).toContain('from "../../scripts/lib/perf-bypass"');
    expect(spec.match(/\.\.\.bypassContextOptions\(process\.env\)/g)).toHaveLength(2);
  });

  it("none of them prints the secret", () => {
    for (const file of [
      "scripts/lib/perf-bypass.ts",
      "scripts/perf/order-entry.ts",
      "scripts/perf/dashboard-4g.ts",
      "e2e/perf/dashboard-4g.spec.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /(console\.\w+|write(Error)?|stdout\.write)\([^)]*VERCEL_AUTOMATION_BYPASS_SECRET/,
      );
    }
  });
});
