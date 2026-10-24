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
});
