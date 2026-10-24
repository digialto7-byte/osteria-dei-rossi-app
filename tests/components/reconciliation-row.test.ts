import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReconciliationRow } from "@/app/(owner)/magazzino/riconciliazione/reconciliation-row";
import type { ReconciliationItem } from "@/server/counts/types";
import { ING, SESSION_ID } from "./count-fixtures";

const ITEM: ReconciliationItem = {
  ingredientId: ING,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  openingQty: 4,
  receiptsQty: 10,
  consumptionQty: 3,
  wasteQty: 2,
  transfersInQty: 0,
  transfersOutQty: 2,
  countAdjustmentsQty: -0.2,
  otherQty: 0,
  closingQty: 6.8,
  balanced: true,
  countedQty: 6.8,
  countedAt: "2026-10-31T10:00:00+00:00",
  countSessionId: SESSION_ID,
  afterCountQty: 0,
  matchesCount: true,
};
const render = (over: Partial<ReconciliationItem> = {}) =>
  renderToStaticMarkup(
    createElement("ul", null, createElement(ReconciliationRow, { item: { ...ITEM, ...over } })),
  );

describe("ReconciliationRow", () => {
  it("writes the movements in .num lines, from the server's numbers", () => {
    const html = render();
    expect(html).toMatch(
      /<p class="num[^"]*"[^>]*>Iniziale 4 kg · Carichi \+10 kg · Consumi −3 kg · Sprechi −2 kg<\/p>/,
    );
    expect(html).toMatch(
      /<p class="num[^"]*"[^>]*>Spostamenti \+0 kg \/ −2 kg · Rettifiche −0,2 kg · Finale 6,8 kg<\/p>/,
    );
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>Contato 6,8 kg il 31\/10\/2026<\/p>/);
  });

  it("balanced and matching the count: a success badge 'Quadra'", () => {
    expect(render()).toMatch(/bg-success-bg[^>]*>[\s\S]*Quadra</);
  });

  it("movements after the count: a warning badge with the quantity", () => {
    const html = render({ matchesCount: false, afterCountQty: -0.5 });
    expect(html).toMatch(/bg-warning-bg[^>]*>[\s\S]*Movimenti dopo il conteggio: −0,5 kg</);
    expect(html).not.toContain("Quadra");
  });

  it("not counted: a neutral badge 'Non contato' and no 'Contato' line", () => {
    const html = render({
      matchesCount: null,
      countedQty: null,
      countedAt: null,
      afterCountQty: null,
      countSessionId: null,
    });
    expect(html).toMatch(/bg-sunk[^>]*>[\s\S]*Non contato</);
    expect(html).not.toContain("Contato 6,8");
  });

  it("not balanced (a bug): a danger badge 'Non quadra', whatever the count says", () => {
    const html = render({ balanced: false });
    expect(html).toMatch(/bg-danger-bg[^>]*>[\s\S]*Non quadra</);
    expect(html).not.toContain("Quadra<");
  });

  it("shows other movements only when there are some", () => {
    expect(render()).not.toContain("Altri movimenti");
    expect(render({ otherQty: 1.5 })).toContain("Altri movimenti +1,5 kg");
  });

  it("shows the date of the count in Europe/Rome (23:30Z on 31 October is 1 November)", () => {
    expect(render({ countedAt: "2026-10-31T23:30:00+00:00" })).toContain("il 01/11/2026");
  });

  it("escapes a name, and never shows a euro sign", () => {
    const html = render({ name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("€");
  });
});
