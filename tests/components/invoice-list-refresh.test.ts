// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INVOICE_REFRESH_MS } from "@/server/invoices/constants";

const row = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id,
  status,
  source: "upload",
  originalFilename: `${id}.jpg`,
  fileMime: "image/jpeg",
  fileSizeBytes: 100,
  supplierVat: null,
  number: null,
  invoiceDate: null,
  duplicateOf: null,
  duplicateWarningOf: null,
  supplierName: null,
  dueDate: null,
  netTotal: null,
  vatTotal: null,
  grossTotal: null,
  totalsDiff: null,
  gateFlags: [],
  extractionError: null,
  attempts: 0,
  extractedAt: null,
  createdAt: "2026-10-21T08:00:00Z",
  ...over,
});
let invoices: ReturnType<typeof row>[] = [];
const apiJson = vi.fn((path: string) => {
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
  if (path === "/api/invoices")
    return Promise.resolve({ ok: true, status: 200, data: { invoices } });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import InvoicesPage from "@/app/(owner)/fatture/page";
import { resetMe } from "@/components/use-me";

const listReads = () => apiJson.mock.calls.filter(([p]) => p === "/api/invoices").length;

beforeEach(() => {
  vi.useFakeTimers();
  resetMe();
  apiJson.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function open() {
  await act(async () => {
    render(createElement(InvoicesPage));
    await vi.advanceTimersByTimeAsync(0);
  });
}
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("the invoice list while invoices are being read", () => {
  it("is a few seconds, not a busy loop", () => {
    expect(INVOICE_REFRESH_MS).toBeGreaterThanOrEqual(2_000);
    expect(INVOICE_REFRESH_MS).toBeLessThanOrEqual(10_000);
  });

  it("reads again every interval while a row is received or extracting, and the row changes without a reload", async () => {
    invoices = [row("a", "extracting"), row("b", "approved")];
    await open();
    expect(listReads()).toBe(1);
    expect(screen.getAllByTestId("invoice-status").map((e) => e.textContent)).toContain(
      "In lettura",
    );

    invoices = [
      row("a", "review", { supplierName: "Fornitore Demo Srl", number: "123/A" }),
      row("b", "approved"),
    ];
    await tick(INVOICE_REFRESH_MS + 50);
    expect(listReads()).toBe(2);
    expect(screen.queryByText("In lettura")).toBeNull();
    expect(screen.getByText("Fornitore Demo Srl · 123/A")).toBeTruthy();
  });

  it("stops when no row is in flight any more", async () => {
    invoices = [row("a", "received")];
    await open();
    invoices = [row("a", "review")];
    await tick(INVOICE_REFRESH_MS + 50);
    expect(listReads()).toBe(2);
    await tick(INVOICE_REFRESH_MS * 5);
    expect(listReads()).toBe(2);
  });

  it("never polls a list with nothing in flight", async () => {
    invoices = [row("a", "approved"), row("b", "extraction_failed")];
    await open();
    await tick(INVOICE_REFRESH_MS * 5);
    expect(listReads()).toBe(1);
  });

  it("stops polling when the page goes away", async () => {
    invoices = [row("a", "received")];
    await open();
    cleanup();
    await tick(INVOICE_REFRESH_MS * 3);
    expect(listReads()).toBe(1);
  });
});
