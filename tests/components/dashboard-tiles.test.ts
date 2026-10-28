import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComingSoonTile } from "@/components/dashboard/coming-soon-tile";
import { FixedCostsTile } from "@/components/dashboard/fixed-costs-tile";
import { FoodCostTile } from "@/components/dashboard/food-cost-tile";
import { PayablesTile } from "@/components/dashboard/payables-tile";
import { PlatesTile } from "@/components/dashboard/plates-tile";
import { PriceVarianceTile } from "@/components/dashboard/price-variance-tile";
import { StockRiskTile } from "@/components/dashboard/stock-risk-tile";
import { TodayListsTile } from "@/components/dashboard/today-lists-tile";
import { WasteTile } from "@/components/dashboard/waste-tile";
import type { OwnerDashboard } from "@/server/dashboard/output";
import { renderDashboard } from "@/server/dashboard/render";
import { dashboardSqlSchema } from "@/server/dashboard/sql-schema";
import { ownerSql, purchaseDueAlert } from "../fixtures/dashboard-sql";

type Tiles = OwnerDashboard["tiles"];
const fresh = (): Tiles => {
  const out = renderDashboard(dashboardSqlSchema.parse(ownerSql()), "it");
  if (out.role !== "owner") throw new Error("owner expected");
  return out.tiles;
};
const html = (element: ReactElement) => renderToStaticMarkup(element);
const linksTo = (markup: string, href: string) =>
  [...markup.matchAll(/<a [^>]*href="([^"]*)"[^>]*>/g)].filter((m) => m[1] === href).length;

describe("every tile", () => {
  const cases: Array<[string, (t: Tiles) => ReactElement, string]> = [
    ["todayLists", (t) => createElement(TodayListsTile, { tile: t.todayLists }), "/avvisi"],
    ["plates", (t) => createElement(PlatesTile, { tile: t.plates }), "/costi"],
    ["foodCost", (t) => createElement(FoodCostTile, { tile: t.foodCost }), "/costi"],
    ["payables", (t) => createElement(PayablesTile, { tile: t.payables }), "/pagamenti"],
    ["stockAtRisk", (t) => createElement(StockRiskTile, { tile: t.stockAtRisk }), "/magazzino"],
    ["waste", (t) => createElement(WasteTile, { tile: t.waste }), "/magazzino/sprechi"],
    [
      "priceVariance",
      (t) => createElement(PriceVarianceTile, { tile: t.priceVariance }),
      "/avvisi",
    ],
    [
      "fixedCosts",
      (t) => createElement(FixedCostsTile, { tile: t.fixedCosts }),
      "/costi/impostazioni",
    ],
  ];

  it.each(cases)(
    "%s: a labelled section with data-tile and exactly one detail link",
    (key, make, href) => {
      const markup = html(make(fresh()));
      const section = /<section([^>]*)>/.exec(markup)?.[1] ?? "";
      expect(section).toContain(`data-tile="${key}"`);
      const labelledBy = /aria-labelledby="([^"]+)"/.exec(section)?.[1];
      expect(labelledBy).toBeTruthy();
      expect(markup).toMatch(new RegExp(`<h2[^>]*id="${labelledBy}"`));
      expect(linksTo(markup, href)).toBe(1);
      const link = [...markup.matchAll(/<a [^>]*>/g)]
        .map((m) => m[0])
        .find((a) => a.includes(`href="${href}"`));
      expect(link).toContain("min-h-tap");
    },
  );

  it.each(cases)("%s: uses tokens only (no inline style, hex or palette colour)", (_key, make) => {
    const markup = html(make(fresh()));
    expect(markup).not.toMatch(
      /\sstyle=|#[0-9a-f]{3,8}\b|(?:bg|text|border)-(?:red|green|gray|blue|amber)-\d/i,
    );
  });
});

describe("empty states (plan 3.4)", () => {
  it("todayLists", () => {
    const t = fresh();
    Object.assign(t.todayLists, { prep: [], purchase: [], prepCount: 0, purchaseCount: 0 });
    expect(html(createElement(TodayListsTile, { tile: t.todayLists }))).toContain(
      "Niente da preparare o da ordinare oggi.",
    );
  });

  it("plates: no plate at all, with the link to create a recipe", () => {
    const t = fresh();
    Object.assign(t.plates, { worst: [], incomplete: [], incompleteCount: 0 });
    const markup = html(createElement(PlatesTile, { tile: t.plates }));
    expect(markup).toContain("Nessun piatto attivo.");
    expect(linksTo(markup, "/ricette/nuova")).toBe(1);
  });

  it("plates: none complete; the incomplete list stays", () => {
    const t = fresh();
    t.plates.worst = [];
    const markup = html(createElement(PlatesTile, { tile: t.plates }));
    expect(markup).toContain("Nessun piatto con costo completo.");
    expect(markup).toContain("Ossobuco (fixture)");
    expect(markup).not.toContain("Nessun piatto attivo.");
  });

  it("foodCost", () => {
    const t = fresh();
    Object.assign(t.foodCost, { overallPct: null, platesCounted: 0, platesIncomplete: 2 });
    const markup = html(createElement(FoodCostTile, { tile: t.foodCost }));
    expect(markup).toContain("Nessun piatto con costo completo.");
    expect(markup).not.toMatch(/\d+,\d\d\s+%/);
  });

  it("payables", () => {
    const t = fresh();
    Object.assign(t.payables, {
      overdue: { count: 0, amountEur: 0 },
      dueSoon: { count: 0, amountEur: 0 },
      items: [],
    });
    expect(html(createElement(PayablesTile, { tile: t.payables }))).toContain(
      "Nessun pagamento scaduto o in scadenza nei prossimi 7 giorni.",
    );
  });

  it("stockAtRisk", () => {
    const t = fresh();
    t.stockAtRisk.belowMin = { count: 0, items: [] };
    t.stockAtRisk.expiringLots = { count: 0, items: [] };
    t.stockAtRisk.expiringBatches = { count: 0, items: [] };
    expect(html(createElement(StockRiskTile, { tile: t.stockAtRisk }))).toContain(
      "Nessuna scorta a rischio.",
    );
  });

  it("waste: nothing recorded", () => {
    const t = fresh();
    Object.assign(t.waste, {
      valueEur: 0,
      rawValueEur: 0,
      batchValueEur: 0,
      unvaluedCount: 0,
      reasons: [],
    });
    expect(html(createElement(WasteTile, { tile: t.waste }))).toContain(
      "Nessuno spreco registrato questa settimana.",
    );
  });

  it("waste: only unpriced waste says 'Valore non disponibile' and never 0,00", () => {
    const t = fresh();
    Object.assign(t.waste, {
      valueEur: 0,
      rawValueEur: 0,
      batchValueEur: 0,
      unvaluedCount: 2,
      reasons: [],
    });
    const markup = html(createElement(WasteTile, { tile: t.waste }));
    expect(markup).toContain("Valore non disponibile");
    expect(markup).not.toContain("0,00");
    expect(markup).toContain("2 movimenti senza prezzo");
  });

  it("priceVariance", () => {
    const t = fresh();
    Object.assign(t.priceVariance, { count: 0, items: [] });
    expect(html(createElement(PriceVarianceTile, { tile: t.priceVariance }))).toContain(
      "Nessun aumento di prezzo da vedere.",
    );
  });

  it("fixedCosts: none entered", () => {
    const t = fresh();
    Object.assign(t.fixedCosts, {
      periodMonth: null,
      monthlyTotalEur: null,
      perPlateEur: null,
      reason: "no_fixed_costs",
    });
    expect(html(createElement(FixedCostsTile, { tile: t.fixedCosts }))).toContain(
      "Costi fissi non inseriti.",
    );
  });
});

describe("content", () => {
  it("plates: rows by data-recipe-key, the below-target word, the incomplete plate without a percentage", () => {
    const t = fresh();
    const markup = html(createElement(PlatesTile, { tile: t.plates }));
    expect(markup).toContain('data-recipe-key="ec000000-0000-4000-8000-000000000001"');
    expect(markup).toContain("Sotto obiettivo");
    expect(markup).toContain("In linea");
    expect(markup).toMatch(/GP\s+60,00\s+%/);
    expect(markup).toMatch(/obiettivo\s+70,00\s+%/);
    expect(markup).toContain("Costo incompleto");
    expect(markup).toContain("Ossobuco (fixture)");
    const incomplete = markup.slice(markup.indexOf("Costo incompleto"));
    expect(incomplete).not.toMatch(/\d,\d\d\s+%/);
  });

  it("plates: more incomplete plates than listed say how many more", () => {
    const t = fresh();
    t.plates.incompleteCount = 8;
    expect(html(createElement(PlatesTile, { tile: t.plates }))).toContain("e altri 7");
  });

  it("foodCost: the figure, the honest hint and what it is built on", () => {
    const markup = html(createElement(FoodCostTile, { tile: fresh().foodCost }));
    expect(markup).toMatch(/28,28\s+%/);
    expect(markup).toContain("Media dei piatti attivi, non pesata sulle vendite.");
    expect(markup).toContain("su 6 piatti");
    expect(markup).toContain("1 con costo incompleto");
  });

  it("payables: both figures and the day words from the server's days", () => {
    const markup = html(createElement(PayablesTile, { tile: fresh().payables }));
    expect(markup).toMatch(/Scaduti\s+2\s+·\s+150,50\s+€/);
    expect(markup).toMatch(/In scadenza entro 7 giorni\s+2\s+·\s+245,00\s+€/);
    expect(markup).toContain("Scaduta da 5 giorni");
    expect(markup).toContain("Scade oggi");
    expect(linksTo(markup, "/pagamenti/90000000-0000-4000-8000-000000000001")).toBe(1);
  });

  it("stockAtRisk: three groups with counts, state words, quantities, and no euro", () => {
    const markup = html(createElement(StockRiskTile, { tile: fresh().stockAtRisk }));
    expect(markup).toContain("Sotto il minimo");
    expect(markup).toContain("Lotti in scadenza");
    expect(markup).toContain("Preparazioni in scadenza");
    expect(markup).toContain("Scaduto");
    expect(markup).toContain("In scadenza");
    expect(markup).toMatch(/2\s+kg/);
    expect(markup).not.toContain("€");
  });

  it("stockAtRisk: a lot with no code reads well, without 'lotto' or an empty separator", () => {
    const t = fresh();
    t.stockAtRisk.expiringLots.items[0]!.lotCode = null;
    const markup = html(createElement(StockRiskTile, { tile: t.stockAtRisk }));
    expect(markup).toContain("Farina (fixture) · ");
    expect(markup).not.toMatch(/lotto\s*(·|<)/);
    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain("null");
    expect(markup).not.toContain("·  ·");
    expect(markup).not.toContain("lotto L-02");
  });

  it("stockAtRisk: a half portion is written with the Italian comma", () => {
    const t = fresh();
    t.stockAtRisk.expiringBatches.items[0]!.portions = 3.5;
    const markup = html(createElement(StockRiskTile, { tile: t.stockAtRisk }));
    expect(markup).toContain("3,5 porzioni");
    expect(markup).not.toContain("3.5");
    t.stockAtRisk.expiringBatches.items[0]!.portions = 1;
    expect(html(createElement(StockRiskTile, { tile: t.stockAtRisk }))).toContain("1 porzione");
  });

  it("plates and foodCost: an extreme percentage is shown, with the bar clamped", () => {
    const t = fresh();
    t.plates.worst[0]!.gpPct = -3900;
    t.foodCost.overallPct = 1450.25;
    const plates = html(createElement(PlatesTile, { tile: t.plates }));
    expect(plates).toMatch(/-3900,00\s+%/);
    expect(plates).not.toContain("NaN");
    const food = html(createElement(FoodCostTile, { tile: t.foodCost }));
    expect(food).toMatch(/1450,25\s+%/);
    expect(food).toContain('width="100"');
    expect(food).not.toContain("NaN");
  });

  it("stockAtRisk: a group with zero rows is left out", () => {
    const t = fresh();
    t.stockAtRisk.belowMin = { count: 0, items: [] };
    const markup = html(createElement(StockRiskTile, { tile: t.stockAtRisk }));
    expect(markup).not.toContain("Sotto il minimo");
    expect(markup).toContain("Lotti in scadenza");
  });

  it("waste: the week, the total, the reasons and the unpriced note", () => {
    const markup = html(createElement(WasteTile, { tile: fresh().waste }));
    expect(markup).toContain("Settimana dal 09/11 al 15/11");
    expect(markup).toMatch(/12,00\s+€/);
    expect(markup).toContain("Deteriorato");
    expect(markup).toContain("Scaduto");
    expect(markup).toContain("1 movimento senza prezzo");
    expect(markup).toMatch(/<table/);
  });

  it("todayLists: prep and order lists, and the 'Visto' badge only on a seen alert", () => {
    const t = fresh();
    const seen = renderDashboard(
      dashboardSqlSchema.parse({
        ...ownerSql(),
        todayLists: {
          ...ownerSql().todayLists,
          purchaseCount: 12,
          purchase: [purchaseDueAlert("2026-11-09T06:30:00.000Z")],
        },
      }),
      "it",
    );
    if (seen.role !== "owner") throw new Error("owner expected");
    const unseen = html(createElement(TodayListsTile, { tile: t.todayLists }));
    expect(unseen).toContain("Da ordinare");
    expect(unseen).not.toContain("Visto");
    const marked = html(createElement(TodayListsTile, { tile: seen.tiles.todayLists }));
    expect(marked).toContain("Visto");
    expect(marked).toContain("e altri 11");
  });

  it("fixedCosts: the monthly amount, the month, and the honest note", () => {
    const markup = html(createElement(FixedCostsTile, { tile: fresh().fixedCosts }));
    expect(markup).toMatch(/3\.000,00\s+€\s+al mese/);
    expect(markup).toContain("novembre 2026");
    expect(markup).toContain("Non ripartiti finché non ci sono vendite.");
  });

  it("fixedCosts: the per-plate figure when there is one", () => {
    const t = fresh();
    Object.assign(t.fixedCosts, { perPlateEur: 1.5, reason: null });
    expect(html(createElement(FixedCostsTile, { tile: t.fixedCosts }))).toMatch(
      /1,50\s+€\s+a piatto/,
    );
  });

  it("priceVariance: the count and the rendered alerts", () => {
    const markup = html(createElement(PriceVarianceTile, { tile: fresh().priceVariance }));
    expect(markup).toContain("2 aumenti da vedere");
  });

  it("comingSoon: a row per key, no digit, no link", () => {
    const markup = html(
      createElement(ComingSoonTile, { keys: ["covers", "revenue", "averageSpend"] }),
    );
    for (const label of ["Coperti", "Incasso", "Scontrino medio per coperto"])
      expect(markup).toContain(label);
    expect(markup.match(/Disponibile dopo l&#x27;avvio di comande e conti/g)).toHaveLength(3);
    expect(markup).not.toContain("<a");
    expect(markup.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'")).not.toMatch(/\d/);
    expect(markup).toContain('data-tile="comingSoon"');
  });

  it("plate names that look like markup render as text", () => {
    const t = fresh();
    t.plates.worst[0]!.name = "<img src=x onerror=alert(1)>";
    const markup = html(createElement(PlatesTile, { tile: t.plates }));
    expect(markup).not.toContain("<img");
  });
});
