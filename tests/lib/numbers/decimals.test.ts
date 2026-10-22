import { describe, expect, it } from "vitest";
import { decimals4 } from "@/lib/numbers/decimals";

describe("decimals4", () => {
  it.each([0, 1, 12.75, 0.0001, 0.1 + 0.2, 1_048_576.01, 1e7, 9_999_999.9999])(
    "accepts %s",
    (value) => {
      expect(decimals4(value)).toBe(true);
    },
  );

  it.each([0.00001, 1.23456, 12.345678])("rejects %s (more than 4 decimals)", (value) => {
    expect(decimals4(value)).toBe(false);
  });

  it("treats the sign like the magnitude", () => {
    expect(decimals4(-1.5)).toBe(true);
    expect(decimals4(-1.00001)).toBe(false);
  });
});
