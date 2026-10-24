import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SupplierRuleCard } from "@/app/(owner)/riordino/supplier-rule-card";
import { SUPPLIER_ITEM, WINDOW } from "./rules-fixtures";

type Props = Parameters<typeof SupplierRuleCard>[0];
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(SupplierRuleCard, {
      item: SUPPLIER_ITEM,
      canEdit: true,
      busy: false,
      error: null,
      onSave: () => undefined,
      ...over,
    }),
  );

const checkbox = (html: string, label: string) =>
  new RegExp(`<input[^>]*type="checkbox"[^>]*>(?:<span>)?${label}<`).exec(html)?.[0] ?? "";

describe("SupplierRuleCard, owner", () => {
  it("shows the name in bold", () => {
    expect(render()).toMatch(/<[^>]*font-bold[^>]*>Macelleria X \(demo\)</);
  });

  it("has seven weekday checkboxes, Monday first, with Monday and Thursday checked for {1,4}", () => {
    const html = render();
    const labels = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
    const found = labels.map((label) => checkbox(html, label));
    expect(found.every((tag) => tag !== "")).toBe(true);
    expect(labels.filter((_, index) => found[index]!.includes('checked=""'))).toEqual([
      "Lun",
      "Gio",
    ]);
    expect(html.indexOf(">Lun<")).toBeLessThan(html.indexOf(">Dom<"));
  });

  it("groups the weekdays in one wrapping row under a legend", () => {
    const html = render();
    expect(html).toMatch(
      /<fieldset[^>]*flex-wrap[^>]*>\s*<legend[^>]*>Giorni di consegna<\/legend>/,
    );
  });

  it("has the lead time as a numeric field and the cut-off as a time field", () => {
    const html = render();
    expect(html).toMatch(/Giorni di anticipo[\s\S]*?<input[^>]*inputMode="numeric"[^>]*value="2"/i);
    expect(html).toMatch(/Ordine entro le[\s\S]*?<input[^>]*type="time"[^>]*value="11:00"/);
  });

  it("an empty supplier has empty fields and no checked day", () => {
    const html = render({
      item: {
        ...SUPPLIER_ITEM,
        leadTimeDays: null,
        deliveryWeekdays: [],
        orderCutoffTime: null,
        nextWindow: null,
      },
    });
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/type="time"[^>]*value=""/);
  });

  it("shows the next window as the server gave it, even when it looks inconsistent", () => {
    expect(render()).toContain("Prossimo ordine entro mar 03/11, 11:00 · consegna gio 05/11");
    const odd = render({
      item: { ...SUPPLIER_ITEM, nextWindow: { ...WINDOW, deliveryDate: "2026-11-01" } },
    });
    expect(odd).toContain("consegna dom 01/11");
  });

  it("has one secondary Salva and an error above it", () => {
    const html = render({ error: "Orario non valido (HH:MM)." });
    expect(html.match(/>Salva</g)).toHaveLength(1);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf(">Salva<"));
    expect(html).toContain("Orario non valido (HH:MM).");
  });

  it("makes every checkbox a 44 px target", () => {
    expect(render().match(/min-h-tap/g)!.length).toBeGreaterThanOrEqual(7);
  });
});

describe("SupplierRuleCard, chef", () => {
  const html = render({ canEdit: false });
  it("shows the settings as text and has no control", () => {
    expect(html).toMatch(/<dt[^>]*>Giorni di anticipo<\/dt>\s*<dd[^>]*>2<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Giorni di consegna<\/dt>\s*<dd[^>]*>Lun, Gio<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Ordine entro le<\/dt>\s*<dd[^>]*>11:00<\/dd>/);
    expect(html).not.toContain("<input");
    expect(html).not.toContain(">Salva<");
    expect(html).toContain("Prossimo ordine entro");
  });
});
