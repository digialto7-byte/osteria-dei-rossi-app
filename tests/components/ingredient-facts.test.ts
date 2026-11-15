// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import { ING, ITEM, LOT } from "./stock-fixtures";

// P2f-3: the facts of an ingredient are a FactList in a padded card; the on-hand total is the bold figure.
let role = "chef";
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
  if (path === "/api/me")
    return ok({
      user: { id: "u", displayName: "Utente Demo", role },
      tenant: { id: "t", name: "Osteria Demo" },
    });
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

import StockPage from "@/app/(owner)/magazzino/[ingredientId]/page";

beforeEach(() => {
  resetMe();
  role = "owner";
});
afterEach(cleanup);

describe("the ingredient page, the facts", () => {
  it("are a FactList in a card with the default padding, the total in bold, a row per location", async () => {
    await act(async () => {
      render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(StockPage as never, { params: Promise.resolve({ ingredientId: ING }) }),
        ),
      );
    });
    await screen.findByRole("heading", { level: 1 });
    const list = document.querySelector("dl")!;
    expect(list.className).toContain("grid-cols-[auto_minmax(min-content,1fr)]");
    const card = list.closest(".rounded-card")!;
    expect(card.className).toContain("gap-3");
    expect(card.className).not.toContain("py-1");
    expect(screen.getByTestId("fact-on-hand").textContent?.replace(/\s/g, " ")).toBe("12,3 kg");
    expect(screen.getByTestId("fact-on-hand").querySelector(".font-bold")).not.toBeNull();
    const labels = [...list.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(labels).toEqual(["In giacenza", "Cella (demo)", "Freezer (demo)"]);
    expect(list.querySelector("dt")!.className).not.toContain("pr-4");
  });
});
