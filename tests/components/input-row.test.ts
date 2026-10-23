import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InputRow, type InputRowValue } from "@/app/(owner)/produzione/nuova/input-row";
import type { ProposalInput } from "@/server/batches/types";
import { BEEF_INPUT, CELLA, DISPENSA, LOT_D2, TWO_LOCATIONS, WATER_INPUT } from "./batch-fixtures";

const ONE_LOCATION = [{ id: CELLA, name: "Cella (demo)" }];
const VALUE: InputRowValue = { qty: "5,1667", unit: "kg", locationId: CELLA, lotId: "" };

const render = (
  input: ProposalInput = BEEF_INPUT,
  props: Partial<{
    locations: readonly { id: string; name: string }[];
    value: InputRowValue;
    error: string | null;
  }> = {},
) =>
  renderToStaticMarkup(
    createElement("ul", null, [
      createElement(InputRow, {
        key: "row",
        input,
        locations: ONE_LOCATION,
        value: VALUE,
        error: null,
        onChange: () => {},
        ...props,
      }),
    ]),
  );

describe("InputRow", () => {
  it("shows the name in bold, the proposal with its 4 decimals and the stock per place", () => {
    const html = render();
    expect(html).toMatch(/<p class="[^"]*font-bold[^"]*">Manzo muscolo \(demo\)<\/p>/);
    expect(html).toContain("Proposto 5,1667 kg");
    expect(html).toContain("In giacenza: Cella (demo) 6 kg");
  });

  it('prefills "Usato" with the proposal, as a decimal keypad field', () => {
    const html = render();
    expect(html).toMatch(/<input[^>]*inputMode="decimal"[^>]*value="5,1667"/);
    expect(html).toContain("Usato");
  });

  it("the unit select lists exactly the units of the ingredient", () => {
    const html = render();
    const select = /<select[^>]*name="unit"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect([...select.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1])).toEqual([
      "kg",
      "g",
    ]);
  });

  it("shows the location select only with two or more locations, prefilled with the suggestion", () => {
    expect(render()).not.toContain('name="location"');
    const html = render(BEEF_INPUT, { locations: TWO_LOCATIONS });
    expect(html).toContain('name="location"');
    expect(html).toMatch(/<option[^>]*value="[^"]*a1"[^>]*selected=""/);
    expect(html).toContain("Dispensa (demo)");
  });

  it("the lot select starts at the recommended first-expiring lot and lists the lots at the chosen place", () => {
    const html = render();
    const select = /<select[^>]*name="lot"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect(select).toMatch(
      /^<option value=""( selected="")?>Primo in scadenza \(consigliato\)<\/option>/,
    );
    expect(select).toContain("L-D2 · scade il 25/10/2026 · 3 kg");
    expect(select).toContain("L-D5 · scade il 28/10/2026 · 3 kg");
    // Not the lot at the other place, nor the unlotted shortfall bucket.
    expect(select).not.toContain("L-DISP");
    expect([...select.matchAll(/<option/g)]).toHaveLength(3);
  });

  it("with several places the lots are those of the chosen place", () => {
    const html = render(BEEF_INPUT, {
      locations: TWO_LOCATIONS,
      value: { ...VALUE, locationId: DISPENSA },
    });
    const select = /<select[^>]*name="lot"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect(select).toContain("L-DISP · senza scadenza · 1 kg");
    expect(select).not.toContain("L-D2");
  });

  it("keeps the chosen lot selected", () => {
    expect(render(BEEF_INPUT, { value: { ...VALUE, lotId: LOT_D2 } })).toMatch(
      /<option[^>]*value="[^"]*a1"[^>]*selected=""[^>]*>L-D2/,
    );
  });

  it("an ingredient that is not in stock says so and has no fields", () => {
    const html = render(WATER_INPUT);
    expect(html).toContain("Non a magazzino: non viene scaricato");
    expect(html).toContain("Proposto 1,0333 l");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
  });

  it("marks the field invalid and shows the message when the error names this ingredient", () => {
    const html = render(BEEF_INPUT, { error: "Il lotto scelto è vuoto in questa ubicazione." });
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    expect(html).toContain("Il lotto scelto è vuoto in questa ubicazione.");
    expect(render()).not.toContain("aria-invalid");
  });

  it("escapes a name that contains markup, and never shows a euro sign", () => {
    const html = render({ ...BEEF_INPUT, name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(render()).not.toContain("€");
  });

  it("says when there is no stock at all", () => {
    expect(render({ ...BEEF_INPUT, onHand: [], lots: [] })).toContain("Nessuna giacenza");
  });
});
