// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

let role = "owner";
const paths: string[] = [];
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
  paths.push(path);
  if (path === "/api/me") {
    return ok({
      user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
    });
  }
  if (path.startsWith("/api/suppliers")) return ok({ suppliers: [] });
  if (path.startsWith("/api/ingredients")) return ok({ ingredients: [] });
  if (path.startsWith("/api/locations")) return ok({ locations: [] });
  if (path.startsWith("/api/stock")) return ok({ items: [], totals: {} });
  if (path.startsWith("/api/costs/plates/percentages")) return ok({ plates: [] });
  if (path.startsWith("/api/costs/plates")) return ok({ at: null, fixedCost: null, plates: [] });
  if (path.startsWith("/api/recipes")) return ok({ recipes: [] });
  if (path.startsWith("/api/tables")) return ok({ tables: [], coperto: null });
  if (path.startsWith("/api/devices")) return ok({ devices: [], pendingCodes: [] });
  if (path.startsWith("/api/counts/critical")) return ok({ items: [], criticalCount: 0 });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

import SuppliersPage from "@/app/(owner)/anagrafiche/fornitori/page";
import IngredientsPage from "@/app/(owner)/anagrafiche/ingredienti/page";
import CostsPage from "@/app/(owner)/costi/page";
import DevicesPage from "@/app/(owner)/dispositivi/page";
import CriticalPage from "@/app/(owner)/magazzino/conteggi/critici/page";
import StockPage from "@/app/(owner)/magazzino/page";
import MarginsPage from "@/app/(owner)/margini/page";
import RecipesPage from "@/app/(owner)/ricette/page";
import TablesPage from "@/app/(owner)/tavoli/page";

beforeEach(() => {
  resetMe();
  role = "owner";
  paths.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

/** Renders the page and waits until /api/me has answered and React has drawn the answer. */
async function open(element: ReturnType<typeof createElement>, who: string) {
  role = who;
  const view = render(element);
  await waitFor(() => expect(paths).toContain("/api/me"));
  await act(async () => {
    await apiJson.mock.results[paths.indexOf("/api/me")]!.value;
  });
  return view;
}
/** The link inside the empty state's block (the paragraph with the text and what follows it). */
const emptyLinks = (text: RegExp) => {
  const block = screen.getByText(text).parentElement!;
  return within(block).queryAllByRole("link");
};

const CASES = [
  {
    name: "Fornitori",
    page: () => createElement(SuppliersPage),
    text: /Nessun elemento\./,
    owner: ["Importa da file", "/anagrafiche/importa"],
    other: "chef",
  },
  {
    name: "Ingredienti",
    page: () => createElement(IngredientsPage),
    text: /Nessun elemento\./,
    owner: ["Importa da file", "/anagrafiche/importa"],
    other: "chef",
  },
  {
    name: "Magazzino",
    page: () => createElement(StockPage),
    text: /Nessuna merce in magazzino/,
    owner: ["Vai alle fatture", "/fatture"],
    other: "chef",
  },
  {
    name: "Costi",
    page: () => createElement(CostsPage),
    text: /Nessun piatto attivo/,
    owner: ["Crea una ricetta", "/ricette/nuova"],
    other: null,
  },
  {
    name: "Ricette",
    page: () => createElement(RecipesPage),
    text: /Nessuna ricetta\./,
    owner: ["Importa da file", "/anagrafiche/importa"],
    other: "chef",
  },
  {
    name: "Tavoli",
    page: () => createElement(TablesPage),
    text: /Non ci sono ancora tavoli/,
    owner: ["Aggiungi i tavoli", "/tavoli/impostazioni"],
    other: "waiter",
  },
  {
    name: "Dispositivi",
    page: () => createElement(DevicesPage),
    text: /Nessun dispositivo abilitato/,
    owner: ["Aggiungi il personale", "/personale"],
    other: null,
  },
  {
    name: "Conteggio critici",
    page: () => createElement(CriticalPage),
    text: /Nessun ingrediente a magazzino/,
    owner: ["Vai alle fatture", "/fatture"],
    other: "chef",
  },
] as const;

describe.each(CASES)("$name, empty", ({ page, text, owner, other }) => {
  it.each(["owner", "admin"])("gives the %s one next step after the text", async (who) => {
    await open(page(), who);
    await screen.findByText(text);
    const links = emptyLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe(owner[0]);
    expect(links[0]!.getAttribute("href")).toBe(owner[1]);
  });

  if (other) {
    it(`gives the ${other} the text and no link`, async () => {
      await open(page(), other);
      await screen.findByText(text);
      expect(emptyLinks(text)).toHaveLength(0);
    });
  }
});

describe("Margini, empty (chef)", () => {
  it("offers Crea una ricetta", async () => {
    await open(createElement(MarginsPage), "chef");
    await screen.findByText(/Nessun piatto attivo/);
    const links = emptyLinks(/Nessun piatto attivo/);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/ricette/nuova"]);
  });
});

describe("Magazzino, empty (chef)", () => {
  it("says the owner approves the invoices", async () => {
    await open(createElement(StockPage), "chef");
    expect(await screen.findByText(/il titolare .*fatture/)).toBeTruthy();
  });
});
