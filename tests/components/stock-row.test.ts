import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StockRow } from "@/app/(owner)/magazzino/stock-row";
import type { StockItem } from "@/server/stock/types";
import { CELLA, ING, ITEM } from "./stock-fixtures";

const render = (over: Partial<StockItem> = {}) =>
  renderToStaticMarkup(
    createElement("ul", null, createElement(StockRow, { item: { ...ITEM, ...over } })),
  );

describe("StockRow", () => {
  it("links the bold name to the ingredient and shows the total in .num", () => {
    const html = render();
    expect(html).toContain(`href="/magazzino/${ING}"`);
    expect(html).toMatch(/<a[^>]*>Manzo muscolo \(demo\)<\/a>/);
    expect(html).toMatch(/<span class="num[^"]*font-bold[^"]*"[^>]*>12,3 kg<\/span>/);
  });

  it("shows one .num line with every location", () => {
    expect(render()).toMatch(
      /<p class="num[^"]*"[^>]*>Cella \(demo\) 10 kg · Freezer \(demo\) 2,3 kg<\/p>/,
    );
  });

  it("a negative stock gets a danger badge that says the words", () => {
    const html = render({
      onHandQty: -1,
      negative: true,
      locations: [
        { locationId: CELLA, name: "Cella (demo)", onHandQty: -1, unlottedQty: -1, negative: true },
      ],
    });
    expect(html).toMatch(/bg-danger-bg[^>]*>[\s\S]*Scorta negativa</);
    expect(html).toContain("−1 kg");
    expect(render()).not.toMatch(/bg-danger-bg/);
  });

  it("a negative unlotted bucket asks for a count", () => {
    const html = render({
      locations: [
        { locationId: CELLA, name: "Cella (demo)", onHandQty: 1, unlottedQty: -1, negative: false },
      ],
    });
    expect(html).toContain("−1 kg senza lotto: fai un conteggio");
    expect(render()).not.toContain("senza lotto");
  });

  it("escapes a name that contains markup", () => {
    const html = render({ name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows an inactive ingredient as such and never a euro sign", () => {
    expect(render({ isActive: false })).toContain("non attivo");
    expect(render()).not.toContain("€");
  });

  it("shows what the server says, with no sums: an inconsistent total is shown as given", () => {
    expect(render({ onHandQty: 99 })).toContain("99 kg");
  });
});
