import { describe, expect, it } from "vitest";
import {
  basisLabel,
  canReadCosts,
  canReadMargins,
  marginLine,
  marginStatusView,
  checkRowText,
  costLineText,
  fixedCostView,
  formatPct,
  incompleteNotes,
  ingredientFigures,
  monthLabel,
  nextBasis,
  plateFigures,
  reasonText,
  signedPct,
  statusView,
} from "@/lib/costing/cost-view";
import type { CostLine, IngredientCost, PlateCost } from "@/server/costing/types";

const plain = (text: string | null) => text?.replace(/ /g, " ") ?? null;

const PLATE: PlateCost = {
  recipeKey: "k1",
  name: "Spezzatino con polenta (demo)",
  version: 2,
  foodCostEur: 2.0567,
  fixedCostEur: null,
  fullCostEur: null,
  salePriceEur: 12,
  vatPct: 10,
  salePriceExVatEur: 10.9091,
  grossMarginEur: 8.8524,
  netMarginEur: null,
  foodCostPct: 18.8542,
  gpPct: 81.1458,
  targetGpPct: 70,
  fixedCostAllocated: false,
  status: "fixed_cost_unallocated",
  reasons: [],
  missingIngredients: [],
};

describe("statusView", () => {
  it("gives every status a word and a tone", () => {
    expect(statusView("ok")).toEqual({ tone: "success", label: "In linea" });
    expect(statusView("below_target")).toEqual({ tone: "warning", label: "Sotto obiettivo" });
    expect(statusView("fixed_cost_unallocated")).toEqual({
      tone: "info",
      label: "Costi fissi non ripartiti",
    });
    expect(statusView("incomplete")).toEqual({ tone: "danger", label: "Costo incompleto" });
  });

  it("speaks English when asked", () => {
    expect(statusView("below_target", "en").label).toBe("Below target");
  });
});

describe("percent and money words", () => {
  it("shows one decimal and a space before the sign, a dash for unknown", () => {
    expect(plain(formatPct(18.8542))).toBe("18,9 %");
    expect(plain(formatPct(70, 0))).toBe("70 %");
    expect(formatPct(null)).toBe("—");
  });

  it("rounds once: the 4-decimal values from the database show as 81,1 % and 18,9 %", () => {
    expect(plain(formatPct(81.1458))).toBe("81,1 %");
    expect(plain(formatPct(18.8542))).toBe("18,9 %");
    expect(plain(formatPct(81.1458, 1, "en"))).toBe("81.1%");
  });

  it("signs a difference, with a real minus", () => {
    expect(plain(signedPct(6))).toBe("+6,0 %");
    expect(plain(signedPct(-6))).toBe("−6,0 %");
    expect(plain(signedPct(0))).toBe("0,0 %");
  });

  it("words a month in Italian", () => {
    expect(monthLabel("2026-10-01")).toBe("Ottobre 2026");
  });
});

describe("reasonText", () => {
  it.each([
    ["missing_price", "Manca il prezzo di un ingrediente"],
    ["no_sale_price", "Prezzo di vendita mancante"],
    ["unit_mismatch", "Unità non convertibile"],
    ["sub_not_in_force", "Sottoricetta non in uso in quella data"],
    ["graph_too_deep", "Ricette annidate su troppi livelli"],
    ["something_new", "Dati incompleti"],
  ])("%s", (code, text) => {
    expect(reasonText(code)).toBe(text);
  });
});

describe("plateFigures", () => {
  it("words the food cost line and the price line; an unallocated fixed cost is a dash", () => {
    const figures = plateFigures(PLATE);
    expect(plain(figures.costLine)).toBe(
      "Costo cibo 2,06 € · Food cost 18,9 % · GP 81,1 % (obiettivo 70 %)",
    );
    expect(plain(figures.priceLine)).toBe(
      "Prezzo IVA esclusa 10,91 € · Margine lordo 8,85 € · Costo pieno —",
    );
  });

  it("shows the full cost and the net margin when the fixed cost is allocated", () => {
    const figures = plateFigures({
      ...PLATE,
      fixedCostAllocated: true,
      fixedCostEur: 9,
      fullCostEur: 11.0567,
      netMarginEur: -0.1476,
      status: "ok",
    });
    expect(plain(figures.priceLine)).toBe(
      "Prezzo IVA esclusa 10,91 € · Margine lordo 8,85 € · Costo pieno 11,06 € · Margine netto -0,15 €",
    );
  });

  it("leaves the fixed-cost part out for the admin (allocation unknown)", () => {
    const figures = plateFigures({ ...PLATE, fixedCostAllocated: null });
    expect(plain(figures.priceLine)).toBe("Prezzo IVA esclusa 10,91 € · Margine lordo 8,85 €");
  });

  it("omits the target when there is none and every part of an incomplete plate", () => {
    expect(plain(plateFigures({ ...PLATE, targetGpPct: null }).costLine)).toBe(
      "Costo cibo 2,06 € · Food cost 18,9 % · GP 81,1 %",
    );
    const incomplete = plateFigures({
      ...PLATE,
      foodCostEur: null,
      foodCostPct: null,
      gpPct: null,
      grossMarginEur: null,
      status: "incomplete",
    });
    expect(incomplete.costLine).toBeNull();
    expect(plain(incomplete.priceLine)).toContain("Prezzo IVA esclusa 10,91 €");
    expect(incomplete.priceLine).not.toContain("Margine lordo");
    expect(plateFigures({ ...PLATE, salePriceExVatEur: null }).priceLine).toBeNull();
  });
});

describe("incompleteNotes", () => {
  it("names the ingredients without a price", () => {
    expect(
      incompleteNotes({
        ...PLATE,
        status: "incomplete",
        reasons: ["missing_price"],
        missingIngredients: [{ id: "i1", name: "Sale grosso (demo)" }],
      }),
    ).toEqual(["Manca il prezzo di: Sale grosso (demo)"]);
  });

  it("says a missing sale price and other reasons in words, once each", () => {
    expect(
      incompleteNotes({
        ...PLATE,
        status: "incomplete",
        reasons: ["no_sale_price", "unit_mismatch", "no_sale_price"],
      }),
    ).toEqual(["Prezzo di vendita mancante", "Unità non convertibile"]);
  });

  it("is empty for a complete plate", () => {
    expect(incompleteNotes(PLATE)).toEqual([]);
  });
});

describe("costLineText", () => {
  const line = (over: Partial<CostLine>): CostLine => ({
    position: 1,
    target: { kind: "ingredient", id: "i", name: "Manzo muscolo (demo)" },
    qty: 5,
    unit: "kg",
    yieldFactor: 1,
    unitCostEur: 10,
    lineCostEur: 50,
    incomplete: false,
    reason: null,
    ...over,
  });

  it("words an ingredient line with quantity, price per unit, yield and total", () => {
    expect(plain(costLineText(line({})))).toBe("5 kg × 10,00 €/kg ÷ resa 1 = 50,00 €");
  });

  it("prices a gram line per kilogram", () => {
    expect(plain(costLineText(line({ qty: 500, unit: "g", lineCostEur: 5 })))).toBe(
      "500 g × 10,00 €/kg ÷ resa 1 = 5,00 €",
    );
  });

  it("shows the yield below one", () => {
    expect(plain(costLineText(line({ qty: 1, yieldFactor: 0.82, lineCostEur: 12.1951 })))).toBe(
      "1 kg × 10,00 €/kg ÷ resa 0,82 = 12,20 €",
    );
  });

  it("words a portions line without a yield", () => {
    expect(
      plain(
        costLineText(
          line({
            qty: 1,
            unit: "porz",
            unitCostEur: 1.6667,
            lineCostEur: 1.6667,
            target: { kind: "recipe", id: "r", name: "Spezzatino (demo)" },
          }),
        ),
      ),
    ).toBe("1 porz × 1,67 € = 1,67 €");
  });

  it("never invents a figure for an incomplete line", () => {
    const text = plain(
      costLineText(line({ unitCostEur: null, lineCostEur: null, incomplete: true })),
    );
    expect(text).toBe("5 kg · costo non disponibile");
    expect(text).not.toContain("0,00");
  });
});

describe("fixedCostView", () => {
  it("is allocated when a per-plate figure exists", () => {
    expect(
      fixedCostView({
        periodMonth: "2026-10-01",
        monthlyTotalEur: 13500,
        platesSold: 1500,
        perPlateEur: 9,
        reason: null,
      }),
    ).toEqual({
      kind: "allocated",
      month: expect.stringContaining("13.500,00"),
      sold: "1.500",
      perPlate: expect.stringContaining("9,00"),
    });
  });

  it("says why nothing is allocated", () => {
    expect(
      fixedCostView({
        periodMonth: "2026-10-01",
        monthlyTotalEur: 13500,
        platesSold: 0,
        perPlateEur: null,
        reason: "no_sales",
      }).kind,
    ).toBe("no_sales");
    expect(
      fixedCostView({
        periodMonth: null,
        monthlyTotalEur: null,
        platesSold: null,
        perPlateEur: null,
        reason: "no_fixed_costs",
      }).kind,
    ).toBe("no_fixed_costs");
  });
});

describe("ingredient words", () => {
  const BEEF: IngredientCost = {
    id: "i1",
    name: "Manzo muscolo (demo)",
    baseUnit: "kg",
    isActive: true,
    basis: "moving_average",
    unitCostEur: 10,
    avgEur: 10,
    lastEur: 11,
    maxEur: 11,
    purchasesUsed: 3,
    lastPurchaseOn: "2026-10-20",
  };

  it("words the cost in use and the purchases", () => {
    expect(plain(ingredientFigures(BEEF))).toBe(
      "In uso 10,00 €/kg · media 10,00 € · ultimo 11,00 € · massimo 11,00 € · 3 acquisti, ultimo il 20/10/2026",
    );
  });

  it("uses the singular for one purchase", () => {
    expect(plain(ingredientFigures({ ...BEEF, purchasesUsed: 1 }))).toContain("1 acquisto,");
  });

  it("has no figures (never 0,00 €) when nothing was ever bought", () => {
    const none = {
      ...BEEF,
      unitCostEur: null,
      avgEur: null,
      lastEur: null,
      maxEur: null,
      purchasesUsed: 0,
      lastPurchaseOn: null,
    };
    expect(ingredientFigures(none)).toBeNull();
  });

  it("words the basis and offers the other one", () => {
    expect(basisLabel("moving_average", 3)).toBe("Media ultimi 3 acquisti");
    expect(basisLabel("last_price", 3)).toBe("Ultimo prezzo");
    expect(nextBasis("moving_average")).toEqual({
      basis: "last_price",
      label: "Usa ultimo prezzo",
    });
    expect(nextBasis("last_price")).toEqual({ basis: "moving_average", label: "Usa la media" });
  });
});

describe("checkRowText", () => {
  it("words a listed plate with the sign of the difference", () => {
    expect(plain(checkRowText({ appEur: 10.6, sheetEur: 10, diffPct: 6 }))).toBe(
      "App 10,60 € · foglio 10,00 € · +6,0 %",
    );
    expect(plain(checkRowText({ appEur: 9.4, sheetEur: 10, diffPct: -6 }))).toBe(
      "App 9,40 € · foglio 10,00 € · −6,0 %",
    );
  });
});

describe("roles and margin words", () => {
  it("costs are for the owner and the admin, margins tab for the chef only", () => {
    expect(["owner", "admin", "chef", "waiter"].map(canReadCosts)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(["owner", "admin", "chef", "waiter"].map(canReadMargins)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it("words the chef's statuses", () => {
    expect(marginStatusView("ok")).toEqual({ tone: "success", label: "In linea" });
    expect(marginStatusView("below_target").label).toBe("Sotto obiettivo");
    expect(marginStatusView("incomplete")).toEqual({ tone: "neutral", label: "Dati incompleti" });
  });

  it("words the percentages and leaves out what is unknown", () => {
    expect(plain(marginLine({ foodCostPct: 18.8542, gpPct: 81.1458, targetGpPct: 70 }))).toBe(
      "Food cost 18,9 % · GP 81,1 % · obiettivo 70 %",
    );
    expect(plain(marginLine({ foodCostPct: null, gpPct: null, targetGpPct: 70 }))).toBe(
      "obiettivo 70 %",
    );
    expect(marginLine({ foodCostPct: null, gpPct: null, targetGpPct: null })).toBeNull();
  });
});
