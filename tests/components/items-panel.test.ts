// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ItemsPanel } from "@/app/(owner)/report/items-panel";
import type { ItemsOutput } from "@/server/reports/output";
import { ITEMS_ADMIN, ITEMS_OWNER } from "../helpers/report-data";

afterEach(cleanup);

const show = (items: ItemsOutput) => render(createElement(ItemsPanel, { items }));
const rowOf = (id: string) => document.querySelector(`[data-menu-item-id="${id}"]`) as HTMLElement;
const text = (el: Element) => el.textContent?.replace(/\s+/g, " ").trim() ?? "";
const STEW = "11000000-0000-4000-8000-000000000001";
const WINE = "11000000-0000-4000-8000-000000000004";

describe("ItemsPanel", () => {
  it("one row per item, found by data-menu-item-id, with plates, mix, revenue and food cost", () => {
    show(ITEMS_OWNER);
    const stew = text(rowOf(STEW));
    expect(stew).toContain("Spezzatino con polenta (demo)");
    expect(stew).toMatch(/2,5 piatti/);
    expect(stew).toMatch(/Mix 27,78\s%/);
    expect(stew).toMatch(/Incasso netto 31,82\s€/);
    expect(stew).toMatch(/Food cost 33,00\s%/);
    expect(stew).toMatch(/Margine per piatto 8,53\s€/);
  });

  it("the owner also sees the fixed costs, the gross margin and the contribution", () => {
    show(ITEMS_OWNER);
    const stew = text(rowOf(STEW));
    expect(stew).toMatch(/Costi fissi 5,00\s€/);
    expect(stew).toMatch(/Margine lordo 3,53\s€/);
    expect(stew).toMatch(/Contributo 8,82\s€/);
  });

  it("the admin's payload gets no owner-only column", () => {
    show(ITEMS_ADMIN);
    expect(text(document.body)).not.toMatch(/Costi fissi|Margine lordo|Contributo/);
    expect(text(rowOf(STEW))).toMatch(/Margine per piatto 8,53\s€/);
  });

  it("an item sold without a recipe carries the Senza ricetta badge and no food cost", () => {
    show(ITEMS_OWNER);
    const wine = text(rowOf(WINE));
    expect(wine).toContain("Senza ricetta");
    expect(wine).not.toMatch(/Food cost/);
    expect(wine).not.toMatch(/Margine per piatto/);
    expect(text(rowOf(STEW))).not.toContain("Senza ricetta");
  });

  it("Costo incompleto and Costo parziale badges", () => {
    const rows = ITEMS_ADMIN.rows.map((r, i) => ({
      ...r,
      status: i === 0 ? ("partial" as const) : ("incomplete" as const),
    }));
    show({ ...ITEMS_ADMIN, rows });
    expect(text(rowOf(STEW))).toContain("Costo parziale");
    expect(text(rowOf(WINE))).toContain("Costo incompleto");
  });

  it("the totals row repeats the period's food cost %", () => {
    show(ITEMS_OWNER);
    const total = screen.getByTestId("items-total");
    expect(text(total)).toMatch(/Totale: 9 piatti · food cost 29,82\s%/);
  });

  it("with no costed plate the totals row has no percentage", () => {
    show({ ...ITEMS_ADMIN, totals: { ...ITEMS_ADMIN.totals, foodCostPct: null } });
    expect(text(screen.getByTestId("items-total"))).toBe("Totale: 9 piatti");
  });

  it("an empty period says so", () => {
    show({
      ...ITEMS_ADMIN,
      rows: [],
      totals: { ...ITEMS_ADMIN.totals, plates: 0, foodCostPct: null },
    });
    expect(screen.getByText("Nessun piatto venduto in questo periodo.")).toBeTruthy();
  });
});

describe("ItemsPanel, a weighted item (P2-0b)", () => {
  const plain = (el: Element) => text(el).replaceAll("\u00a0", " ");
  const weighted = {
    ...ITEMS_ADMIN,
    rows: ITEMS_ADMIN.rows.map((row) =>
      row.menuItemId === STEW ? { ...row, plates: 2, weightG: 2450, avgWeightG: 1225 } : row,
    ),
  };

  it("shows the weight sold and the average weight per plate, on the weighted row only", () => {
    show(weighted);
    const stew = plain(rowOf(STEW));
    expect(stew).toContain("Peso venduto 2,45 kg");
    expect(stew).toContain("media per piatto 1,23 kg");
    expect(plain(rowOf(WINE))).not.toMatch(/Peso venduto|media per piatto/);
  });

  it("shows no unit price on any row", () => {
    show(weighted);
    expect(plain(document.body)).not.toMatch(/ cad\.| \/ 100 g|prezzo unitario/i);
  });

  it("a payload without weight leaves every row as before", () => {
    show(ITEMS_ADMIN);
    expect(plain(document.body)).not.toMatch(/Peso venduto|media per piatto/);
  });
});
