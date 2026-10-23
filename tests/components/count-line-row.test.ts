import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountLineRow } from "@/app/(owner)/magazzino/conteggi/[id]/count-line-row";
import type { CountLine } from "@/server/counts/types";
import { LINE } from "./count-fixtures";

type Props = Parameters<typeof CountLineRow>[0];
const noop = () => undefined;
const render = (line: Partial<CountLine> = {}, props: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(CountLineRow, {
        line: { ...LINE, ...line },
        text: "",
        state: "idle",
        onText: noop,
        onLeave: noop,
        onEnter: noop,
        ...props,
      }),
    ),
  );

describe("CountLineRow", () => {
  it("has exactly one input: decimal, next-key, labelled with the unit", () => {
    const html = render();
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('enterKeyHint="next"');
    expect(html).toContain("Contato (kg)");
    expect(html).toMatch(/<label[^>]*>[\s\S]*Contato \(kg\)[\s\S]*<input/);
  });

  it("shows the name in bold and the unit as a suffix", () => {
    const html = render();
    expect(html).toMatch(/<span class="[^"]*font-bold[^"]*"[^>]*>Manzo muscolo \(demo\)<\/span>/);
    expect(html).toMatch(/aria-hidden="true"[^>]*>kg</);
  });

  it("the expected quantity is the snapshot once entered, else the quantity now", () => {
    expect(render()).toMatch(/<p class="num[^"]*"[^>]*>Atteso 12,3 kg<\/p>/);
    expect(render({ expectedQty: 11.8, expectedNowQty: 12.3 })).toMatch(/Atteso 11,8 kg/);
    expect(render({ expectedQty: 11.8, expectedNowQty: 12.3 })).not.toContain("12,3");
  });

  it("shows what the server answered about the difference", () => {
    expect(
      render({ countedQty: 11.8, expectedQty: 12.3, differenceQty: -0.5 }, { state: "saved" }),
    ).toContain("Differenza −0,5 kg");
    expect(
      render({ countedQty: 12.3, expectedQty: 12.3, differenceQty: 0 }, { state: "saved" }),
    ).toContain("Nessuna differenza");
    expect(render()).not.toContain("Differenza");
  });

  it("says Salvato after a save, and a problem in words", () => {
    expect(render({}, { state: "saved" })).toContain("Salvato");
    expect(render({}, { state: "error" })).toContain("Non salvato");
    expect(render({}, { state: "saving" })).toContain("Salvataggio");
    expect(render()).not.toContain("Salvato");
  });

  it("is a 56 px kitchen row", () => {
    expect(render()).toMatch(/<li[^>]*min-h-14/);
  });

  it("keeps markup in a name as text, and shows no euro sign", () => {
    const html = render({ name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("€");
  });
});
