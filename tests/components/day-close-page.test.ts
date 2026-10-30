// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT, REPORT_NO_REGISTER } from "../helpers/bill-data";

// The end-of-day page reads ONLY /api/reports/app-vs-register and writes ONLY POST /api/day-close; the reply of the save replaces the report
// (no second read). Here apiJson answers the reads and records every call.
type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

let reportReply: Result;
let saveReply: Result;
let query = "";
const push = vi.fn();
const calls: Array<{ path: string; init: Init }> = [];
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (path.startsWith("/api/reports/app-vs-register")) return Promise.resolve(reportReply);
  if (path === "/api/day-close") return Promise.resolve(saveReply);
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push, replace: push }),
}));

import DayClosePage from "@/app/(owner)/chiusura/page";

beforeEach(() => {
  reportReply = ok(REPORT);
  saveReply = ok({ changed: true, report: REPORT });
  query = "";
  calls.length = 0;
  push.mockClear();
  apiJson.mockClear();
});
afterEach(cleanup);

const reads = () => calls.filter((c) => !c.init?.method);
const writes = () => calls.filter((c) => c.init?.method);
const nb = (s: string) => s.replace(/(\d) (€|%)/g, "$1" + String.fromCharCode(160) + "$2");
// getByText normalises the no-break space away, so amounts are matched on the element's exact text instead.
const byText = (expected: string) =>
  screen.getByText(
    (_content, element) => element?.textContent === expected && element.children.length === 0,
  );
const byTextAsync = (expected: string) =>
  screen.findByText(
    (_content, element) => element?.textContent === expected && element.children.length === 0,
  );
const open = async () => {
  render(createElement(DayClosePage));
  await screen.findByRole("heading", { name: "Chiusura di cassa" });
  await screen.findByText(/^Totale app/);
};

describe("the end-of-day page", () => {
  it("reads today's report when no date is given, and the chosen date otherwise", async () => {
    await open();
    expect(reads().map((c) => c.path)).toEqual(["/api/reports/app-vs-register"]);
    cleanup();
    calls.length = 0;
    query = "data=2026-11-04";
    await open();
    expect(reads().map((c) => c.path)).toEqual(["/api/reports/app-vs-register?date=2026-11-04"]);
  });

  it("titles the page with the business date", async () => {
    await open();
    expect(screen.getByText("Giornata di mercoledì 4 novembre")).toBeTruthy();
  });

  it("shows the app's total, tables and covers, and the totals by document and payment", async () => {
    await open();
    expect(byText(nb("Totale app 1.234,50 € · 3 tavoli · 6 coperti"))).toBeTruthy();
    expect(byText(nb("Scontrino 1.134,50 € · 2 tavoli"))).toBeTruthy();
    expect(byText(nb("Fattura 100,00 € · 1 tavolo"))).toBeTruthy();
    expect(byText(nb("Contanti 134,50 € · 1 tavolo"))).toBeTruthy();
    expect(byText(nb("Carta 1.000,00 € · 1 tavolo"))).toBeTruthy();
    expect(byText(nb("Altro 100,00 € · 1 tavolo"))).toBeTruthy();
  });

  it("shows the difference, the missing receipts, the open tables and the late operations", async () => {
    await open();
    expect(byText(nb("L'app registra 12,50 € in più della cassa"))).toBeTruthy();
    const row = document.querySelector(
      `[data-session-id="${REPORT.missingReceipts[0]!.sessionId}"]`,
    ) as HTMLElement;
    expect(row.textContent).toBe(
      nb("Tavolo 2 (demo) · 00:40 · Cameriere Demo · 134,50 € · Contanti"),
    );
    expect(byText(nb("Tavoli ancora aperti: 2 (totale provvisorio 32,00 €)"))).toBeTruthy();
    expect(screen.getByText("Operazioni arrivate dopo la chiusura del tavolo: 2")).toBeTruthy();
    expect(
      screen.getByText(
        "Piatti inviati da un telefono offline dopo la chiusura: non sono nel totale dell'app.",
      ),
    ).toBeTruthy();
  });

  it("leaves out the open tables and late operations lines when there are none", async () => {
    reportReply = ok({
      ...REPORT,
      openTables: { count: 0, provisionalTotal: 0 },
      lateOps: { count: 0 },
    });
    await open();
    expect(screen.queryByText(/Tavoli ancora aperti/)).toBeNull();
    expect(screen.queryByText(/Operazioni arrivate dopo/)).toBeNull();
  });

  it("saving posts the total as a string with the day shown, and the reply replaces the report without a second read", async () => {
    await open();
    saveReply = ok({
      changed: true,
      report: {
        ...REPORT,
        register: { ...REPORT.register!, total: 1240, entries: 2 },
        difference: { amount: -5.5, pct: -0.4 },
      },
    });
    fireEvent.change(screen.getByLabelText("Totale del registratore di cassa"), {
      target: { value: "1.240,00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/day-close",
      init: { method: "POST", body: { registerTotal: "1240.00", businessDate: "2026-11-04" } },
    });
    expect(await byTextAsync(nb("L'app registra 5,50 € in meno della cassa"))).toBeTruthy();
    expect(screen.getByText("2 inserimenti")).toBeTruthy();
    expect(reads()).toHaveLength(1);
  });

  it("an amount that is not an amount posts nothing", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Totale del registratore di cassa"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect(writes()).toHaveLength(0);
    expect((await screen.findByRole("alert")).textContent).toBe("Scrivi un importo come 1.234,50");
  });

  it("a refused save says why and keeps the report", async () => {
    await open();
    saveReply = {
      ok: false,
      status: 422,
      error: {
        code: "business_date_invalid",
        message: "La data non è valida: puoi scegliere fino a 62 giorni fa.",
      },
    };
    fireEvent.change(screen.getByLabelText("Totale del registratore di cassa"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La data non è valida: puoi scegliere fino a 62 giorni fa.",
    );
    expect(screen.getByText(/^Totale app/)).toBeTruthy();
  });

  it("without a register entry it asks for the total", async () => {
    reportReply = ok(REPORT_NO_REGISTER);
    await open();
    expect(
      screen.getByText("Inserisci il totale della cassa per vedere la differenza"),
    ).toBeTruthy();
  });

  it("the previous-day button and the date field move to another day through the address", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Giorno precedente" }));
    expect(push).toHaveBeenCalledWith("/chiusura?data=2026-11-03");
    fireEvent.change(screen.getByLabelText("Giorno"), { target: { value: "2026-10-30" } });
    expect(push).toHaveBeenLastCalledWith("/chiusura?data=2026-10-30");
  });

  it("a waiter or a chef (403) gets one message and no form", async () => {
    reportReply = { ok: false, status: 403, error: { code: "forbidden", message: "x" } };
    render(createElement(DayClosePage));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La chiusura di cassa è riservata al titolare.",
    );
    expect(screen.queryByLabelText("Totale del registratore di cassa")).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("an unreachable server says so", async () => {
    reportReply = {
      ok: false,
      status: 0,
      error: { code: "network", message: "Connessione assente." },
    };
    render(createElement(DayClosePage));
    expect((await screen.findByRole("alert")).textContent).toBe("Connessione assente.");
  });

  it("shows no cost, margin or food cost", async () => {
    await open();
    expect(document.body.textContent).not.toMatch(/Costo|Margine|Food cost|\bGP\b/);
  });
});
