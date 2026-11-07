import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 5: the `checks` job runs the audit gate with explained exceptions, not the bare npm audit.
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("ci.yml audit line", () => {
  it("runs scripts/audit-check.ts", () => {
    expect(ci).toMatch(/^\s*- run: npx tsx scripts\/audit-check\.ts\s*$/m);
  });

  it("no longer runs npm audit --omit=dev", () => {
    expect(ci).not.toContain("npm audit --omit=dev");
  });
});
