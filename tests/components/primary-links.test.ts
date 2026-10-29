// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import { primaryLinkClass } from "@/components/ui";
import { BATCH } from "./recipe-fixtures";

// UX plan C3 (P2-3): "Nuova produzione", "Nuova ricetta" and "Nuova versione" only navigate, so they are links
// (`<a href>`, with the primary look): a long-press or a new tab works and the role reads as "link".

let recipe = BATCH;
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
  if (path === "/api/me") {
    return ok({
      user: {
        id: "a0000000-0000-4000-8000-000000000001",
        displayName: "Utente Demo",
        role: "owner",
      },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
    });
  }
  if (path.startsWith("/api/batches")) return ok({ items: [], nextCursor: null });
  if (path.startsWith("/api/recipes/")) return ok({ recipe });
  if (path.startsWith("/api/recipes")) return ok({ recipes: [] });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
const push = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

import ProductionPage from "@/app/(owner)/produzione/page";
import RecipesPage from "@/app/(owner)/ricette/page";
import RecipePage from "@/app/(owner)/ricette/[key]/page";

beforeEach(() => {
  resetMe();
  recipe = BATCH;
  push.mockClear();
  apiJson.mockClear();
});
afterEach(cleanup);

function expectPrimaryLink(name: string, href: string) {
  const link = screen.getByRole("link", { name });
  expect(link.tagName).toBe("A");
  expect(link.getAttribute("href")).toBe(href);
  for (const cls of primaryLinkClass.split(" ")) expect(link.classList.contains(cls)).toBe(true);
  expect(screen.queryByRole("button", { name })).toBeNull();
}

describe("navigation actions are links", () => {
  it("Produzione: 'Nuova produzione' goes to /produzione/nuova", async () => {
    render(createElement(ProductionPage));
    await screen.findByRole("link", { name: "Nuova produzione" });
    expectPrimaryLink("Nuova produzione", "/produzione/nuova");
  });

  it("Ricette: 'Nuova ricetta' goes to /ricette/nuova", async () => {
    render(createElement(RecipesPage));
    await screen.findByRole("link", { name: "Nuova ricetta" });
    expectPrimaryLink("Nuova ricetta", "/ricette/nuova");
  });

  it("a recipe: 'Nuova versione' goes to its nuova-versione page", async () => {
    await act(async () => {
      render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(RecipePage, { params: Promise.resolve({ key: BATCH.key }) }),
        ),
      );
    });
    await screen.findByRole("link", { name: "Nuova versione" });
    expectPrimaryLink("Nuova versione", `/ricette/${BATCH.key}/nuova-versione`);
  });

  it("an inactive recipe offers no 'Nuova versione' link", async () => {
    recipe = { ...BATCH, isActive: false };
    await act(async () => {
      render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(RecipePage, { params: Promise.resolve({ key: BATCH.key }) }),
        ),
      );
    });
    await screen.findByRole("button", { name: "Riattiva" });
    expect(screen.queryByRole("link", { name: "Nuova versione" })).toBeNull();
  });
});
