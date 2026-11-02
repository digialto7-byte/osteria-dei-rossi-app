// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// M25b step 10 (plan §3.1.9): /fatture keeps "Dal / Al / Fornitore" in the address (router.replace), reads /api/invoices with the English
// keys and says what a filter leaves out. Dates here are fixed fixture values, never the calendar's today.
const S1 = "5a000000-0000-4000-8000-00000000005a";
const S2 = "5c000000-0000-4000-8000-00000000005c";
let query = "";
let invoices: unknown[] = [];
let invoiceReply: ((path: string) => Promise<unknown>) | null = null;
const replace = vi.fn();
const calls: string[] = [];
const apiJson = vi.fn((path: string) => {
  calls.push(path);
  if (path === "/api/me") {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        user: {
          id: "a0000000-0000-4000-8000-000000000001",
          displayName: "Utente Demo",
          role: "owner",
        },
        tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
      },
    });
  }
  if (path === "/api/suppliers") {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        suppliers: [
          { id: S1, name: "Fornitore Demo A" },
          { id: S2, name: "Fornitore Demo B" },
        ],
      },
    });
  }
  if (path.startsWith("/api/invoices") && invoiceReply) return invoiceReply(path);
  if (path.startsWith("/api/invoices"))
    return Promise.resolve({ ok: true, status: 200, data: { invoices } });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}));

import InvoicesPage from "@/app/(owner)/fatture/page";
import { resetMe } from "@/components/use-me";

const invoiceCalls = () => calls.filter((c) => c.startsWith("/api/invoices"));
const NOTE =
  "Le fatture ancora da leggere o da rivedere senza data o fornitore non compaiono con questi filtri.";

beforeEach(() => {
  resetMe();
  query = "";
  invoices = [];
  invoiceReply = null;
  calls.length = 0;
  replace.mockClear();
  apiJson.mockClear();
});
afterEach(cleanup);

async function open() {
  render(createElement(InvoicesPage));
  await screen.findByRole("group", { name: "Filtri" });
  await waitFor(() => expect(invoiceCalls().length).toBeGreaterThan(0));
}

describe("InvoicesPage filters", () => {
  it("reads the list with the address's filters and the suppliers once", async () => {
    query = `dal=2026-10-01&al=2026-10-31&fornitore=${S1}`;
    await open();
    expect(invoiceCalls()).toEqual([`/api/invoices?from=2026-10-01&to=2026-10-31&supplier=${S1}`]);
    expect(calls.filter((c) => c === "/api/suppliers")).toHaveLength(1);
    expect((screen.getByLabelText("Dal") as HTMLInputElement).value).toBe("2026-10-01");
  });

  it("reads /api/invoices with no query when no filter is set", async () => {
    await open();
    expect(invoiceCalls()).toEqual(["/api/invoices"]);
    expect(screen.queryByRole("button", { name: "Azzera filtri" })).toBeNull();
  });

  it("ignores a malformed filter in the address and never sends it", async () => {
    query = "dal=ieri&fornitore=abc";
    await open();
    expect(invoiceCalls()).toEqual(["/api/invoices"]);
  });

  it("replaces the address when another supplier is picked, keeping the dates", async () => {
    query = `dal=2026-10-01&al=2026-10-31&fornitore=${S1}`;
    await open();
    await screen.findByRole("option", { name: "Fornitore Demo B" });
    fireEvent.change(screen.getByLabelText("Fornitore"), { target: { value: S2 } });
    expect(replace).toHaveBeenCalledWith(`/fatture?dal=2026-10-01&al=2026-10-31&fornitore=${S2}`);
  });

  it("replaces the address with the bare path on Azzera filtri", async () => {
    query = "dal=2026-10-01";
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Azzera filtri" }));
    expect(replace).toHaveBeenCalledWith("/fatture");
  });

  it("says the start is after the end and reads no invoices", async () => {
    query = "dal=2026-11-02&al=2026-11-01";
    render(createElement(InvoicesPage));
    await screen.findByText("La data di inizio è dopo la data di fine.");
    expect(invoiceCalls()).toEqual([]);
  });

  it("says no invoice matches when a filtered read is empty", async () => {
    query = "dal=2026-10-01";
    await open();
    await screen.findByText("Nessuna fattura con questi filtri.");
    expect(screen.queryByText("Nessuna fattura caricata.")).toBeNull();
  });

  it("keeps the plain empty text without a filter", async () => {
    await open();
    await screen.findByText("Nessuna fattura caricata.");
    expect(screen.queryByText("Nessuna fattura con questi filtri.")).toBeNull();
  });

  it("notes what a filter leaves out, only while one is set", async () => {
    query = `fornitore=${S1}`;
    await open();
    expect(screen.getByText(NOTE)).toBeTruthy();
    cleanup();
    query = "";
    await open();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("drops the old list when the filters change, so a failed read leaves no stale rows", async () => {
    const row = {
      id: "c0000000-0000-4000-8000-0000000000c1",
      status: "approved",
      source: "upload",
      originalFilename: "vecchia.pdf",
      fileMime: "application/pdf",
      fileSizeBytes: 1000,
      supplierVat: null,
      number: "FV-1",
      invoiceDate: "2026-10-02",
      duplicateOf: null,
      duplicateWarningOf: null,
      supplierName: "Fornitore Vecchio",
      dueDate: null,
      netTotal: 100,
      vatTotal: 22,
      grossTotal: 122,
      totalsDiff: 0,
      gateFlags: [],
      extractionError: null,
      attempts: 1,
      extractedAt: "2026-10-02T08:00:00Z",
      createdAt: "2026-10-02T08:00:00Z",
    };
    invoiceReply = (path) =>
      Promise.resolve(
        path === "/api/invoices"
          ? { ok: true, status: 200, data: { invoices: [row] } }
          : {
              ok: false,
              status: 500,
              error: { code: "internal", message: "Lettura non riuscita." },
            },
      );
    const view = render(createElement(InvoicesPage));
    await screen.findByText(/FV-1/);
    query = "dal=2026-10-01";
    view.rerender(createElement(InvoicesPage));
    await screen.findByText("Lettura non riuscita.");
    expect(screen.queryByText(/FV-1/)).toBeNull();
  });
});
