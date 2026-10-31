// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscardsPanel } from "@/app/(owner)/report/discards-panel";
import type { DiscardsOutput } from "@/server/push/output";
import { DISCARDS } from "../helpers/push-data";

afterEach(cleanup);

const show = (data: DiscardsOutput, onWeek: (date: string) => void = () => undefined) =>
  render(createElement(DiscardsPanel, { data, onWeek }));
const text = (el: Element) => (el.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

describe("DiscardsPanel (AT7: one line per batch recipe)", () => {
  it("names the ISO week with the Italian elision", () => {
    show(DISCARDS);
    expect(screen.getByText("Settimana dal 02/11 all'08/11")).toBeTruthy();
  });

  it("one row per recipe, in the API's order, found by its key", () => {
    const { container } = show(DISCARDS);
    const keys = [...container.querySelectorAll("[data-recipe-key]")].map((el) =>
      el.getAttribute("data-recipe-key"),
    );
    expect(keys).toEqual(DISCARDS.rows.map((r) => r.recipeKey));
  });

  it("the Ragù and the Spezzatino rows read as the plan says", () => {
    const { container } = show(DISCARDS);
    const row = (key: string) => text(container.querySelector(`[data-recipe-key="${key}"]`)!);
    expect(row(DISCARDS.rows[0]!.recipeKey)).toBe(
      "Ragù (demo) · durata 72 h · 1 lotto scartato, 0 in evidenza · 5 porzioni · 7,50 €",
    );
    expect(row(DISCARDS.rows[1]!.recipeKey)).toBe(
      "Spezzatino · durata 48 h · 1 lotto scartato, 1 era in evidenza · 3 porzioni · 8,14 €",
    );
  });

  it("shows the totals of the week", () => {
    show(DISCARDS);
    expect(
      screen.getByText("2 lotti scartati, 1 era in evidenza · 8 porzioni · 15,64 €"),
    ).toBeTruthy();
  });

  it("an empty week says nothing was thrown away, with no totals", () => {
    show({
      ...DISCARDS,
      rows: [],
      totals: {
        batchesDiscarded: 0,
        batchesPushed: 0,
        portionsDiscarded: 0,
        portionsPushed: 0,
        valueEur: 0,
        unvaluedCount: 0,
      },
    });
    expect(screen.getByText("Nessuna preparazione scartata in questa settimana.")).toBeTruthy();
    expect(screen.queryByText(/lotti scartati/)).toBeNull();
  });

  it("the week can be moved a week back or forward, or picked by date", () => {
    const onWeek = vi.fn();
    show(DISCARDS, onWeek);
    fireEvent.click(screen.getByRole("button", { name: "Precedente" }));
    expect(onWeek).toHaveBeenLastCalledWith("2026-10-26");
    fireEvent.click(screen.getByRole("button", { name: "Successiva" }));
    expect(onWeek).toHaveBeenLastCalledWith("2026-11-09");
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-15" } });
    expect(onWeek).toHaveBeenLastCalledWith("2026-10-15");
  });
});
