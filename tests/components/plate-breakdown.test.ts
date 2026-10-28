import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlateBreakdownView } from "@/components/cost/plate-breakdown";
import type { ChefPlateBreakdown, OwnerPlateBreakdown } from "@/server/costing/plate-breakdown";
import { plainHtml } from "./cost-fixtures";

// UX plan B14 (P1-10): the plate's cost by line, largest first, each with a share in percent (and euro for the owner),
// a decorative bar, the incomplete lines flagged. The chef's data has no euro field, so the chef's view cannot show one.
const KEY = "ec000000-0000-4000-8000-000000000004";
const target = (id: number, name: string) => ({
  kind: "ingredient" as const,
  id: `1a000000-0000-4000-8000-00000000000${id}`,
  name,
});
const OWNER: OwnerPlateBreakdown = {
  recipeKey: KEY,
  name: "Spezzatino con polenta (demo)",
  version: 1,
  at: null,
  status: "ok",
  incomplete: false,
  reasons: [],
  missingIngredients: [],
  foodCostPct: 18.8528,
  gpPct: 81.1472,
  targetGpPct: 70,
  lines: [
    {
      position: 1,
      target: target(1, "Manzo (demo)"),
      sharePct: 81.04,
      incomplete: false,
      reason: null,
      lineCostEur: 1.6667,
    },
    {
      position: 3,
      target: target(3, "Pane (demo)"),
      sharePct: 14.59,
      incomplete: false,
      reason: null,
      lineCostEur: 0.3,
    },
    {
      position: 2,
      target: target(2, "Farina (demo)"),
      sharePct: 4.38,
      incomplete: false,
      reason: null,
      lineCostEur: 0.09,
    },
  ],
  money: { foodCostEur: 2.0567, salePriceExVatEur: 10.9091, grossMarginEur: 8.8524 },
};
const CHEF: ChefPlateBreakdown = {
  ...OWNER,
  lines: OWNER.lines.map(({ lineCostEur: _drop, ...rest }) => rest),
} as ChefPlateBreakdown;
delete (CHEF as unknown as Record<string, unknown>).money;

// The page says which view it is (from the role); the chef's view is the default and can show no euro.
const render = (breakdown: OwnerPlateBreakdown | ChefPlateBreakdown, showMoney = false) =>
  plainHtml(
    renderToStaticMarkup(createElement(PlateBreakdownView, { breakdown, showMoney } as never)),
  );
const rows = (html: string) => html.match(/<li\b[\s\S]*?<\/li>/g) ?? [];

describe("PlateBreakdownView (owner)", () => {
  it("lists the lines in the order given, largest first, each with its share and its euro", () => {
    const list = rows(render(OWNER, true));
    expect(list).toHaveLength(3);
    expect(list[0]).toContain("Manzo (demo)");
    expect(list[1]).toContain("Pane (demo)");
    expect(list[2]).toContain("Farina (demo)");
    expect(list[0]).toContain("81,0 %");
    expect(list[0]).toContain("1,67 €");
    expect(list[1]).toContain("14,6 %");
    expect(list[1]).toContain("0,30 €");
    expect(list[2]).toContain("4,4 %");
    expect(list[2]).toContain("0,09 €");
  });

  it("the displayed shares add up to about 100", () => {
    const sum = rows(render(OWNER, true))
      .map((row) => Number(/(\d+,\d) %/.exec(row)![1]!.replace(",", ".")))
      .reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.2);
  });

  it("states food cost %, GP % against the target, the price without VAT and the margin in euro", () => {
    const html = render(OWNER, true);
    expect(html).toContain("Food cost 18,9 %");
    expect(html).toContain("GP 81,1 %");
    expect(html).toContain("obiettivo 70 %");
    expect(html).toContain("Costo cibo 2,06 €");
    expect(html).toContain("Prezzo IVA esclusa 10,91 €");
    expect(html).toContain("Margine lordo 8,85 €");
    expect(html).toContain("In linea");
  });

  it("draws one bar per line, decorative (aria-hidden), as wide as the share, with the numbers as text beside it", () => {
    const html = render(OWNER, true);
    const bars = html.match(/<div[^>]*data-bar[^>]*>/g) ?? [];
    expect(bars).toHaveLength(3);
    for (const bar of bars) expect(bar).toContain('aria-hidden="true"');
    expect(html).toMatch(/data-bar[^>]*><div[^>]*style="width:81\.04%"/);
    expect(html).toMatch(/data-bar[^>]*><div[^>]*style="width:4\.38%"/);
    // The bar holds no text, so a screen reader gets the numbers from the text beside it.
    expect(html).not.toMatch(/<div[^>]*data-bar[^>]*>[^<]+<\/div>/);
  });

  it("uses no image, icon font, svg or chart library", () => {
    const html = renderToStaticMarkup(
      createElement(PlateBreakdownView, { breakdown: OWNER, showMoney: true }),
    );
    expect(html).not.toMatch(/<img|<svg|<canvas|<picture/);
  });

  it("every number sits in .num", () => {
    const html = renderToStaticMarkup(
      createElement(PlateBreakdownView, { breakdown: OWNER, showMoney: true }),
    );
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>81,0\s%/);
  });
});

describe("PlateBreakdownView (incomplete)", () => {
  const INCOMPLETE: OwnerPlateBreakdown = {
    ...OWNER,
    status: "incomplete",
    incomplete: true,
    reasons: ["missing_price"],
    missingIngredients: [
      { id: "1d000000-0000-4000-8000-00000000001d", name: "Sale grosso (demo)" },
    ],
    foodCostPct: null,
    gpPct: null,
    lines: [
      {
        position: 1,
        target: target(1, "Polenta (demo)"),
        sharePct: null,
        incomplete: false,
        reason: null,
        lineCostEur: 0.09,
      },
      {
        position: 2,
        target: target(4, "Sale grosso (demo)"),
        sharePct: null,
        incomplete: true,
        reason: "missing_price",
        lineCostEur: null,
      },
    ],
    money: { foodCostEur: null, salePriceExVatEur: 10.9091, grossMarginEur: null },
  };

  it("flags the plate and the line, with the cost screen's words for the reason", () => {
    const html = render(INCOMPLETE, true);
    expect(html).toContain("Dati incompleti");
    expect(html).toContain("Manca il prezzo di: Sale grosso (demo)");
    const unpriced = rows(html).find((row) => row.includes("Sale grosso (demo)"))!;
    expect(unpriced).toContain("Costo non calcolabile");
    expect(unpriced).toMatch(/Manca il prezzo|prezzo/i);
  });

  it("draws no bar and claims no share for a line without one, and never shows a 0", () => {
    const html = render(INCOMPLETE, true);
    expect(html.match(/data-bar/g) ?? []).toHaveLength(0);
    expect(html).not.toMatch(/0,0\s?%|0,00\s€/);
    expect(html).toContain("0,09 €");
  });

  it("says the line is unpriced for a line with a reason code the engine adds later too", () => {
    const html = render(
      { ...INCOMPLETE, lines: [{ ...INCOMPLETE.lines[1]!, reason: "some_new_reason" }] },
      true,
    );
    expect(html).toContain("Costo non calcolabile");
  });
});

describe("PlateBreakdownView (chef)", () => {
  it("shows the same lines and percentages, in the same order", () => {
    const list = rows(render(CHEF));
    expect(list.map((row) => /Manzo|Pane|Farina/.exec(row)![0])).toEqual([
      "Manzo",
      "Pane",
      "Farina",
    ]);
    expect(list[0]).toContain("81,0 %");
    expect(render(CHEF)).toContain("Food cost 18,9 %");
    expect(render(CHEF)).toContain("GP 81,1 %");
    expect(render(CHEF)).toContain("obiettivo 70 %");
  });

  it("has no euro sign, no price and no margin in euro anywhere in the chef's view", () => {
    const html = render(CHEF);
    expect(html).not.toContain("€");
    expect(html).not.toMatch(/Costo cibo|Prezzo|Margine lordo/);
    expect(html).not.toMatch(/\d,\d\d\s?€/);
  });

  it("not even when the data carries an extra euro field: it reads only the fields it names", () => {
    const leaky = {
      ...CHEF,
      extraEur: 9.99,
      lines: CHEF.lines.map((l) => ({ ...l, lineCostEur: 1.5 })),
    };
    const html = render(leaky as never);
    expect(html).not.toContain("€");
    expect(html).not.toContain("1,50");
  });
});
