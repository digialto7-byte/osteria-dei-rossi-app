import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WasteForm } from "@/app/(owner)/magazzino/[ingredientId]/waste-form";
import { LOCATIONS, LOT, LOT2 } from "./stock-fixtures";

const render = (over: Partial<Parameters<typeof WasteForm>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(WasteForm, {
      units: ["kg", "g"],
      locations: LOCATIONS,
      lots: [LOT, LOT2],
      unit: "kg",
      busy: false,
      onSubmit: () => {},
      ...over,
    }),
  );

describe("WasteForm", () => {
  it("is headed 'Registra spreco' and labels every control", () => {
    const html = render();
    expect(html).toContain('aria-label="Registra spreco"');
    for (const label of ["Quantità", "Unità", "Motivo", "Lotto", "Ubicazione"]) {
      expect(html, label).toMatch(new RegExp(`<label[^>]*>\\s*<span[^>]*>${label}</span>`));
    }
  });

  it("the quantity is a decimal field", () => {
    expect(render()).toMatch(/<input[^>]*inputMode="decimal"/);
  });

  it("the unit select lists exactly the units it was given", () => {
    const html = render({ units: ["l", "ml"], unit: "l" });
    const select = /<select[^>]*name="unit"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect([...select.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1])).toEqual([
      "l",
      "ml",
    ]);
  });

  it("the reason select has the eight Italian labels", () => {
    const html = render();
    const select = /<select[^>]*name="reason"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    for (const label of [
      "Deteriorato",
      "Scaduto",
      "Sovrapproduzione",
      "Errore di impiattamento",
      "Pasto del personale",
      "Omaggio",
      "Rottura",
      "Correzione di conteggio",
    ]) {
      expect(select).toContain(`>${label}</option>`);
    }
    expect(select).toContain("spoilage");
  });

  it("the lot select starts at 'Primo in scadenza (consigliato)' and lists the lots with stock of the chosen location", () => {
    const html = render({ locations: [LOCATIONS[0]!], lots: [LOT, LOT2] });
    const select = /<select[^>]*name="lot"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect(select.indexOf("Primo in scadenza (consigliato)")).toBeGreaterThan(-1);
    expect(select.indexOf("Primo in scadenza (consigliato)")).toBeLessThan(select.indexOf("L-001"));
    expect(select).toContain("L-001");
  });

  it("has one primary button 'Registra spreco' and no other primary", () => {
    const html = render();
    expect(html.match(/<button[^>]*type="submit"/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*bg-accent[^>]*>Registra spreco<\/button>/);
  });

  it("the location field appears only with two or more locations", () => {
    expect(render()).toContain("Ubicazione");
    expect(render({ locations: [LOCATIONS[0]!] })).not.toContain("Ubicazione");
    expect(render({ locations: [] })).not.toContain("Ubicazione");
  });

  it("disables the button while the request is on its way", () => {
    expect(render({ busy: true })).toMatch(
      /<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/,
    );
  });

  it("shows no euro sign", () => {
    expect(render()).not.toContain("€");
  });
});
