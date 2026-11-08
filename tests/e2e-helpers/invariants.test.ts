import { describe, expect, it } from "vitest";
import { ledgerFindings, ledgerFindingsSql } from "../../e2e/helpers/invariants";

// M25 step 16 (AT1): the simulation's last check. "Clean" means app.ledger_checks_body returns no row for the tenant (plan A2); the
// runner (which also judges job health) is not used. The tenant id goes into SQL, so anything that is not a uuid must throw.

const TENANT = "0b4f6c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";

describe("ledgerFindingsSql", () => {
  it("reads app.ledger_checks_body for the tenant at now(), as one read-only statement", () => {
    const sql = ledgerFindingsSql(TENANT);
    expect(sql).toContain(`app.ledger_checks_body('${TENANT}', now())`);
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|run_ledger_invariants)\b/i);
  });

  it.each([
    ["an empty string", ""],
    ["a word", "tenant"],
    ["a uuid with a quote", `${TENANT}'; drop table tenant; --`],
    ["a uuid with a trailing statement", `${TENANT}; select 1`],
    ["a 31-character id", TENANT.slice(0, -5)],
  ])("throws for %s", (_label, value) => {
    expect(() => ledgerFindingsSql(value)).toThrow();
  });
});

describe("ledgerFindings", () => {
  it("returns no findings when the check prints nothing", () => {
    expect(ledgerFindings(TENANT, () => "")).toEqual([]);
  });

  it("returns the check keys it prints, one per line", () => {
    expect(ledgerFindings(TENANT, () => "stock_drift\nportion_drift\n")).toEqual([
      "stock_drift",
      "portion_drift",
    ]);
  });

  it("passes the statement for this tenant to the runner", () => {
    const seen: string[] = [];
    ledgerFindings(TENANT, (statement) => {
      seen.push(statement);
      return "";
    });
    expect(seen).toEqual([ledgerFindingsSql(TENANT)]);
  });

  it("throws for a non-uuid before it runs anything", () => {
    let ran = false;
    expect(() =>
      ledgerFindings("x", () => {
        ran = true;
        return "";
      }),
    ).toThrow();
    expect(ran).toBe(false);
  });
});
