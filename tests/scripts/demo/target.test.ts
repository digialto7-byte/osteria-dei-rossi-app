import { describe, expect, it } from "vitest";
import { resolveTarget, STAGING_PROJECT_REF } from "../../../scripts/lib/demo/target";

const LOCAL = "http://127.0.0.1:54321";
const STAGING = `https://${STAGING_PROJECT_REF}.supabase.co`;
const OK = { DEMO_STAGING_OK: "yes" };

const resolve = (argv: string[], supabaseUrl: string, env: Record<string, string> = {}) =>
  resolveTarget({ argv, env, supabaseUrl });

describe("resolveTarget: local by default", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321"])("accepts %s", (url) => {
    expect(resolve([], url)).toEqual({ target: "local", mode: "seed" });
    expect(resolve(["--target", "local"], url)).toEqual({ target: "local", mode: "seed" });
  });

  it("refuses a hosted URL when no target is given", () => {
    expect(() => resolve([], STAGING, OK)).toThrow(/not the local stack/);
    expect(() => resolve([], "https://example.test")).toThrow(/not the local stack/);
  });

  it("refuses an unparseable URL", () => {
    expect(() => resolve([], "not a url")).toThrow(/not the local stack/);
  });

  it("refuses --target local with a hosted URL", () => {
    expect(() => resolve(["--target", "local"], STAGING, OK)).toThrow(/not the local stack/);
  });
});

describe("resolveTarget: staging", () => {
  it("needs the opt-in", () => {
    expect(() => resolve(["--target", "staging"], STAGING)).toThrow(/DEMO_STAGING_OK/);
    expect(() => resolve(["--target", "staging"], STAGING, { DEMO_STAGING_OK: "true" })).toThrow(
      /DEMO_STAGING_OK/,
    );
    expect(() => resolve(["--target", "staging"], STAGING, { DEMO_STAGING_OK: "YES" })).toThrow(
      /DEMO_STAGING_OK/,
    );
  });

  it("accepts the exact staging host with the opt-in", () => {
    expect(resolve(["--target", "staging"], STAGING, OK)).toEqual({
      target: "staging",
      mode: "seed",
    });
    expect(resolve(["--target", "staging"], `${STAGING}/`, OK).target).toBe("staging");
  });

  it.each([
    ["a look-alike suffix", `${STAGING}.evil.test`],
    ["a look-alike prefix", `https://x${STAGING_PROJECT_REF}.supabase.co`],
    ["a sub-domain", `https://evil.${STAGING_PROJECT_REF}.supabase.co`],
    ["a port", `${STAGING}:8443`],
    ["the default port written out", `${STAGING}:443`],
    ["plain http", `http://${STAGING_PROJECT_REF}.supabase.co`],
    ["another project ref", "https://abcdefghijklmnopqrst.supabase.co"],
    ["credentials in the URL", `https://user:pw@${STAGING_PROJECT_REF}.supabase.co`],
    ["a path", `${STAGING}/rest/v1`],
    ["a query", `${STAGING}/?x=1`],
    ["the local URL", LOCAL],
    ["garbage", "staging"],
  ])("refuses %s", (_label, url) => {
    expect(() => resolve(["--target", "staging"], url, OK)).toThrow();
  });

  it("never repeats the URL or the opt-in value in a message", () => {
    const urls = [
      `${STAGING}.evil.test`,
      "https://user:secret-pw@example.test",
      LOCAL,
      "https://abcdefghijklmnopqrst.supabase.co",
    ];
    for (const url of urls) {
      for (const argv of [[], ["--target", "staging"]]) {
        try {
          resolve(argv, url, { DEMO_STAGING_OK: "maybe-secret" });
        } catch (error) {
          const message = (error as Error).message;
          expect(message).not.toContain(url);
          expect(message).not.toContain("secret-pw");
          expect(message).not.toContain("maybe-secret");
          expect(message).not.toContain("evil.test");
        }
      }
    }
  });
});

describe("resolveTarget: modes and flags", () => {
  it.each([
    [["--reset"], "reset"],
    [["--purge"], "purge"],
    [["--cleanup"], "cleanup"],
    [[], "seed"],
  ] as const)("%j is mode %s", (argv, mode) => {
    expect(resolve([...argv], LOCAL).mode).toBe(mode);
  });

  it("combines a mode with the target", () => {
    expect(resolve(["--target", "staging", "--cleanup"], STAGING, OK)).toEqual({
      target: "staging",
      mode: "cleanup",
    });
  });

  it("refuses two modes, an unknown flag, an unknown target and a stray argument", () => {
    expect(() => resolve(["--reset", "--purge"], LOCAL)).toThrow(/only one of/);
    expect(() => resolve(["--cleanup", "--purge"], LOCAL)).toThrow(/only one of/);
    expect(() => resolve(["--force"], LOCAL)).toThrow();
    expect(() => resolve(["--target", "production"], LOCAL)).toThrow(/local or staging/);
    expect(() => resolve(["--target", "prod"], LOCAL, OK)).toThrow(/local or staging/);
    expect(() => resolve(["seed"], LOCAL)).toThrow();
    expect(() => resolve(["--target"], LOCAL)).toThrow();
  });
});
