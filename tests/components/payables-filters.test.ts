// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ITEM } from "./payable-fixtures";

// M25b step 11 (plan §3.1.9): /pagamenti keeps stato, Dal, Al and Fornitore in the address, reads /api/payables with the English keys,
// and words its totals and hint for the filter in force. Dates are fixed fixture values. The component adds no money.
const S1 = "5a000000-0000-4000-8000-00000000005a";
const S2 = "5c000000-0000-4000-8000-00000000005c";
let query = "";
let role = "owner";
let reply: () => { ok: boolean; status: number; data?: unknown; error?: unknown };
const replace = vi.fn();
const calls: string[] = [];
const page = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  data: {
    payables: [ITEM],
    nextCursor: null,
    totals: { count: 1, amount: 1234.5 },
    today: "2026-12-03",
    ...over,
  },
});
const apiJson = vi.fn((path: string) => {
  calls.push(path);
  if (path === "/api/me") {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
        tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
      },
    });
  }
  if (path === "/api/suppliers?active=all") {
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
  if (path.startsWith("/api/payables")) return Promise.resolve(reply());
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}));

import PayablesPage from "@/app/(owner)/pagamenti/page";
import { resetMe } from "@/components/use-me";

const reads = () => calls.filter((c) => c.startsWith("/api/payables"));

beforeEach(() => {
  resetMe();
  role = "owner";
  query = "";
  reply = () => page();
  calls.length = 0;
  replace.mockClear();
  apiJson.mockClear();
});
afterEach(cleanup);

async function open() {
  render(createElement(PayablesPage));
  await screen.findByRole("group", { name: "Filtri" });
  await waitFor(() => expect(reads().length).toBeGreaterThan(0));
}

describe("PayablesPage filters", () => {
  it("reads once with the address's stato and range, and marks the button pressed", async () => {
    query = "stato=pagate&dal=2026-11-01";
    await open();
    expect(reads()).toEqual(["/api/payables?filter=paid&from=2026-11-01"]);
    expect(screen.getByRole("button", { name: "Pagate" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Da pagare" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("defaults to Da pagare with no query beyond the filter", async () => {
    await open();
    expect(reads()).toEqual(["/api/payables?filter=unpaid"]);
    expect(screen.getByRole("button", { name: "Da pagare" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("sends the supplier and both dates under their API keys", async () => {
    query = `dal=2026-11-01&al=2026-11-30&fornitore=${S1}`;
    await open();
    expect(reads()).toEqual([
      `/api/payables?filter=unpaid&from=2026-11-01&to=2026-11-30&supplier=${S1}`,
    ]);
    expect(calls.filter((c) => c === "/api/suppliers?active=all")).toHaveLength(1);
  });

  it("replaces the address when Tutte is chosen, keeping the filters", async () => {
    query = "dal=2026-11-01";
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Tutte" }));
    expect(replace).toHaveBeenCalledWith("/pagamenti?dal=2026-11-01&stato=tutte");
  });

  it("drops stato from the address when Da pagare is chosen", async () => {
    query = "stato=tutte";
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Da pagare" }));
    expect(replace).toHaveBeenCalledWith("/pagamenti");
  });

  it("clears every filter, stato included, on Azzera filtri", async () => {
    query = "stato=pagate&dal=2026-11-01";
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Azzera filtri" }));
    expect(replace).toHaveBeenCalledWith("/pagamenti");
    cleanup();
    query = "";
    calls.length = 0;
    await open();
    expect(reads()).toEqual(["/api/payables?filter=unpaid"]);
    expect(screen.getByRole("button", { name: "Da pagare" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("sends the same filters plus before on Mostra altri", async () => {
    query = `dal=2026-11-01&fornitore=${S1}`;
    reply = () => page({ nextCursor: `2026-12-10_${ITEM.id}` });
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Mostra altri" }));
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(reads()[1]).toBe(
      `/api/payables?filter=unpaid&from=2026-11-01&supplier=${S1}&before=2026-12-10_${ITEM.id}`,
    );
  });

  it("starts the totals line with Con questi filtri only while a filter is set", async () => {
    query = "dal=2026-11-01";
    await open();
    await screen.findByText(/^Con questi filtri: 1 fattura da pagare/);
    cleanup();
    query = "";
    await open();
    await screen.findByText(/^1 fattura da pagare/);
    expect(screen.queryByText(/Con questi filtri/)).toBeNull();
  });

  it("says no payment matches when a filtered read is empty", async () => {
    query = "dal=2026-11-01";
    reply = () => page({ payables: [], totals: { count: 0, amount: 0 } });
    await open();
    await screen.findByText("Nessun pagamento con questi filtri.");
    expect(screen.queryByText("Nessun pagamento in sospeso.")).toBeNull();
  });

  it("keeps the plain empty texts without a filter", async () => {
    reply = () => page({ payables: [], totals: { count: 0, amount: 0 } });
    await open();
    await screen.findByText("Nessun pagamento in sospeso.");
  });

  it.each([
    ["", "Date di scadenza"],
    ["stato=tutte", "Date di scadenza"],
    ["stato=pagate", "Date di pagamento"],
  ])("hints which date the range applies to (%j)", async (search, hint) => {
    query = search;
    await open();
    expect(screen.getByText(hint)).toBeTruthy();
  });

  it("says the start is after the end and reads no payables", async () => {
    query = "dal=2026-11-02&al=2026-11-01";
    render(createElement(PayablesPage));
    await screen.findByText("La data di inizio è dopo la data di fine.");
    expect(reads()).toEqual([]);
  });

  it("shows the reserved message on a 403, unchanged", async () => {
    reply = () => ({
      ok: false,
      status: 403,
      error: { code: "forbidden", message: "x" },
    });
    render(createElement(PayablesPage));
    await screen.findByText("I pagamenti non sono disponibili per il tuo ruolo.");
    expect(screen.queryByRole("group", { name: "Filtri" })).toBeNull();
  });

  it.each(["chef", "waiter"])(
    "shows the reserved message to a %s even when the range is reversed, never the date error",
    async (who) => {
      role = who;
      query = "dal=2026-11-02&al=2026-11-01";
      render(createElement(PayablesPage));
      await screen.findByText("I pagamenti non sono disponibili per il tuo ruolo.");
      expect(screen.queryByRole("group", { name: "Filtri" })).toBeNull();
      expect(screen.queryByText("La data di inizio è dopo la data di fine.")).toBeNull();
      expect(reads()).toEqual([]);
    },
  );
});
