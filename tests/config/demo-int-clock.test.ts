import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 8 (G9): tests/integration/demo-data.int.ts needs the Supabase stack, so this reads its source. The suite took TODAY at load
// and a fresh `new Date()` at every later call, so a run that crossed Rome midnight compared two different days. Now one instant
// (SUITE_NOW) is taken once and TODAY is derived from it. The demo script and the job runs use suiteClock(): SUITE_NOW plus the
// monotonic time elapsed since, held at the last instant of TODAY. It must advance: the seed raises its alerts "now", after it has
// created the recipes, and a clock frozen at SUITE_NOW raised none (alerts_missing, CI run 42091421924).
const source = readFileSync(new URL("../integration/demo-data.int.ts", import.meta.url), "utf8");
const code = source
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

const JOBS = /\.rpc\(\s*"(alert_rules_run|ledger_invariants_run)"/g;
const JOBS_PINNED =
  /\.rpc\(\s*"(?:alert_rules_run|ledger_invariants_run)",\s*\{\s*p_at:\s*suiteClock\(\)\.toISOString\(\)\s*\}\s*\)/g;

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

  it("gives the demo script the suite clock, which advances from that instant and never leaves TODAY", () => {
    expect(code).toMatch(/now: suiteClock,/);
    expect(code).toMatch(/^const SUITE_T0 = performance\.now\(\);$/m);
    const clock = code.slice(
      code.indexOf("function suiteClock"),
      code.indexOf("\n}\n", code.indexOf("function suiteClock")),
    );
    expect(clock).toContain("SUITE_NOW.getTime() + (performance.now() - SUITE_T0)");
    expect(clock).toMatch(/romeToday\(\w+\) === TODAY/);
    expect(code.match(/performance\.now\(\)/g) ?? []).toHaveLength(2);
  });

  it("runs every alert_rules_run and ledger_invariants_run on the suite clock", () => {
    const calls = code.match(JOBS) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(code.match(JOBS_PINNED) ?? []).toHaveLength(calls.length);
  });
});
