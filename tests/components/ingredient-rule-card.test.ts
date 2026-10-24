import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IngredientRuleCard } from "@/app/(owner)/riordino/ingredient-rule-card";
import { CHOICES, INGREDIENT } from "./rules-fixtures";

type Props = Parameters<typeof IngredientRuleCard>[0];
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(IngredientRuleCard, {
      item: INGREDIENT,
      choices: CHOICES,
      canEdit: true,
      busy: false,
      error: null,
      onSave: () => undefined,
      onCriticalChange: () => undefined,
      ...over,
    }),
  );

describe("IngredientRuleCard, owner", () => {
  it("shows the name in bold and the stock in a .num line", () => {
    const html = render();
    expect(html).toMatch(/<[^>]*font-bold[^>]*>Manzo muscolo \(demo\)</);
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>In giacenza 9 kg<\/p>/);
  });

  it("has Minimo and Obiettivo as decimal fields with the unit as a suffix", () => {
    const html = render();
    expect(html).toMatch(/Minimo[\s\S]*?<input[^>]*inputMode="decimal"[^>]*value="5"/i);
    expect(html).toMatch(/Obiettivo[\s\S]*?<input[^>]*inputMode="decimal"[^>]*value="12"/i);
    expect(html.match(/>kg</g)).toHaveLength(2);
  });

  it("offers the supplier items of this ingredient only, the preferred one selected", () => {
    const html = render();
    expect(html).toContain("Fornitore preferito");
    expect(html).toContain("Macelleria X (demo) · confezione 5 kg");
    expect(html).not.toContain("confezione 1 kg");
    expect(html).toMatch(/<option[^>]*value="5e000000-0000-4000-8000-000000000001"[^>]*selected/);
    expect(html).toMatch(/<option[^>]*value=""[^>]*>Nessuno</);
  });

  it("has the daily count switch and one secondary Salva button", () => {
    const html = render({ item: { ...INGREDIENT, isCritical: true } });
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(html).toContain("Conteggio giornaliero");
    expect(html.match(/>Salva</g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*border-ink[^>]*>Salva<\/button>/);
  });

  it("shows the next window as the server gave it", () => {
    expect(render()).toContain("Prossimo ordine entro mar 03/11, 11:00 · consegna gio 05/11");
    expect(render({ item: { ...INGREDIENT, nextWindow: null } })).not.toContain("Prossimo ordine");
  });

  it("an incomplete ingredient has the badge and the reasons in words", () => {
    const html = render({
      item: {
        ...INGREDIENT,
        status: "incomplete",
        preferred: null,
        nextWindow: null,
        reasons: ["no_preferred_item", "supplier_no_weekdays"],
      },
    });
    expect(html).toMatch(/bg-warning-bg[^>]*>[\s\S]*Da completare/);
    expect(html).toContain("Nessun fornitore preferito");
    expect(html).toContain("Fornitore senza giorni di consegna");
    expect(html).not.toContain("no_preferred_item");
  });

  it("an ingredient with no minimum says Non attivo", () => {
    const html = render({ item: { ...INGREDIENT, status: "off", minLevel: null, reasons: [] } });
    expect(html).toContain("Non attivo");
    expect(html).not.toContain("Da completare");
  });

  it("a complete ingredient has no status badge", () => {
    const html = render();
    expect(html).not.toContain("Da completare");
    expect(html).not.toContain("Non attivo");
  });

  it("an error sits above the Salva button, as an alert", () => {
    const html = render({ error: "L'obiettivo non può essere inferiore al minimo." });
    expect(html).toMatch(/role="alert"[^>]*>[\s\S]*L&#x27;obiettivo non può essere inferiore/);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf(">Salva<"));
  });

  it("disables the controls while saving", () => {
    const html = render({ busy: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Salva<\/button>/);
  });

  it("has no euro sign and escapes a name with markup", () => {
    const html = render({ item: { ...INGREDIENT, name: "<script>alert(1)</script>" } });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("€");
  });
});

describe("IngredientRuleCard, chef", () => {
  const chef = (over: Partial<Props> = {}) => render({ canEdit: false, ...over });

  it("shows the levels and the supplier as text in a definition list", () => {
    const html = chef();
    expect(html).toMatch(/<dt[^>]*>Minimo<\/dt>\s*<dd[^>]*>5 kg<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Obiettivo<\/dt>\s*<dd[^>]*>12 kg<\/dd>/);
    expect(html).toMatch(
      /<dt[^>]*>Fornitore preferito<\/dt>\s*<dd[^>]*>Macelleria X \(demo\) · confezione 5 kg<\/dd>/,
    );
  });

  it("has no level or supplier control and no Salva, but keeps the daily count switch", () => {
    const html = chef();
    expect(html).not.toContain("inputMode");
    expect(html).not.toContain("<select");
    expect(html).not.toContain(">Salva<");
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toContain("Conteggio giornaliero");
  });

  it("shows a dash for a missing level or supplier, and never a euro sign", () => {
    const html = chef({
      item: { ...INGREDIENT, minLevel: null, targetLevel: null, preferred: null },
    });
    expect(html).toMatch(/<dt[^>]*>Minimo<\/dt>\s*<dd[^>]*>—<\/dd>/);
    expect(html).not.toContain("€");
  });
});
