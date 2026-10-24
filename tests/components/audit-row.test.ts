import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuditRow } from "@/app/(owner)/registro/audit-row";
import type { AuditEntry } from "@/server/audit/types";
import { ING } from "./count-fixtures";

const WASTE: AuditEntry = {
  id: "0e000000-0000-4000-8000-0000000000e1",
  at: "2026-10-23T08:12:00+00:00",
  byName: "Chef Demo",
  kind: "stock",
  action: "waste",
  ingredientId: ING,
  ingredientName: "Manzo muscolo (demo)",
  qty: -1.5,
  unit: "kg",
  reasonCode: "spoilage",
  locationNames: ["Cella (demo)"],
};
const EVENT: AuditEntry = {
  id: "0e000000-0000-4000-8000-0000000000e2",
  at: "2026-10-23T08:00:00+00:00",
  byName: "Titolare Demo",
  kind: "event",
  action: "invoice.approved",
  entityType: "invoice",
  entityId: "e1000000-0000-4000-8000-0000000000e1",
  entityLabel: "123/A",
};
const render = (entry: AuditEntry) =>
  renderToStaticMarkup(createElement("ul", null, createElement(AuditRow, { entry })));

describe("AuditRow", () => {
  it("a stock entry: neutral badge with the action, the subject and a meta line", () => {
    const html = render(WASTE);
    expect(html).toMatch(/bg-sunk[^>]*>[\s\S]*Spreco</);
    expect(html).toContain("Manzo muscolo (demo) −1,5 kg · Cella (demo) · Deteriorato");
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>23\/10\/2026, 10:12 · Chef Demo<\/p>/);
  });

  it("a transfer shows both locations and the quantity moved without a sign", () => {
    const html = render({
      ...WASTE,
      action: "transfer",
      qty: 2,
      reasonCode: undefined,
      locationNames: ["Cella (demo)", "Freezer (demo)"],
    });
    expect(html).toContain("Spostamento");
    expect(html).toContain("Manzo muscolo (demo) 2 kg · Cella (demo) → Freezer (demo)");
  });

  it("a count shows the signed difference", () => {
    const html = render({ ...WASTE, action: "count", qty: -0.5, reasonCode: undefined });
    expect(html).toContain("Conteggio");
    expect(html).toContain("−0,5 kg");
  });

  it("an invoice event names the invoice", () => {
    const html = render(EVENT);
    expect(html).toContain("Fattura approvata");
    expect(html).toContain("Fattura 123/A");
  });

  it("a count event shows the location, a critical flag the ingredient", () => {
    expect(
      render({
        ...EVENT,
        action: "count_session.closed",
        entityType: "count_session",
        entityLabel: "Cella (demo)",
      }),
    ).toContain("Conteggio chiuso");
    const flag = render({
      ...EVENT,
      action: "ingredient.critical_changed",
      entityType: "ingredient",
      entityLabel: "Manzo muscolo (demo)",
    });
    expect(flag).toContain("Ingrediente critico");
    expect(flag).toContain("Manzo muscolo (demo)");
  });

  it("shows the time in Europe/Rome across the DST change (2026-10-25T01:30Z is 02:30)", () => {
    expect(render({ ...WASTE, at: "2026-10-25T01:30:00+00:00" })).toContain("25/10/2026, 02:30");
  });

  it("an unknown action shows its code, a missing person a dash, and nothing carries a euro sign", () => {
    const html = render({ ...EVENT, action: "brand.new_action", byName: null });
    expect(html).toContain("brand.new_action");
    expect(html).toContain("· —");
    expect(html).not.toContain("€");
  });

  it("escapes markup in names", () => {
    const html = render({
      ...WASTE,
      ingredientName: "<script>alert(1)</script>",
      byName: "<b>x</b>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
  });
});
