import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineEditor } from "@/app/(owner)/fatture/[id]/revisione/line-editor";
import { SplitForm } from "@/app/(owner)/fatture/[id]/revisione/split-form";
import { makeLine } from "../helpers/review-line";

const actions = {
  saveLine: async () => null,
  createCentre: async () => ({ id: "cc9" }),
  split: async () => null,
  unsplit: async () => null,
};
const ingredients = [
  { id: "i1", name: "Manzo (fesa)", baseUnit: "kg" as const },
  { id: "i2", name: "Olio", baseUnit: "l" as const },
];
const centres = [{ id: "cc1", name: "Pulizie" }];

const editor = (over: Parameters<typeof makeLine>[0] = {}, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(LineEditor, {
      line: makeLine(over),
      ingredients,
      costCentres: centres,
      actions,
      onClose: () => undefined,
      ...props,
    } as never),
  );

/** The markup with every <label>…</label> removed: what is left must hold no control. */
const outsideLabels = (html: string) => html.replace(/<label[\s\S]*?<\/label>/g, "");

describe("LineEditor", () => {
  it("every control sits inside a Field label", () => {
    for (const html of [
      editor(),
      editor({ isStock: false, costCentre: centres[0], ingredient: null }),
    ]) {
      expect(outsideLabels(html)).not.toMatch(/<(input|select|textarea)\b/);
      expect(html.match(/<(input|select)\b/g)!.length).toBeGreaterThan(6);
    }
  });

  it("has exactly one primary button, 'Salva riga', and a quiet 'Annulla'", () => {
    const html = editor();
    expect(html.match(/bg-accent text-on-accent/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Salva riga</);
    expect(html).toMatch(/<button[^>]*>Annulla</);
  });

  it("offers the ingredients and a link to create one in the master data", () => {
    const html = editor({ ingredient: null, mappingSource: null });
    expect(html).toContain("Manzo (fesa)");
    expect(html).toContain('href="/anagrafiche/ingredienti"');
  });

  it("a stock line shows the non-stock checkbox but not the cost-centre controls", () => {
    const html = editor();
    expect(html).toContain("Non a magazzino");
    expect(html).not.toContain("Nuovo centro di costo");
  });

  it("a non-stock line shows the cost-centre Select and the 'Nuovo centro di costo' field", () => {
    const html = editor({ isStock: false, costCentre: centres[0], ingredient: null });
    expect(html).toContain("Nuovo centro di costo");
    expect(html).toContain("Pulizie");
    expect(html).not.toContain("Manzo (fesa)");
  });

  it("shows the pack fields for a line counted in packs", () => {
    expect(editor({ unit: "conf" })).toContain("Pezzi per confezione");
    expect(editor({ unit: "kg" })).not.toContain("Pezzi per confezione");
  });

  it("a part of a split line has no quantity, amount, credit or pack fields", () => {
    const html = editor({ parentLineId: "p", subPosition: 1 }, { child: true });
    expect(html).not.toContain("Quantità resa");
    expect(html).not.toMatch(/>Importo</);
    expect(html).toContain("Lotto");
  });

  it("offers to split an original line, and to undo the split of a split one", () => {
    expect(editor()).toContain("Dividi riga");
    const split = editor({ isSplit: true, children: [makeLine(), makeLine()] });
    expect(split).toContain("Annulla divisione");
    expect(split).not.toContain("Salva riga");
  });

  it("escapes a description with markup in the labels it builds", () => {
    expect(editor({ rawDescription: "<b>x</b>" })).not.toContain("<b>x</b>");
  });
});

describe("SplitForm", () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(SplitForm, {
        line: makeLine({ qty: 3, lineAmount: 30 }),
        actions,
        onClose: () => undefined,
      } as never),
    );

  it("starts with two child rows, each with a quantity and an amount in labels", () => {
    const html = render();
    expect(html.match(/<input\b/g)).toHaveLength(4);
    expect(outsideLabels(html)).not.toMatch(/<input\b/);
    expect(html).toContain("Quantità parte 1");
    expect(html).toContain("Importo parte 2");
  });

  it("says what is left to assign, and has one primary button", () => {
    const html = render();
    expect(html).toContain("Resta da assegnare");
    expect(html).toContain("3 kg");
    expect(html).toContain("30,00 €");
    expect(html.match(/bg-accent text-on-accent/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Dividi</);
  });
});
