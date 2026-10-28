import { describe, expect, it } from "vitest";
import { buildReport, formatReport, maskEmail } from "../../../scripts/lib/demo/report";

describe("maskEmail", () => {
  it.each([
    ["titolare.demo@example.test", "t***@e***.test"],
    ["anna.demo@posta.example.org", "a***@p***.org"],
    ["a@b.co", "a***@b***.co"],
    ["Mixed.Case@Mail.Example.org", "M***@M***.org"],
  ])("%s becomes %s", (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });

  it.each(["", "no-at-sign", "@nolocal.test", "local@", "local@nodot", "a@@b.test"])(
    "masks %j without leaking it",
    (input) => {
      const masked = maskEmail(input);
      expect(masked).toBe("***");
    },
  );
});

const TENANT = "11111111-1111-4111-8111-111111111111";

describe("buildReport and formatReport", () => {
  it("builds the one-line shape of the plan", () => {
    const report = buildReport({
      target: "local",
      mode: "seed",
      ok: true,
      tenantId: TENANT,
      counts: { invoice: 5, stock_movement: 12 },
      logins: [
        { role: "owner", name: "Titolare (demo)", email: "titolare.demo@example.test" },
        { role: "chef", name: "Chef Bruno (demo)" },
      ],
      alerts: ["prep_due", "purchase_due"],
    });
    expect(report).toEqual({
      target: "local",
      mode: "seed",
      ok: true,
      counts: { invoice: 5, stock_movement: 12 },
      logins: [
        { role: "owner", name: "Titolare (demo)", email: "t***@e***.test" },
        { role: "chef", name: "Chef Bruno (demo)" },
      ],
      alerts: ["prep_due", "purchase_due"],
    });
    const line = formatReport(report);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual(report);
    expect(line).not.toContain("titolare.demo@example.test");
  });

  it("keeps only the known fields: a password, a token or a key on the input never reaches the output", () => {
    const secrets = [
      "FAKE-PASSWORD-9f3a",
      "FAKE-TOKEN-77c1",
      "FAKE-SECRET-KEY-02bd",
      "FAKE-PIN-4821",
    ];
    const dirty = {
      target: "staging",
      mode: "reset",
      ok: false,
      tenantId: TENANT,
      counts: { invoice: 5, password: "FAKE-PASSWORD-9f3a" },
      logins: [
        {
          role: "owner",
          name: "Titolare (demo)",
          email: "boss@example.test",
          password: "FAKE-PASSWORD-9f3a",
          token: "FAKE-TOKEN-77c1",
          pin: "FAKE-PIN-4821",
        },
      ],
      alerts: ["prep_due", "FAKE-TOKEN-77c1 with spaces"],
      error: "FAKE-SECRET-KEY-02bd leaked in a message",
      secretKey: "FAKE-SECRET-KEY-02bd",
      password: "FAKE-PASSWORD-9f3a",
    };
    const line = formatReport(buildReport(dirty as never));
    for (const secret of secrets) expect(line).not.toContain(secret);
    expect(line).not.toContain("boss@example.test");
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ["alerts", "counts", "error", "logins", "mode", "ok", "target"].sort(),
    );
    expect(parsed.error).toBe("failed");
    expect(parsed.counts).toEqual({ invoice: 5 });
    expect(parsed.alerts).toEqual(["prep_due"]);
  });

  it("carries an error only as a short code", () => {
    const withCode = buildReport({
      target: "local",
      mode: "seed",
      ok: false,
      tenantId: null,
      counts: {},
      logins: [],
      alerts: [],
      error: "demo_tenant_exists",
    });
    expect(withCode.error).toBe("demo_tenant_exists");
    const withText = buildReport({
      target: "local",
      mode: "seed",
      ok: false,
      tenantId: null,
      counts: {},
      logins: [],
      alerts: [],
      error: "Something with spaces and https://x.test/?key=abc",
    });
    expect(withText.error).toBe("failed");
    expect(JSON.stringify(withText)).not.toContain("abc");
  });

  it("never prints the tenant id (a client fact on a public log), whatever it is, and drops a count that is not a number", () => {
    for (const tenantId of [TENANT, "not-a-uuid", null]) {
      const report = buildReport({
        target: "local",
        mode: "purge",
        ok: true,
        tenantId,
        counts: { invoice: 2, bad: Number.NaN, worse: "3" as never, neg: -1 },
        logins: [],
        alerts: [],
      });
      expect(report).not.toHaveProperty("tenantId");
      const line = formatReport(report);
      expect(line).not.toContain(TENANT);
      expect(line).not.toContain("not-a-uuid");
      expect(report.counts).toEqual({ invoice: 2 });
    }
  });
});
