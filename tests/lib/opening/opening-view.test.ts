import { describe, expect, it } from "vitest";
import {
  canEditOpening,
  isCorrectable,
  locationHeading,
  openingTotal,
} from "@/lib/opening/opening-view";

// Opening stock step 13: pure view helpers for the screen of PR 5 (plan §5 step 13).
describe("opening view helpers", () => {
  it("heads a location with its line count and subtotal, amounts as 1.234,50 €", () => {
    expect(locationHeading({ name: "Dispensa", lineCount: 24, totalValueEur: 1610.2 }, "it")).toBe(
      "Dispensa · 24 righe · 1.610,20\u00a0€",
    );
    expect(locationHeading({ name: "Frigo 1", lineCount: 1, totalValueEur: 20 }, "it")).toBe(
      "Frigo 1 · 1 riga · 20,00\u00a0€",
    );
    expect(locationHeading({ name: "Cellar", lineCount: 2, totalValueEur: 0 }, "en")).toBe(
      "Cellar · 2 lines · €0.00",
    );
  });

  it("formats the overall total", () => {
    expect(openingTotal(1234.5, "it")).toBe("1.234,50\u00a0€");
  });

  it("only the owner and the admin may edit the carico", () => {
    expect(canEditOpening("owner")).toBe(true);
    expect(canEditOpening("admin")).toBe(true);
    expect(canEditOpening("chef")).toBe(false);
    expect(canEditOpening("waiter")).toBe(false);
  });

  it("an operation is correctable while the server says so and it is not reversed", () => {
    expect(isCorrectable({ correctable: true, reversed: null })).toBe(true);
    expect(isCorrectable({ correctable: false, reversed: null })).toBe(false);
    expect(
      isCorrectable({
        correctable: true,
        reversed: { at: "x", byName: null, reasonCode: "qty_wrong" },
      }),
    ).toBe(false);
  });
});
