import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TransferForm } from "@/app/(owner)/magazzino/[ingredientId]/transfer-form";
import { LOCATIONS, LOT, LOT2 } from "./stock-fixtures";

const render = (over: Partial<Parameters<typeof TransferForm>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(TransferForm, {
      units: ["kg", "g"],
      locations: LOCATIONS,
      lots: [LOT, LOT2],
      unit: "kg",
      busy: false,
      onSubmit: () => {},
      ...over,
    }),
  );

describe("TransferForm", () => {
  it("is not rendered with fewer than two locations", () => {
    expect(render({ locations: [LOCATIONS[0]!] })).toBe("");
    expect(render({ locations: [] })).toBe("");
  });

  it("is headed 'Sposta tra ubicazioni' and labels Da, A, Quantità, Unità and Lotto", () => {
    const html = render();
    expect(html).toContain('aria-label="Sposta tra ubicazioni"');
    for (const label of ["Da", "A", "Quantità", "Unità", "Lotto"]) {
      expect(html, label).toMatch(new RegExp(`<label[^>]*>\\s*<span[^>]*>${label}</span>`));
    }
    expect(html).toMatch(/<input[^>]*inputMode="decimal"/);
  });

  it("its button is secondary and says 'Sposta'", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*border-ink[^>]*>Sposta<\/button>/);
    expect(html).not.toMatch(/<button[^>]*bg-accent/);
  });

  it("the lot is optional: it starts at the recommended first-to-expire", () => {
    expect(render()).toContain("Primo in scadenza (consigliato)");
  });

  it("shows no euro sign", () => {
    expect(render()).not.toContain("€");
  });
});
