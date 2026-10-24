import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabelText } from "@/app/(owner)/produzione/[id]/etichetta/label-text";
import type { BatchLabel } from "@/server/batches/types";
import { BATCH_ID } from "./batch-fixtures";

// The DST case of AT6: made Friday 26 March 2027 at 20:00 in Rome, due 72 elapsed hours later, after the clocks
// went forward on Sunday 28 March.
const LABEL: BatchLabel = {
  batchId: BATCH_ID,
  recipeName: "Spezzatino (demo)",
  version: 1,
  producedAt: "2027-03-26T19:00:00+00:00",
  useBy: "2027-03-29T19:00:00+00:00",
  portions: 31,
  lotCode: "270326-SPEZZA-1",
  operatorInitials: "CD",
  shelfLifeHours: 72,
  portionsRemaining: 31,
  splitFrom: null,
};

const render = (over: Partial<BatchLabel> = {}) =>
  renderToStaticMarkup(createElement(LabelText, { label: { ...LABEL, ...over } }));
const linesOf = (html: string) => [...html.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);

describe("LabelText", () => {
  it("shows the six lines of the label (AT6 in the UI)", () => {
    expect(linesOf(render())).toEqual([
      "Spezzatino (demo)",
      "Prodotto: 26/03/2027 20:00",
      "Da consumare entro: 29/03/2027 21:00",
      "Porzioni: 31",
      "Lotto: 270326-SPEZZA-1",
      "Operatore: CD",
    ]);
  });

  it("is a narrow, black-on-white block in both themes", () => {
    const html = render();
    expect(html).toContain("bg-white");
    expect(html).toContain("text-black");
    expect(html).toMatch(/max-w-\[/);
  });

  it("escapes a recipe name that contains markup", () => {
    const html = render({ recipeName: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("has no cost and no euro sign", () => {
    expect(render()).not.toContain("€");
  });

  it("a part of a split batch prints the portions left and a seventh line for the parent lot", () => {
    const lines = linesOf(
      render({
        portions: 4,
        portionsRemaining: 4,
        lotCode: "261024-RAGUDE-3",
        splitFrom: { lotCode: "261023-RAGUDE-2" },
      }),
    );
    expect(lines).toHaveLength(7);
    expect(lines[3]).toBe("Porzioni: 4");
    expect(lines[6]).toBe("Diviso da: 261023-RAGUDE-2");
  });

  it("prints the portions left of a reduced batch, and no seventh line without a parent", () => {
    const lines = linesOf(render({ portions: 10, portionsRemaining: 6 }));
    expect(lines).toHaveLength(6);
    expect(lines[3]).toBe("Porzioni: 6");
  });

  it("escapes markup in the parent lot", () => {
    const html = render({ splitFrom: { lotCode: "<script>x</script>" } });
    expect(html).not.toContain("<script>");
  });
});
