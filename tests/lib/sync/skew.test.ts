import { describe, expect, it } from "vitest";
import { skewNotice } from "@/lib/sync/skew";

describe("skewNotice", () => {
  it("says nothing within a minute either way", () => {
    expect(skewNotice(0)).toBeNull();
    expect(skewNotice(59_000)).toBeNull();
    expect(skewNotice(-59_000)).toBeNull();
    expect(skewNotice(60_000)).toBeNull();
    expect(skewNotice(null)).toBeNull();
  });

  it("the phone four minutes ahead", () => {
    expect(skewNotice(4 * 60_000)).toBe(
      "L'ora del telefono è avanti di 4 minuti: correggila nelle impostazioni",
    );
  });

  it("the phone two minutes behind", () => {
    expect(skewNotice(-2 * 60_000)).toBe(
      "L'ora del telefono è indietro di 2 minuti: correggila nelle impostazioni",
    );
  });

  it("rounds to whole minutes and never says 0 minutes; one minute is singular", () => {
    expect(skewNotice(61_000)).toBe(
      "L'ora del telefono è avanti di 1 minuto: correggila nelle impostazioni",
    );
    expect(skewNotice(-61_000)).toBe(
      "L'ora del telefono è indietro di 1 minuto: correggila nelle impostazioni",
    );
    expect(skewNotice(150_000)).toContain("3 minuti");
  });

  it("English", () => {
    expect(skewNotice(4 * 60_000, "en")).toBe(
      "The phone's clock is 4 minutes ahead: fix it in the settings",
    );
    expect(skewNotice(-60_000 - 1_000, "en")).toBe(
      "The phone's clock is 1 minute behind: fix it in the settings",
    );
  });
});
