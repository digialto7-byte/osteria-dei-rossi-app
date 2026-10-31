// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MissingReceipts } from "@/app/(owner)/chiusura/missing-receipts";
import { BIDS, REPORT } from "../helpers/bill-data";

afterEach(cleanup);
const nb = (s: string) => s.replace(/(\d) (€|%)/g, "$1" + String.fromCharCode(160) + "$2");
const ROW = REPORT.missingReceipts[0]!;
const other = {
  ...ROW,
  sessionId: BIDS.session,
  tableName: "Tavolo 1 (demo)",
  paymentType: "card" as const,
  total: 54,
};

describe("MissingReceipts", () => {
  it("counts the tables in the heading", () => {
    render(createElement(MissingReceipts, { rows: [ROW, other] }));
    expect(
      screen.getByRole("heading", { name: "Tavoli chiusi senza numero di scontrino (2)" }),
    ).toBeTruthy();
  });

  it("lists each table by its session id: table, time, waiter, total, payment", () => {
    const { container } = render(createElement(MissingReceipts, { rows: [ROW, other] }));
    const row = container.querySelector(`[data-session-id="${ROW.sessionId}"]`) as HTMLElement;
    expect(row.textContent).toBe(
      nb("Tavolo 2 (demo) · 00:40 · Cameriere Demo · 134,50 € · Contanti"),
    );
    const second = container.querySelector(`[data-session-id="${BIDS.session}"]`) as HTMLElement;
    expect(second.textContent).toBe(
      nb("Tavolo 1 (demo) · 00:40 · Cameriere Demo · 54,00 € · Carta"),
    );
    expect(container.querySelectorAll("[data-session-id]")).toHaveLength(2);
  });

  it("says so when every table has its number", () => {
    render(createElement(MissingReceipts, { rows: [] }));
    expect(screen.getByText("Tutti i tavoli hanno il numero di scontrino.")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Tavoli chiusi senza numero di scontrino (0)" }),
    ).toBeTruthy();
  });

  it("shows no guest data: only table, time, staff name, total and payment", () => {
    const { container } = render(createElement(MissingReceipts, { rows: [ROW] }));
    expect(container.textContent).not.toMatch(/IVA|Costo|Margine/);
  });
});
