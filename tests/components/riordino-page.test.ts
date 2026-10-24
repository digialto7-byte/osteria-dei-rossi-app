// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INGREDIENT, RECIPE, SUPPLIER_ITEM } from "./rules-fixtures";

type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const replies = new Map<string, Result>();
const apiJson = vi.fn((path: string) =>
  Promise.resolve(
    replies.get(path) ?? {
      ok: false as const,
      status: 500,
      error: { code: "x", message: "boom" },
    },
  ),
);
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import RiordinoPage from "@/app/(owner)/riordino/page";

const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const incomplete = (n: number) => ({
  ...INGREDIENT,
  ingredientId: `1a000000-0000-4000-8000-0000000000${n}0`,
  status: "incomplete" as const,
  reasons: ["no_preferred_item"],
});

beforeEach(() => {
  replies.clear();
  apiJson.mockClear();
});
afterEach(cleanup);

describe("Riordino page", () => {
  it("shows the heading and three link cards with the server's counts", async () => {
    replies.set(
      "/api/rules/ingredients",
      ok({ today: "2026-11-02", items: [INGREDIENT, incomplete(1), incomplete(2), incomplete(3)] }),
    );
    replies.set("/api/rules/suppliers", ok({ items: [SUPPLIER_ITEM, SUPPLIER_ITEM] }));
    replies.set("/api/rules/recipes", ok({ items: [RECIPE] }));
    render(createElement(RiordinoPage));

    expect(screen.getByRole("heading", { name: "Riordino e preparazione" })).not.toBeNull();
    await waitFor(() => expect(screen.getByText("Ingredienti (3 da completare)")).not.toBeNull());
    expect(screen.getByText("Fornitori (2)")).not.toBeNull();
    expect(screen.getByText("Ricette (1)")).not.toBeNull();
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/riordino/ingredienti", "/riordino/fornitori", "/riordino/ricette"]);
  });

  it("reads the three endpoints and nothing else", async () => {
    replies.set("/api/rules/ingredients", ok({ today: "2026-11-02", items: [] }));
    replies.set("/api/rules/suppliers", ok({ items: [] }));
    replies.set("/api/rules/recipes", ok({ items: [] }));
    render(createElement(RiordinoPage));
    await waitFor(() => expect(screen.getByText("Ingredienti (0 da completare)")).not.toBeNull());
    expect(apiJson.mock.calls.map((c) => c[0]).sort()).toEqual([
      "/api/rules/ingredients",
      "/api/rules/recipes",
      "/api/rules/suppliers",
    ]);
  });

  it("a 403 (the waiter) renders one alert and no card", async () => {
    for (const path of ["/api/rules/ingredients", "/api/rules/suppliers", "/api/rules/recipes"]) {
      replies.set(path, {
        ok: false,
        status: 403,
        error: { code: "forbidden", message: "Operazione non consentita per il tuo ruolo." },
      });
    }
    render(createElement(RiordinoPage));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Il riordino non è disponibile per il tuo ruolo.",
      ),
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("another failure shows the server's message in one alert", async () => {
    replies.set("/api/rules/ingredients", {
      ok: false,
      status: 500,
      error: { code: "internal", message: "Errore interno. Riprova tra poco." },
    });
    replies.set("/api/rules/suppliers", ok({ items: [] }));
    replies.set("/api/rules/recipes", ok({ items: [] }));
    render(createElement(RiordinoPage));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Errore interno. Riprova tra poco."),
    );
  });
});
