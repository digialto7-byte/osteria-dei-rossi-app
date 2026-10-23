import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayableRow } from "@/app/(owner)/pagamenti/payable-row";
import { ITEM } from "./payable-fixtures";

const render = (over: Partial<typeof ITEM> = {}) =>
  renderToStaticMarkup(
    createElement("ul", null, createElement(PayableRow, { item: { ...ITEM, ...over } })),
  );

describe("PayableRow", () => {
  it("links the bold supplier name to the payable", () => {
    const html = render();
    expect(html).toContain(`href="/pagamenti/${ITEM.id}"`);
    expect(html).toMatch(/<a[^>]*font-bold[^>]*>Fornitore Demo Srl<\/a>/);
  });

  it("puts the invoice line, the amount and the due line in .num", () => {
    const html = render();
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>Fattura 123\/A del 01\/12\/2026<\/p>/);
    expect(html).toMatch(/<span class="num[^"]*"[^>]*>1\.234,50\u00a0€<\/span>/);
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>Scade il 10\/12\/2026 \(tra 7 giorni\)<\/p>/);
  });

  it("the status badge says a word", () => {
    expect(render()).toMatch(/<span aria-hidden="true"[^>]*><\/span>Da pagare</);
    expect(render({ status: "scheduled" })).toContain("Programmata");
    expect(render({ status: "disputed" })).toMatch(/bg-warning-bg[^>]*>[\s\S]*Contestata/);
    expect(render({ status: "paid", paidOn: "2026-12-05" })).toContain("Pagata il 05/12/2026");
  });

  it("an overdue row has a danger badge with the word Scaduta, and a late due line", () => {
    const html = render({ overdue: true, daysToDue: -3 });
    expect(html).toMatch(/bg-danger-bg[^>]*>[\s\S]*Scaduta</);
    expect(html).toContain("Scaduta da 3 giorni");
    expect(render()).not.toMatch(/bg-danger-bg/);
  });

  it("escapes a supplier name that contains markup", () => {
    const html = render({ supplierName: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never mentions email", () => {
    expect(render({ overdue: true })).not.toMatch(/email/i);
  });
});
