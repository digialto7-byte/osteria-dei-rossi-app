import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { base32Decode, freshCode, STEP_SECONDS, totpAt } from "../../e2e/helpers/totp";

// P2-1 A14 (docs/plans/2026-11-12-p2-1-totp.md section 3.9): the TOTP generator of the end-to-end tests, on node:crypto only (no dependency). RFC 6238 Appendix B, SHA-1,
// the secret 12345678901234567890 (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ). The RFC lists 8 digits; the 6-digit codes are their last six digits.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totpAt: RFC 6238 Appendix B vectors, 6 digits", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("T = %i gives %s", (seconds, expected) => {
    expect(totpAt(RFC_SECRET, seconds)).toBe(expected);
  });

  it("the whole step gives the same code and the next step another", () => {
    expect(totpAt(RFC_SECRET, 30)).toBe(totpAt(RFC_SECRET, 59));
    expect(totpAt(RFC_SECRET, 60)).not.toBe(totpAt(RFC_SECRET, 59));
  });

  it("keeps the leading zeros", () => {
    expect(totpAt(RFC_SECRET, 1111111109)).toHaveLength(6);
    expect(totpAt(RFC_SECRET, 1111111109).startsWith("0")).toBe(true);
  });
});

describe("base32Decode (RFC 4648)", () => {
  it("decodes the RFC test secret", () => {
    expect(base32Decode(RFC_SECRET).toString("ascii")).toBe("12345678901234567890");
  });

  it("ignores spaces and lower case, as an authenticator shows the key in groups", () => {
    const grouped = "gezd gnbv gy3t qojq gezd gnbv gy3t qojq";
    expect(base32Decode(grouped).equals(base32Decode(RFC_SECRET))).toBe(true);
    expect(totpAt(grouped, 59)).toBe("287082");
  });

  it("accepts padding", () => {
    expect(base32Decode("MZXW6===").toString("ascii")).toBe("foo");
  });

  it.each(["JBSW1", "JBSW-Y3D", "JBSW!", "0189"])("an invalid character in %s throws", (bad) => {
    expect(() => base32Decode(bad)).toThrow(/base32/i);
  });

  it("an empty key throws", () => {
    expect(() => base32Decode("  ")).toThrow();
  });
});

describe("freshCode: never reuse a step for the same factor", () => {
  // A clock that sleep() advances, so no real time passes.
  const clock = (startMs: number) => {
    let now = startMs;
    const sleeps: number[] = [];
    return {
      now: () => now,
      sleep: vi.fn(async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      }),
      sleeps,
    };
  };

  it("returns the current step's code at once when the step is unused", async () => {
    const c = clock(1111111109 * 1000);
    const fresh = await freshCode(RFC_SECRET, null, c);
    expect(fresh).toEqual({ code: "081804", step: Math.floor(1111111109 / STEP_SECONDS) });
    expect(c.sleep).not.toHaveBeenCalled();
  });

  it("an older used step does not make it wait", async () => {
    const c = clock(1111111109 * 1000);
    const fresh = await freshCode(RFC_SECRET, Math.floor(1111111109 / STEP_SECONDS) - 1, c);
    expect(fresh.step).toBe(Math.floor(1111111109 / STEP_SECONDS));
    expect(c.sleep).not.toHaveBeenCalled();
  });

  it("waits for the next step when the current one was already used, then returns its code", async () => {
    const t = 1111111109;
    const used = Math.floor(t / STEP_SECONDS);
    const c = clock(t * 1000);
    const fresh = await freshCode(RFC_SECRET, used, c);
    expect(c.sleep).toHaveBeenCalledTimes(1);
    expect(fresh.step).toBe(used + 1);
    expect(fresh.code).toBe(totpAt(RFC_SECRET, (used + 1) * STEP_SECONDS));
    // It woke up inside the next step, not before it.
    expect(c.now()).toBeGreaterThanOrEqual((used + 1) * STEP_SECONDS * 1000);
    expect(c.now()).toBeLessThan((used + 2) * STEP_SECONDS * 1000);
  });

  it("two codes in a row for one factor are in different steps", async () => {
    const c = clock(1111111109 * 1000);
    const first = await freshCode(RFC_SECRET, null, c);
    const second = await freshCode(RFC_SECRET, first.step, c);
    expect(second.step).toBe(first.step + 1);
    expect(second.code).not.toBe(first.code);
  });
});

describe("what the helper imports", () => {
  it("only node:crypto, and package.json is unchanged by it", () => {
    const source = readFileSync(new URL("../../e2e/helpers/totp.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import\s.*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports).toEqual(["node:crypto"]);
    expect(source).not.toMatch(/require\(|import\(/);
  });
});
