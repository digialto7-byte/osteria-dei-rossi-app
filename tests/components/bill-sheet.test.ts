// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillSheet } from "@/app/(owner)/tavoli/comanda/bill-sheet";
import { BIDS, BILL, BILL_CLOSED, RECEIPT } from "../helpers/bill-data";

afterEach(cleanup);
type Props = Parameters<typeof BillSheet>[0];
const show = (over: Partial<Props> = {}) =>
  render(
    createElement(BillSheet, {
      bill: BILL,
      onBack: () => undefined,
      onClose: () => undefined,
      onSplit: () => undefined,
      ...over,
    }),
  );
const euro = (text: string) => new RegExp(text.replace(/ /g, "\\s+").replace(/\./g, "\\."));

describe("BillSheet", () => {
  it("lists the lines by course with their amounts, and carries the line ids", () => {
    const { container } = show();
    expect(screen.getByRole("heading", { name: "Primi" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Secondi" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Bevande" })).toBeTruthy();
    const row = container.querySelector(`[data-line-id="${BIDS.line3}"]`) as HTMLElement;
    expect(within(row).getByText("1,5 × Tagliatelle al ragù (demo)")).toBeTruthy();
    expect(row.textContent).toMatch(euro("18,75 €"));
    expect(container.querySelectorAll("[data-line-id]")).toHaveLength(4);
  });

  it("shows a half portion with the ½ sign", () => {
    show();
    expect(screen.getByText("½ × Spezzatino con polenta (demo)")).toBeTruthy();
  });

  it("marks a line that was never sent with 'Non inviato' and no other line", () => {
    const draft = { ...BILL.lines[0]!, state: "draft" as const };
    show({ bill: { ...BILL, lines: [draft, ...BILL.lines.slice(1)], unsentLineIds: [draft.id] } });
    expect(screen.getAllByText("Non inviato")).toHaveLength(1);
  });

  it("shows the coperto with covers and the per-person price, and its amount", () => {
    const { container } = show();
    expect(container.textContent).toMatch(euro("Coperto · 3 × 2,00 €"));
    expect(container.textContent).toMatch(euro("6,00 €"));
  });

  it("shows no coperto row when the table has none", () => {
    show({ bill: { ...BILL, coperto: null } });
    expect(screen.queryByText(/Coperto/)).toBeNull();
  });

  it("shows the total with 'IVA inclusa' and nothing about a VAT rate", () => {
    const { container } = show();
    const total = screen.getByText("Totale (IVA inclusa)").parentElement as HTMLElement;
    expect(total.textContent).toMatch(euro("100,00 €"));
    expect(container.textContent).not.toMatch(/IVA 10|Costo|Margine|Food cost/);
  });

  it("says it is not a fiscal document", () => {
    show();
    expect(screen.getByText("Questo non è un documento fiscale.")).toBeTruthy();
  });

  it("warns about unsent dishes, with a way back to the order", () => {
    const onBack = vi.fn();
    show({ bill: { ...BILL, unsentLineIds: [BIDS.line1, BIDS.line2] }, onBack });
    expect(
      screen.getByText(
        "2 piatti non sono stati inviati in cucina: inviali o rimuovili prima di chiudere.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Torna alla comanda" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows no warning when everything was sent", () => {
    show();
    expect(screen.queryByRole("button", { name: "Torna alla comanda" })).toBeNull();
  });

  it("offers 'Chiudi tavolo' and 'Dividi il conto' on an open table", () => {
    const onClose = vi.fn();
    const onSplit = vi.fn();
    show({ onClose, onSplit });
    fireEvent.click(screen.getByRole("button", { name: "Chiudi tavolo" }));
    fireEvent.click(screen.getByRole("button", { name: "Dividi il conto" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSplit).toHaveBeenCalledTimes(1);
  });

  it("a closed table shows the receipt summary and a way back to the tables, and no close button", () => {
    show({ bill: BILL_CLOSED });
    expect(screen.getByText("Tavolo chiuso · Scontrino 0012-0034 · Carta")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Torna ai tavoli" }).getAttribute("href")).toBe(
      "/tavoli",
    );
    expect(screen.queryByRole("button", { name: "Chiudi tavolo" })).toBeNull();
  });

  it("a table closed without a number says so", () => {
    show({ bill: { ...BILL_CLOSED, receipt: { ...RECEIPT, number: null, missingReceipt: true } } });
    expect(screen.getByText("Tavolo chiuso · senza numero di scontrino")).toBeTruthy();
  });

  it("every control is at least 44 px (min-h-tap)", () => {
    const { container } = show({ bill: { ...BILL, unsentLineIds: [BIDS.line1] } });
    for (const control of container.querySelectorAll("button, a")) {
      expect(control.className, control.textContent ?? "").toContain("min-h-tap");
    }
  });
});
