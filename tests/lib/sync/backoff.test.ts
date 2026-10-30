import { describe, expect, it } from "vitest";
import { backoffDelay } from "@/lib/sync/backoff";

describe("backoffDelay", () => {
  const mid = () => 0.5; // jitter factor 1

  it("doubles from 1 s to a cap of 15 s: 1, 2, 4, 8, 15, 15", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((failures) => backoffDelay(failures, mid))).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000,
    ]);
  });

  it("jitter is uniform in 0,8 to 1,2 of the delay", () => {
    expect(backoffDelay(3, () => 0)).toBe(3_200);
    expect(backoffDelay(3, () => 1)).toBe(4_800);
    expect(backoffDelay(5, () => 0)).toBe(12_000);
    expect(backoffDelay(5, () => 1)).toBe(18_000);
  });

  it("never exceeds 18 s, whatever the failures", () => {
    for (const failures of [1, 5, 50, 10_000]) {
      expect(backoffDelay(failures, () => 0.999999)).toBeLessThanOrEqual(18_000);
    }
  });

  it("treats zero or negative failures as the first delay", () => {
    expect(backoffDelay(0, mid)).toBe(1_000);
    expect(backoffDelay(-3, mid)).toBe(1_000);
  });
});
