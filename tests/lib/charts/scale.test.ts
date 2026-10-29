import { describe, expect, it } from "vitest";
import { barPct, maxValue, tickPct } from "@/lib/charts/scale";

describe("barPct", () => {
  it.each([
    [60, 100, 60],
    [150, 100, 100],
    [-5, 100, 0],
    [null, 100, 0],
    [undefined, 100, 0],
    [3, 0, 0],
    [3, -1, 0],
    [1, 3, 33.3],
    [2, 3, 66.7],
    [0, 100, 0],
    [100, 100, 100],
    [Number.NaN, 100, 0],
    [Number.POSITIVE_INFINITY, 100, 0],
  ])("barPct(%s, %s) = %s", (value, max, expected) => {
    expect(barPct(value, max)).toBe(expected);
  });
});

describe("tickPct", () => {
  it("is the target on a 0-100 scale", () => {
    expect(tickPct(70)).toBe(70);
    expect(tickPct(0)).toBe(0);
    expect(tickPct(66.66)).toBe(66.7);
  });
  it("is null when there is no target or it is off the scale", () => {
    expect(tickPct(null)).toBeNull();
    expect(tickPct(undefined)).toBeNull();
    expect(tickPct(Number.NaN)).toBeNull();
  });
  it("clamps a target outside 0-100", () => {
    expect(tickPct(120)).toBe(100);
    expect(tickPct(-3)).toBe(0);
  });
});

describe("maxValue", () => {
  it("is the largest finite value", () => {
    expect(maxValue([3, 12, 6])).toBe(12);
  });
  it("is 0 for no rows, so every bar is empty", () => {
    expect(maxValue([])).toBe(0);
  });
  it("ignores null, undefined, negative and non-finite values", () => {
    expect(maxValue([null, undefined, -5, Number.NaN, Number.POSITIVE_INFINITY, 4])).toBe(4);
    expect(maxValue([-1, -2])).toBe(0);
  });
  it("does not overflow the stack on a long list", () => {
    expect(maxValue(Array.from({ length: 200_000 }, (_, i) => i))).toBe(199_999);
  });
});
