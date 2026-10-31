// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvtPanel } from "@/app/(owner)/report/avt-panel";
import type { AvtOutput } from "@/server/reports/output";
import { AVT } from "../helpers/report-data";

afterEach(cleanup);

const show = (props: {
  avt: AvtOutput | null;
  state?: "ok" | "noCount" | "noOpening";
  onPick?: (id: string) => void;
}) => render(createElement(AvtPanel, { state: "ok", onPick: () => undefined, ...props }));
const text = (el: Element) => el.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("AvtPanel", () => {
  it("the count picker is built from availableCounts", () => {
    show({ avt: AVT });
    const picker = screen.getByLabelText("Inventario") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual([
      "Inventario mensile del 30/11 · Cella (demo)",
      "Inventario mensile del 01/11 · Cella (demo)",
    ]);
    expect(picker.value).toBe(AVT.count.id);
  });

  it("choosing another count reports its id", () => {
    const onPick = vi.fn();
    show({ avt: AVT, onPick });
    fireEvent.change(screen.getByLabelText("Inventario"), {
      target: { value: AVT.availableCounts[1]!.id },
    });
    expect(onPick).toHaveBeenCalledWith(AVT.availableCounts[1]!.id);
  });

  it("the Manzo row reads like the plan's example", () => {
    show({ avt: AVT });
    const manzo = text(
      document.querySelector(`[data-ingredient-id="${AVT.rows[0]!.ingredientId}"]`)!,
    );
    expect(manzo).toMatch(
      /^Manzo \(demo\) · consumato 5,8\s+kg · da ricetta 5,0\s+kg · scarti registrati 0,2\s+kg · differenza \+0,8\s+kg · 9,60\s+€$/,
    );
  });

  it("an unpriced row has no euro", () => {
    show({ avt: AVT });
    const lievito = text(
      document.querySelector(`[data-ingredient-id="${AVT.rows[1]!.ingredientId}"]`)!,
    );
    expect(lievito).not.toContain("€");
  });

  it("the totals: loss, gain, unpriced and not counted", () => {
    show({ avt: AVT });
    const totals = text(screen.getByTestId("avt-totals"));
    expect(totals).toMatch(/Perdita 9,60\s€ · Guadagno 0,00\s€/);
    expect(totals).toContain("1 ingrediente senza prezzo");
    expect(totals).toContain("2 non contati");
  });

  it("no unpriced and no uncounted ingredient: the totals say neither", () => {
    show({ avt: { ...AVT, totals: { ...AVT.totals, unvaluedCount: 0, notCountedCount: 0 } } });
    const totals = text(screen.getByTestId("avt-totals"));
    expect(totals).not.toContain("senza prezzo");
    expect(totals).not.toContain("non conta");
  });

  it("more than one location: the comparison is indicative", () => {
    show({ avt: { ...AVT, locationsActive: 2 } });
    expect(screen.getByText("Con più ubicazioni il confronto è indicativo.")).toBeTruthy();
    cleanup();
    show({ avt: AVT });
    expect(screen.queryByText("Con più ubicazioni il confronto è indicativo.")).toBeNull();
  });

  it("no monthly count yet: the empty state with a link to the counts", () => {
    show({ avt: null, state: "noCount" });
    expect(screen.getByText("Serve un inventario mensile chiuso.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Vai agli inventari" }).getAttribute("href")).toBe(
      "/magazzino/conteggi",
    );
  });

  it("only one monthly count: the second one is needed", () => {
    show({ avt: null, state: "noOpening" });
    expect(screen.getByText("Serve un secondo inventario mensile per confrontare.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Vai agli inventari" }).getAttribute("href")).toBe(
      "/magazzino/conteggi",
    );
  });

  it("two counts with nothing counted in both say so", () => {
    show({ avt: { ...AVT, rows: [] } });
    expect(screen.getByText("Nessun ingrediente contato in entrambi gli inventari.")).toBeTruthy();
  });
});
