import { describe, expect, it } from "vitest";
import { formatPercent } from "@/lib/format/percent";

describe("formatPercent", () => {
  // Intl's it-IT writes the sign right after the number ("10%"), with a comma for decimals. The
  // plan guessed "10 %" with a space; the pins below are what the runtime really produces.
  it("writes a rate as a percent, Italian style", () => {
    expect(formatPercent(0.1)).toBe("10%");
    expect(formatPercent(0.075)).toBe("7,5%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("keeps at most one decimal", () => {
    expect(formatPercent(0.0667)).toBe("6,7%");
    expect(formatPercent(0.05)).toBe("5%");
  });

  it("shows a dash when there is no rate (no lines)", () => {
    expect(formatPercent(null)).toBe("—");
  });

  it("follows the second locale", () => {
    expect(formatPercent(0.075, "en")).toBe("7.5%");
  });
});
