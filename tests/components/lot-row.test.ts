import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LotRow } from "@/app/(owner)/magazzino/[ingredientId]/lot-row";
import type { LotItem } from "@/server/stock/types";
import { LOT } from "./stock-fixtures";

const render = (over: Partial<LotItem> = {}) =>
  renderToStaticMarkup(
    createElement("ul", null, createElement(LotRow, { lot: { ...LOT, ...over }, unit: "kg" })),
  );

describe("LotRow", () => {
  it("shows the lot code and the .num detail line", () => {
    const html = render();
    expect(html).toContain("L-001");
    expect(html).toMatch(
      /<p class="num[^"]*"[^>]*>Cella \(demo\) · 2 kg di 5 kg ricevuti · ricevuto il 20\/10\/2026 · Fornitore Demo Srl<\/p>/,
    );
  });

  it.each([
    ["expired", "2026-10-21", /bg-danger-bg[^>]*>[\s\S]*Scaduto il 21\/10\/2026</],
    ["due_soon", "2026-10-24", /bg-warning-bg[^>]*>[\s\S]*Scade il 24\/10\/2026</],
    ["ok", "2026-10-28", /bg-sunk[^>]*>[\s\S]*Scade il 28\/10\/2026</],
  ] as const)("the %s state is a badge with its tone and date", (expiryState, expiry, pattern) => {
    expect(render({ expiryState, expiry })).toMatch(pattern);
  });

  it("no expiry says so and invents no date", () => {
    const html = render({ expiryState: "none", expiry: null });
    expect(html).toContain("Senza scadenza");
    expect(html).not.toMatch(/Scade il/);
  });

  it("a Rome date is shown as written on the DST change day", () => {
    expect(render({ expiryState: "ok", expiry: "2026-10-25" })).toContain("Scade il 25/10/2026");
  });

  it("a lot without a code says so", () => {
    expect(render({ lotCode: null })).toContain("Lotto senza codice");
  });

  it("the unlotted bucket is a row 'Senza lotto' with a quantity and no expiry badge", () => {
    const html = render({
      rawLotId: null,
      lotCode: null,
      expiry: null,
      expiryState: null,
      receivedOn: null,
      supplierName: null,
      qtyReceived: null,
      onHandQty: -1,
    });
    expect(html).toContain("Senza lotto");
    expect(html).toContain("−1 kg");
    expect(html).not.toContain("ricevut");
    expect(html).not.toMatch(/Scade|Scaduto|Senza scadenza/);
  });

  it("escapes markup in a lot code or supplier and shows no euro sign", () => {
    const html = render({ lotCode: "<b>x</b>", supplierName: "<i>y</i>" });
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("€");
  });
});
