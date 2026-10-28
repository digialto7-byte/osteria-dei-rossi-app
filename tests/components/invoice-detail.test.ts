// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { primaryLinkClass } from "@/components/ui";

const ID = "e1000000-0000-4000-8000-0000000000e1";
const invoice = (over: Record<string, unknown> = {}) => ({
  id: ID,
  status: "review",
  source: "upload",
  originalFilename: "IMG_2041.jpg",
  fileMime: "image/jpeg",
  fileSizeBytes: 123456,
  supplierVat: null,
  number: "123/A",
  invoiceDate: "2026-10-20",
  duplicateOf: null,
  duplicateWarningOf: null,
  supplierName: "Fornitore Demo Srl",
  dueDate: null,
  netTotal: null,
  vatTotal: null,
  grossTotal: null,
  totalsDiff: null,
  gateFlags: [],
  extractionError: null,
  attempts: 1,
  extractedAt: null,
  createdAt: "2026-10-21T08:00:00Z",
  ...over,
});
let current = invoice();
const apiJson = vi.fn((path: string) => {
  if (path === `/api/invoices/${ID}`)
    return Promise.resolve({ ok: true, status: 200, data: { invoice: current } });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import InvoicePage from "@/app/(owner)/fatture/[id]/page";

beforeEach(() => {
  vi.useRealTimers();
  current = invoice();
  apiJson.mockClear();
});
afterEach(cleanup);

async function open() {
  await act(async () => {
    render(
      createElement(
        Suspense,
        { fallback: null },
        createElement(InvoicePage, { params: Promise.resolve({ id: ID }) }),
      ),
    );
  });
  await screen.findByRole("heading", { level: 1 });
}

describe("the invoice page", () => {
  it("is titled by the supplier and the number, with the file name kept below", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Fornitore Demo Srl · 123/A",
    );
    expect(screen.getByText("IMG_2041.jpg")).toBeTruthy();
  });

  it("falls back to the file name before the invoice has been read", async () => {
    current = invoice({ status: "received", supplierName: null, number: null });
    await open();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("IMG_2041.jpg");
  });

  it.each(["review", "duplicate"])(
    "%s: Rivedi le righe is the primary link and Apri il documento is secondary",
    async (status) => {
      current = invoice({ status });
      await open();
      const review = screen.getByRole("link", { name: "Rivedi le righe" });
      expect(review.getAttribute("href")).toBe(`/fatture/${ID}/revisione`);
      for (const part of primaryLinkClass.split(" ")) expect(review.className).toContain(part);
      const open_ = screen.getByRole("button", { name: "Apri il documento" });
      expect(open_.className).not.toContain("bg-accent");
    },
  );

  it.each(["received", "extracting", "approved", "rejected", "extraction_failed"])(
    "%s: no Rivedi le righe, and Apri il documento keeps the primary style",
    async (status) => {
      current = invoice({ status });
      await open();
      expect(screen.queryByRole("link", { name: "Rivedi le righe" })).toBeNull();
      expect(screen.getByRole("button", { name: "Apri il documento" }).className).toContain(
        "bg-accent",
      );
    },
  );
});

describe("the invoice page while the invoice is being read", () => {
  it("reads it again until it has been read, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    current = invoice({ status: "extracting", supplierName: null, number: null });
    await act(async () => {
      render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(InvoicePage, { params: Promise.resolve({ id: ID }) }),
        ),
      );
    });
    expect(apiJson).toHaveBeenCalledTimes(1);
    current = invoice({ status: "review" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100);
    });
    expect(apiJson).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "Rivedi le righe" })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(apiJson).toHaveBeenCalledTimes(2);
  });
});
