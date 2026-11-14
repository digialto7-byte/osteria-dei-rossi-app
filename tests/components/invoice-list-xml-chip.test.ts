// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const row = (id: string, fileMime: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "review",
  source: "upload",
  originalFilename: `${id}.bin`,
  fileMime,
  fileSizeBytes: 100,
  supplierVat: null,
  number: "FT 12",
  invoiceDate: "1998-11-03",
  duplicateOf: null,
  duplicateWarningOf: null,
  supplierName: "Fornitore Demo 1",
  dueDate: null,
  netTotal: null,
  vatTotal: null,
  grossTotal: 1234.5,
  totalsDiff: null,
  gateFlags: [],
  extractionError: null,
  attempts: 0,
  extractedAt: null,
  createdAt: "1998-11-03T08:00:00Z",
  ...over,
});
const invoices = [
  row("a1", "application/xml"),
  row("a2", "application/pkcs7-mime"),
  row("a3", "application/pdf"),
  row("a4", "image/jpeg"),
];
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import InvoicesPage from "@/app/(owner)/fatture/page";
import { resetMe } from "@/components/use-me";

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
});
afterEach(() => cleanup());

async function open() {
  await act(async () => {
    render(createElement(InvoicesPage));
  });
  await screen.findAllByTestId("invoice-status");
}

describe("the invoice list's source chip", () => {
  it("puts XML after the status on an XML row and XML firmato on a signed one", async () => {
    await open();
    const rows = screen.getAllByRole("listitem");
    const chips = (index: number) =>
      within(rows[index]!)
        .queryAllByTestId("invoice-source")
        .map((chip) => chip.textContent);
    expect(chips(0)).toEqual(["XML"]);
    expect(chips(1)).toEqual(["XML firmato"]);
  });

  it("keeps the status badge first in the row, the source after it", async () => {
    await open();
    const first = screen.getAllByRole("listitem")[0]!;
    const status = within(first).getByTestId("invoice-status");
    const chip = within(first).getByTestId("invoice-source");
    expect(status.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no source chip on a PDF or a photo row", async () => {
    await open();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[2]!).queryByTestId("invoice-source")).toBeNull();
    expect(within(rows[3]!).queryByTestId("invoice-source")).toBeNull();
  });
});
