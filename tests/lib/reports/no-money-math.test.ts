import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M22 plan §3.1.12: no data logic in React. The report screens only format; the database computed every sum, ratio and delta. A cheap guard on the
// source text of the screen's files: no rounding, no rounding helper and no reduction over money.
const DIR = new URL("../../../src/app/(owner)/report/", import.meta.url);

describe("the report screens compute no euro value", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
  it("finds the six files of the screen", () => {
    expect(files.sort()).toEqual([
      "avt-panel.tsx",
      "items-panel.tsx",
      "kpi-panel.tsx",
      "page.tsx",
      "period-picker.tsx",
      "unmapped-panel.tsx",
    ]);
  });
  for (const file of files) {
    it(`${file} uses no arithmetic helper on money`, () => {
      const source = readFileSync(new URL(file, DIR), "utf8");
      expect(source).not.toMatch(
        /toFixed\(|Math\.(round|floor|ceil)\(|\.reduce\(|parseFloat\(|\bNumber\(/,
      );
    });
  }
});
