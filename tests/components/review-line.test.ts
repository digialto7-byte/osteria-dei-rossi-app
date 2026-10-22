import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineRow } from "@/app/(owner)/fatture/[id]/revisione/review-line";
import { formatEuro } from "@/lib/money/format";
import { makeLine } from "../helpers/review-line";

const render = (over: Parameters<typeof makeLine>[0] = {}, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(LineRow, { line: makeLine(over), ...props } as never));

describe("LineRow (review screen)", () => {
  it("an unmapped line says 'Da abbinare' in words, not by colour alone", () => {
    const html = render({ ingredient: null, mappingSource: null, baseQty: null });
    expect(html).toContain("Da abbinare");
    expect(html).toMatch(/class="[^"]*bg-warning-bg[^"]*text-warning[^"]*"/);
  });

  it("writes amounts as 25,50 € inside .num", () => {
    const html = render();
    expect(html).toMatch(/class="num[^"]*"[^>]*>[^<]*25,50 €/);
    expect(html).toContain(formatEuro(25.5));
    expect(html).toContain(formatEuro(12.75));
  });

  it("renders a description with markup as escaped text", () => {
    const html = render({ rawDescription: '<script>alert("x")</script> Fesa' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("lets a long unbroken description wrap instead of widening the page", () => {
    expect(render({ rawDescription: "A".repeat(200) })).toContain("[overflow-wrap:anywhere]");
  });

  it("a corrected line shows 'Corretta'", () => {
    expect(render({ corrected: true, correctedFields: ["qty"] })).toContain("Corretta");
  });

  it("shows the ingredient and the base quantity it will add", () => {
    const html = render({
      qty: 2,
      unit: "conf",
      baseQty: { qty: 12, unit: "kg" },
      ingredient: { id: "i", name: "Manzo", baseUnit: "kg" },
    });
    expect(html).toContain("Manzo");
    expect(html).toContain(`12 kg`);
  });

  it("uses no gold or highlight text colour", () => {
    const html = render({
      corrected: true,
      checks: ["amount_mismatch"],
      lowConfidenceFields: ["qty"],
    });
    expect(html).not.toMatch(/text-gold|text-highlight/);
  });

  it("nests the parts of a split line under it", () => {
    const child = makeLine({
      id: "c1",
      subPosition: 1,
      parentLineId: "p",
      rawDescription: "Parte uno",
    });
    const html = render({ isSplit: true, children: [child] });
    expect(html).toContain("Divisa in 1 parte");
    expect(html).toContain("Parte uno");
  });

  it("has no edit button until the screen gives it one", () => {
    expect(render()).not.toContain("Modifica");
    const html = render({}, { onEdit: () => undefined, expanded: false });
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Modifica</);
  });
});
