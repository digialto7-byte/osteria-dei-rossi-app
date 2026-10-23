import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperationRow } from "@/app/(owner)/magazzino/[ingredientId]/operation-row";
import type { StockOperation } from "@/server/stock/types";
import { OPERATION } from "./stock-fixtures";

const render = (
  over: Partial<StockOperation> = {},
  props: { confirming?: boolean; busy?: boolean } = {},
) =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(OperationRow, {
        operation: { ...OPERATION, ...over },
        busy: props.busy ?? false,
        defaultConfirming: props.confirming ?? false,
        onReverse: () => {},
      }),
    ),
  );

describe("OperationRow", () => {
  it("shows the type word in a neutral badge and the reason label for a waste", () => {
    const html = render();
    expect(html).toMatch(/bg-sunk[^>]*>[\s\S]*Spreco</);
    expect(html).toContain("Deteriorato");
  });

  it.each([
    ["receipt", "Carico da fattura"],
    ["consumption", "Consumo"],
    ["transfer", "Spostamento"],
    ["count", "Conteggio"],
  ] as const)("the %s type reads %s", (type, word) => {
    expect(render({ type, reasonCode: null })).toContain(word);
  });

  it("a reversal is an 'Annullamento'", () => {
    expect(render({ isReversal: true, reversible: false })).toContain("Annullamento");
  });

  it("each line is a .num line with a real minus sign, the location and the lot", () => {
    expect(render()).toMatch(
      /<p class="num[^"]*"[^>]*>−1,5 kg · Cella \(demo\) · lotto L-001<\/p>/,
    );
  });

  it("a shortfall line says 'senza lotto'", () => {
    const html = render({
      lines: [{ ...OPERATION.lines[0]!, rawLotId: null, lotCode: null, qty: -1 }],
    });
    expect(html).toContain("−1 kg · Cella (demo) · senza lotto");
  });

  it("the meta line has the Rome time and the name for an owner or admin reader", () => {
    expect(render()).toMatch(/23\/10\/2026, 10:12 · Titolare Demo/);
  });

  it("says 'tu' for the reader's own operation and 'un collega' when the name is hidden", () => {
    expect(render({ byMe: true, byName: "Chef Demo" })).toMatch(/10:12 · tu/);
    expect(render({ byMe: false, byName: null })).toMatch(/10:12 · un collega/);
  });

  it("offers 'Annulla' only when the operation is reversible", () => {
    expect(render()).toMatch(
      /<button[^>]*border-ink[^>]*aria-describedby="[^"]+"[^>]*>Annulla<\/button>|<button[^>]*aria-describedby="[^"]+"[^>]*border-ink[^>]*>Annulla<\/button>/,
    );
    expect(render({ reversible: false })).not.toContain(">Annulla<");
  });

  it("the second step shows 'Conferma annullamento' and says the original stays", () => {
    const html = render({}, { confirming: true });
    expect(html).toContain("Conferma annullamento");
    expect(html).toContain(
      "Il movimento resta nello storico; viene registrato un movimento opposto.",
    );
    expect(html).not.toContain(">Annulla<");
  });

  it("a reversed operation carries an 'Annullato' badge and no button", () => {
    const html = render({
      reversedByOperationId: "0f000000-0000-4000-8000-0000000000a2",
      reversible: false,
    });
    expect(html).toContain("Annullato");
    expect(html).not.toContain(">Annulla<");
  });

  it("disables the buttons while the request is on its way", () => {
    expect(render({}, { busy: true })).toMatch(/<button[^>]*disabled=""/);
  });

  it("escapes markup in a name or a lot, and shows no euro sign", () => {
    const html = render({
      byName: "<script>x</script>",
      lines: [{ ...OPERATION.lines[0]!, lotCode: "<b>y</b>" }],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("€");
  });

  it("a consumption of a production reads Produzione and offers no Annulla", () => {
    const html = render({
      type: "consumption",
      reasonCode: null,
      refType: "batch",
      reversible: false,
    });
    expect(html).toContain("Produzione");
    expect(html).not.toContain("Consumo");
    expect(html).not.toContain("Annulla");
  });

  it("a manual consumption still reads Consumo", () => {
    expect(render({ type: "consumption", reasonCode: null, refType: "manual" })).toContain(
      "Consumo",
    );
  });
});
