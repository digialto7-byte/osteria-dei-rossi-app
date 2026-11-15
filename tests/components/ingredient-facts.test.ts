// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import { ING, ITEM, LOT } from "./stock-fixtures";

// P2f-3: the facts of an ingredient are a FactList in a padded card; the on-hand total is the bold figure.
const role = "owner";
// What /api/stock answers; a test swaps it for an ingredient with stock outside any lot.
let stockItem = ITEM;
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
  if (path === "/api/me")
    return ok({
      user: { id: "u", displayName: "Utente Demo", role },
      tenant: { id: "t", name: "Osteria Demo" },
    });
  if (path === "/api/locations") return ok({ locations: [] });
  if (path === "/api/stock") return ok({ items: [stockItem] });
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
  stockItem = ITEM;
});
afterEach(cleanup);

const draw = async () => {
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
};

describe("the ingredient page, the facts", () => {
  it("are a FactList in a card with the default padding, the total in <strong>, a row per location", async () => {
    await draw();
    const list = document.querySelector("dl")!;
    expect(list.className).toContain("grid-cols-[auto_minmax(min-content,1fr)]");
    const card = list.closest(".rounded-card")!;
    expect(card.className).toContain("gap-3");
    expect(card.className).not.toContain("py-1");
    expect(screen.getByTestId("fact-on-hand").textContent?.replace(/\s/g, " ")).toBe("12,3 kg");
    const onHand = screen.getByTestId("fact-on-hand");
    expect(onHand.querySelector("strong")?.textContent?.replace(/\s/g, " ")).toBe("12,3 kg");
    expect(onHand.querySelector(".font-bold")).toBeNull();
    const labels = [...list.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(labels).toEqual(["In giacenza", "Cella (demo)", "Freezer (demo)"]);
    expect(list.querySelector("dt")!.className).not.toContain("pr-4");
  });

  it("adds a Senza lotto row per location holding stock outside any lot, after the location rows", async () => {
    stockItem = {
      ...ITEM,
      locations: [{ ...ITEM.locations[0]!, onHandQty: 10, unlottedQty: 1.5 }, ITEM.locations[1]!],
    };
    await draw();
    const list = document.querySelector("dl")!;
    const labels = [...list.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(labels).toEqual([
      "In giacenza",
      "Cella (demo)",
      "Freezer (demo)",
      "Senza lotto · Cella (demo)",
    ]);
    const label = [...list.querySelectorAll("dt")].at(-1)!;
    const value = label.nextElementSibling!;
    expect(value.tagName).toBe("DD");
    expect(value.className).toContain("num");
    expect(value.textContent?.replace(/\s/g, " ")).toBe("1,5 kg");
    expect(list.querySelectorAll("dd")).toHaveLength(4);
  });
});
