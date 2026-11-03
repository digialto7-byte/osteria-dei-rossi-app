import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 17 (AT1): the service simulation runs in CI only (it needs the Supabase stack and browsers), so what a unit run can hold is its shape and the
// house rules for Playwright specs, read from the source: one test, a long timeout, one step per stage, the stages in the plan's order, a CSP collector on
// every context, no positional locators, no date or interval that reads the clock.
const source = readFileSync(
  new URL("../../e2e/simulation/service.spec.ts", import.meta.url),
  "utf8",
);
const code = source
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const STAGES = [
  "1 invoices",
  "2 production",
  "3 antipasti",
  "4 primi",
  "5 secondi",
  "6 closes",
  "7 day close",
  "7b Pranzo and Cena",
  "8 reports",
  "9 invariants",
];

describe("the service simulation spec (AT1)", () => {
  it("is one test with a 15-minute timeout", () => {
    expect(code.match(/^\s*test\(/gm)).toHaveLength(1);
    expect(code).toContain("test.setTimeout(900_000)");
  });

  it("has one test.step per stage, in the plan's order", () => {
    const steps = [...code.matchAll(/test\.step\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(steps).toEqual(STAGES);
  });

  it("collects CSP violations on all four contexts and expects none at the end", () => {
    expect(code.match(/collectCspViolations\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(code).toMatch(/violations[\s\S]*toEqual\(\[\]\)/);
  });

  it("uses no positional locator", () => {
    expect(code).not.toMatch(/\.(first|last|nth)\(/);
  });

  it("reads no date from a literal and builds no interval from the clock", () => {
    expect(code).not.toMatch(/20(26|27)-\d\d-\d\d/);
    expect(code).not.toMatch(/now\(\)\s*-\s*interval/i);
    expect(code).not.toMatch(/new Date\(\s*["'`]/);
  });

  it("takes the business date from the app and fails if the run crossed the 02:00 cut-off", () => {
    expect(code).toContain("businessDateOf(");
    expect(code).toContain("the run crossed the 02:00 cut-off");
  });

  it("places tables 1 to 3 in Pranzo and 4 to 6 in Cena through the owner's override", () => {
    expect(code).toContain('"pranzo"');
    expect(code).toContain('"cena"');
    expect(code).toContain("setTableService(");
    expect(code).not.toContain("setServices(");
  });

  it("checks the ledgers with app.ledger_checks_body, not the nightly runner", () => {
    expect(code).toContain("ledgerFindings(");
    expect(code).not.toMatch(/ledger_invariants_run|run_ledger_invariants/);
  });
});
