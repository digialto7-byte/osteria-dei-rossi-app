// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import { BATCH_DETAIL, BATCH_ID } from "./batch-fixtures";
import { ING, ITEM, LOT, LOT_ID } from "./stock-fixtures";

// The pages hand the role's right to the trace to their rows: owner, admin and chef get the links, the others none.
let role = "chef";
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
  if (path === "/api/me")
    return ok({
      user: { id: "u", displayName: "Utente Demo", role },
      tenant: { id: "t", name: "Osteria Demo" },
    });
  if (path.startsWith("/api/batches/")) return ok(BATCH_DETAIL);
  if (path === "/api/locations") return ok({ locations: [] });
  if (path === "/api/stock") return ok({ items: [ITEM] });
  if (path.startsWith("/api/stock/lots"))
    return ok({
      ingredient: { id: ING, name: "Manzo muscolo (demo)", baseUnit: "kg" },
      today: "1998-11-14",
      units: ["kg"],
      locations: [],
      lots: [LOT, { ...LOT, rawLotId: null, lotCode: null }],
    });
  if (path.startsWith("/api/stock/movements")) return ok({ operations: [], nextCursor: null });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import BatchPage from "@/app/(owner)/produzione/[id]/page";
import StockPage from "@/app/(owner)/magazzino/[ingredientId]/page";

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
});
afterEach(cleanup);

const open = async (page: unknown, params: object) => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      createElement(
        Suspense,
        { fallback: null },
        createElement(page as never, { params: Promise.resolve(params) }),
      ),
    );
  });
  return view;
};

describe.each(["owner", "admin", "chef"])("the %s", (who) => {
  beforeEach(() => {
    role = who;
  });

  it("sees 'Tracciabilità' on a batch", async () => {
    const view = await open(BatchPage, { id: BATCH_ID });
    await screen.findByRole("heading", { level: 1 });
    expect(
      view.container.querySelector(`a[href="/tracciabilita/produzione/${BATCH_ID}"]`),
    ).not.toBeNull();
  });

  it("sees 'Traccia' on each real lot, not on 'Senza lotto'", async () => {
    const view = await open(StockPage, { ingredientId: ING });
    await screen.findByRole("heading", { level: 1 });
    const links = [...view.container.querySelectorAll('a[href^="/tracciabilita/lotto/"]')];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([`/tracciabilita/lotto/${LOT_ID}`]);
  });
});

describe("a role without the trace", () => {
  it("sees neither link", async () => {
    role = "waiter";
    const batch = await open(BatchPage, { id: BATCH_ID });
    await screen.findByRole("heading", { level: 1 });
    expect(batch.container.querySelector('a[href^="/tracciabilita"]')).toBeNull();
    cleanup();
    const stock = await open(StockPage, { ingredientId: ING });
    await screen.findByRole("heading", { level: 1 });
    expect(stock.container.querySelector('a[href^="/tracciabilita"]')).toBeNull();
  });
});
