// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KpiPanel } from "@/app/(owner)/report/kpi-panel";
import type { KpiReport } from "@/server/reports/output";
import { KPI_REPORT } from "../helpers/report-data";

afterEach(cleanup);

const show = (report: KpiReport = KPI_REPORT) => render(createElement(KpiPanel, { report }));
const row = (key: string) => document.querySelector(`[data-kpi="${key}"]`) as HTMLElement;
const text = (el: Element) => el.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("KpiPanel (AT6: both periods and the deltas)", () => {
  it("names both periods and shows the dates of each", () => {
    show();
    expect(screen.getByText("Questo periodo")).toBeTruthy();
    expect(screen.getByText("Periodo di confronto")).toBeTruthy();
    expect(text(document.body)).toContain("2026-10-28".split("-").reverse().join("/"));
  });

  it("covers: the value, the comparison value and the change in words", () => {
    show();
    const covers = row("covers");
    expect(text(covers)).toContain("Coperti");
    expect(text(covers)).toMatch(/\b5\b/);
    expect(text(covers)).toMatch(/\b2\b/);
    expect(text(covers)).toMatch(/\+3 \(\+150,0\s%\)/);
    expect(text(covers)).toContain("in più");
  });

  it("net revenue, spend and ticket: euro through the formatter, change as a percentage", () => {
    show();
    expect(text(row("revenue"))).toMatch(/119,13\s€/);
    expect(text(row("revenue"))).toMatch(/45,45\s€/);
    expect(text(row("revenue"))).toMatch(/\+162,1\s%/);
    expect(text(row("spend"))).toMatch(/23,83\s€/);
    expect(text(row("ticket"))).toMatch(/59,56\s€/);
  });

  it("food cost % with its hint, purchases and waste", () => {
    show();
    expect(text(row("foodCost"))).toMatch(/29,82\s%/);
    expect(text(row("foodCost"))).toMatch(/27,28\s%/);
    expect(text(row("foodCost"))).toMatch(/sui piatti con costo noto \(71,59\s€ di 119,13\s€\)/);
    expect(text(row("foodCost"))).toMatch(/\+2,5\spt \(\+9,3\s%\)/);
    expect(text(row("purchases"))).toMatch(/280,00\s€/);
    expect(text(row("waste"))).toMatch(/12,00\s€/);
  });

  it("an unknown figure is a dash, and a change against zero has no percentage", () => {
    const report: KpiReport = {
      ...KPI_REPORT,
      current: { ...KPI_REPORT.current, avgSpendPerCoverEur: null, foodCostPct: null },
      delta: { ...KPI_REPORT.delta, avgSpendPerCoverEur: null, foodCostPct: null },
    };
    show(report);
    expect(text(row("spend"))).toContain("—");
    expect(text(row("foodCost"))).toContain("—");
    expect(text(row("purchases"))).not.toMatch(/%/);
  });

  it("app against register, with the dates that have no register total", () => {
    show();
    const register = text(row("register"));
    expect(register).toMatch(/App 135,00\s€ · cassa 130,00\s€ · differenza \+5,00\s€ \(\+3,8\s%\)/);
    expect(text(document.body)).toContain("Totale cassa non inserito: 28 ott");
  });

  it("with no register total at all the line says so", () => {
    const report: KpiReport = {
      ...KPI_REPORT,
      current: {
        ...KPI_REPORT.current,
        appVsRegister: {
          appTotalEur: 135,
          registerTotalEur: null,
          difference: null,
          datesWithoutRegister: ["2026-11-04"],
        },
      },
    };
    show(report);
    expect(text(row("register"))).toMatch(/App 135,00\s€ · totale cassa non inserito/);
  });

  it("the covers per hour chart lists only the hours with covers, the weekday chart all seven days", () => {
    show();
    const hours = screen.getByRole("table", { name: "Coperti per ora" });
    expect(within(hours).getAllByRole("row")).toHaveLength(2);
    expect(within(hours).getByRole("rowheader", { name: "20" })).toBeTruthy();
    const days = screen.getByRole("table", { name: "Coperti per giorno della settimana" });
    expect(within(days).getAllByRole("row")).toHaveLength(7);
    expect(within(days).getByRole("rowheader", { name: "lun" })).toBeTruthy();
  });

  it("says how many days are not closed yet, and says nothing when all are", () => {
    show({
      ...KPI_REPORT,
      current: { ...KPI_REPORT.current, final: false, daysFinal: 6, days: 7 },
    });
    expect(screen.getByText("Provvisorio: 1 giorno su 7 non ancora chiuso")).toBeTruthy();
    cleanup();
    show();
    expect(screen.queryByText(/Provvisorio/)).toBeNull();
  });
});
