// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnmappedPanel } from "@/app/(owner)/report/unmapped-panel";
import type { UnmappedOutput } from "@/server/reports/output";
import { UNMAPPED } from "../helpers/report-data";

afterEach(cleanup);

const show = (data: UnmappedOutput, onWeek: (date: string) => void = () => undefined) =>
  render(createElement(UnmappedPanel, { data, onWeek }));
const text = (el: Element) => el.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("UnmappedPanel", () => {
  it("names the ISO week with the Italian elision", () => {
    show(UNMAPPED);
    expect(screen.getByText("Settimana dal 02/11 all'08/11")).toBeTruthy();
  });

  it("one row per item: name, plates, gross revenue and the last day", () => {
    show(UNMAPPED);
    const vino = text(
      document.querySelector(`[data-menu-item-id="${UNMAPPED.rows[1]!.menuItemId}"]`)!,
    );
    expect(vino).toMatch(/^Vino rosso \(demo\) · 1 · 40,25\s€ · ultimo 4 nov/);
  });

  it("each row links to the menu to connect a recipe", () => {
    show(UNMAPPED);
    const links = screen.getAllByRole("link", { name: "Collega una ricetta" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.getAttribute("href")).toBe("/menu");
  });

  it("an empty week says every dish has a recipe", () => {
    show({ ...UNMAPPED, rows: [], totals: { plates: 0, revenueGrossEur: 0 } });
    expect(screen.getByText("Tutti i piatti venduti hanno una ricetta.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Collega una ricetta" })).toBeNull();
  });

  it("the week can be moved a week back or forward", () => {
    const onWeek = vi.fn();
    show(UNMAPPED, onWeek);
    fireEvent.click(screen.getByRole("button", { name: "Precedente" }));
    expect(onWeek).toHaveBeenLastCalledWith("2026-10-26");
    fireEvent.click(screen.getByRole("button", { name: "Successiva" }));
    expect(onWeek).toHaveBeenLastCalledWith("2026-11-09");
  });

  it("the date field picks any date of a week", () => {
    const onWeek = vi.fn();
    show(UNMAPPED, onWeek);
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-15" } });
    expect(onWeek).toHaveBeenCalledWith("2026-10-15");
  });
});
