import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 8 (G9): tests/integration/demo-data.int.ts needs the Supabase stack, so this reads its source. The suite took TODAY at load
// and a fresh `new Date()` at every later call, so a run that crossed Rome midnight compared two different days. Now one instant
// (SUITE_NOW) is taken once, and TODAY, the demo script's clock and every job run use it.
const source = readFileSync(new URL("../integration/demo-data.int.ts", import.meta.url), "utf8");
const code = source
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

const JOBS = /\.rpc\(\s*"(alert_rules_run|ledger_invariants_run)"/g;
const JOBS_PINNED =
  /\.rpc\(\s*"(?:alert_rules_run|ledger_invariants_run)",\s*\{\s*p_at:\s*SUITE_NOW\.toISOString\(\)\s*\}\s*\)/g;

describe("the demo integration suite's clock", () => {
  it("reads the clock exactly once, on the line that fixes SUITE_NOW", () => {
    const reads = code.match(/new Date\(\s*\)/g) ?? [];
    expect(reads).toHaveLength(1);
    expect(code).toMatch(/^const SUITE_NOW = new Date\(\);$/m);
    expect(code).not.toMatch(/Date\.now\(\)/);
  });

  it("derives TODAY from that instant", () => {
    expect(code).toMatch(/^const TODAY = romeToday\(SUITE_NOW\);$/m);
  });

  it("gives the demo script that instant as its clock", () => {
    expect(code).toMatch(/now: \(\) => SUITE_NOW,/);
  });

  it("runs every alert_rules_run and ledger_invariants_run at that instant", () => {
    const calls = code.match(JOBS) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(code.match(JOBS_PINNED) ?? []).toHaveLength(calls.length);
  });
});
