// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplitPanel } from "@/app/(owner)/tavoli/comanda/split-panel";
import { assignLine, initialSplitForm } from "@/lib/bill/split-form";
import { BIDS, BILL, BILL_BY_COVERS, BILL_BY_ITEMS } from "../helpers/bill-data";

afterEach(cleanup);
type Props = Parameters<typeof SplitPanel>[0];
const base: Props = {
  mode: "covers",
  onMode: () => undefined,
  lines: BILL.lines,
  covers: 3,
  parts: 3,
  onParts: () => undefined,
  split: null,
  form: initialSplitForm(3),
  onForm: () => undefined,
  onCalculate: () => undefined,
  busy: false,
  error: null,
};
const show = (over: Partial<Props> = {}) => render(createElement(SplitPanel, { ...base, ...over }));
const euro = (text: string) => new RegExp(text.replace(/ /g, "\\s+").replace(/\./g, "\\."));
const part = (container: HTMLElement, index: number) =>
  container.querySelector(`[data-part-index="${index}"]`) as HTMLElement;

describe("SplitPanel by covers", () => {
  it("shows the title and the two modes, 'Per coperti' selected", () => {
    show();
    expect(screen.getByRole("heading", { name: "Dividi il conto" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Per coperti" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Per piatti" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("switches mode", () => {
    const onMode = vi.fn();
    show({ onMode });
    fireEvent.click(screen.getByRole("button", { name: "Per piatti" }));
    expect(onMode).toHaveBeenCalledWith("items");
  });

  it("steps the number of parts with the buttons and shows it", () => {
    const onParts = vi.fn();
    show({ onParts });
    expect(screen.getByLabelText("Numero di quote").textContent).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: "Più quote" }));
    fireEvent.click(screen.getByRole("button", { name: "Meno quote" }));
    expect(onParts.mock.calls).toEqual([[4], [2]]);
  });

  it("does not step below 2 or above 99", () => {
    const onParts = vi.fn();
    show({ parts: 2, onParts });
    expect((screen.getByRole("button", { name: "Meno quote" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    cleanup();
    show({ parts: 99, onParts });
    expect((screen.getByRole("button", { name: "Più quote" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows the parts the server computed, by index, with no arithmetic of its own", () => {
    const { container } = show({ split: BILL_BY_COVERS.split });
    expect(part(container, 1).textContent).toMatch(euro("Quota 1 · 33,34 €"));
    expect(part(container, 2).textContent).toMatch(euro("Quota 2 · 33,33 €"));
    expect(part(container, 3).textContent).toMatch(euro("Quota 3 · 33,33 €"));
  });
});

describe("SplitPanel by items", () => {
  const items = { mode: "items" as const };

  it("shows a chip per bill, '+ Conto' and 'Da dividere'", () => {
    show(items);
    for (const name of ["Conto 1", "Conto 2", "+ Conto", "Da dividere"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("marks the selected chip", () => {
    show({ ...items, form: { ...initialSplitForm(3), selected: 1 } });
    expect(screen.getByRole("button", { name: "Conto 2" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Conto 1" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("selecting a chip asks the page to select that bill", () => {
    const onForm = vi.fn();
    show({ ...items, onForm });
    fireEvent.click(screen.getByRole("button", { name: "Conto 2" }));
    expect(onForm.mock.calls[0]![0].selected).toBe(1);
  });

  it("'+ Conto' adds a bill", () => {
    const onForm = vi.fn();
    show({ ...items, onForm });
    fireEvent.click(screen.getByRole("button", { name: "+ Conto" }));
    expect(onForm.mock.calls[0]![0].groups).toHaveLength(3);
  });

  it("tapping a line assigns it to the selected bill (by id)", () => {
    const onForm = vi.fn();
    const { container } = show({ ...items, onForm });
    fireEvent.click(
      within(container.querySelector(`[data-line-id="${BIDS.line1}"]`) as HTMLElement).getByRole(
        "button",
      ),
    );
    expect(onForm).toHaveBeenCalledWith(assignLine(initialSplitForm(3), BIDS.line1, 0));
  });

  it("'Da dividere' sends the next tapped line to the shared list", () => {
    const onForm = vi.fn();
    const { container } = show({
      ...items,
      onForm,
      form: { ...initialSplitForm(3), selected: "shared" as const },
    });
    fireEvent.click(
      within(container.querySelector(`[data-line-id="${BIDS.line4}"]`) as HTMLElement).getByRole(
        "button",
      ),
    );
    expect(onForm.mock.calls[0]![0].shared).toEqual([BIDS.line4]);
  });

  it("names where each line is assigned", () => {
    const form = assignLine(assignLine(initialSplitForm(3), BIDS.line1, 0), BIDS.line4, "shared");
    const { container } = show({ ...items, form });
    expect(
      (container.querySelector(`[data-line-id="${BIDS.line1}"]`) as HTMLElement).textContent,
    ).toContain("Conto 1");
    expect(
      (container.querySelector(`[data-line-id="${BIDS.line4}"]`) as HTMLElement).textContent,
    ).toContain("Da dividere");
    expect(
      (container.querySelector(`[data-line-id="${BIDS.line2}"]`) as HTMLElement).textContent,
    ).toContain("Da assegnare");
  });

  it("steps the covers of a bill", () => {
    const onForm = vi.fn();
    show({ ...items, onForm });
    fireEvent.click(screen.getByRole("button", { name: "Più coperti per Conto 1" }));
    expect(onForm.mock.calls[0]![0].groups[0].covers).toBe(3);
  });

  it("'Calcola' asks the page to compute, and waits while busy", () => {
    const onCalculate = vi.fn();
    show({ ...items, onCalculate });
    fireEvent.click(screen.getByRole("button", { name: "Calcola" }));
    expect(onCalculate).toHaveBeenCalledTimes(1);
    cleanup();
    show({ ...items, busy: true });
    expect((screen.getByRole("button", { name: "Calcola" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows the bills the server computed, by index", () => {
    const { container } = show({ ...items, split: BILL_BY_ITEMS.split });
    expect(part(container, 1).textContent).toMatch(euro("Conto 1 · 43,42 €"));
    expect(part(container, 2).textContent).toMatch(euro("Conto 2 · 34,17 €"));
    expect(part(container, 3).textContent).toMatch(euro("Conto 3 · 22,41 €"));
  });

  it("shows an error as an alert", () => {
    show({ ...items, error: "Assegna ogni piatto a un conto" });
    expect(screen.getByRole("alert").textContent).toBe("Assegna ogni piatto a un conto");
  });

  it("every control is at least 44 px (min-h-tap)", () => {
    const { container } = show(items);
    for (const control of container.querySelectorAll("button")) {
      expect(control.className, control.textContent ?? "").toContain("min-h-tap");
    }
  });
});
