import { describe, expect, it } from "vitest";
import { formatCount } from "@/lib/format/count";

describe("formatCount", () => {
  it("groups thousands with a dot, also from four digits (it-IT alone leaves 1234 bare)", () => {
    expect(formatCount(1234)).toBe("1.234");
    expect(formatCount(12345)).toBe("12.345");
    expect(formatCount(1234567)).toBe("1.234.567");
  });

  it("leaves small counts and zero as they are", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
  });

  it("writes English grouping for the second locale", () => {
    expect(formatCount(1234, "en")).toBe("1,234");
  });
});
