// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import { PLATE } from "./cost-fixtures";

// UX plan B14: the breakdown on the owner's cost page and on the chef's margin page.
const KEY = "ec000000-0000-4000-8000-000000000004";
const target = (id: number, name: string) => ({
  kind: "ingredient" as const,
  id: `1a000000-0000-4000-8000-00000000000${id}`,
  name,
});
const base = {
  recipeKey: KEY,
  name: "Spezzatino con polenta (demo)",
  version: 1,
  at: null,
  status: "ok",
  incomplete: false,
  reasons: [],
  missingIngredients: [],
  foodCostPct: 18.8528,
  gpPct: 81.1472,
  targetGpPct: 70,
};
const sharesOf = [81.04, 14.59, 4.38];
const names = ["Manzo (demo)", "Pane (demo)", "Farina (demo)"];
const OWNER_DOC = {
  ...base,
  lines: sharesOf.map((sharePct, i) => ({
    position: i + 1,
    target: target(i + 1, names[i]!),
    sharePct,
    incomplete: false,
    reason: null,
    lineCostEur: [1.6667, 0.3, 0.09][i],
  })),
  money: { foodCostEur: 2.0567, salePriceExVatEur: 10.9091, grossMarginEur: 8.8524 },
};
const CHEF_DOC = {
  ...base,
  lines: sharesOf.map((sharePct, i) => ({
    position: i + 1,
    target: target(i + 1, names[i]!),
    sharePct,
    incomplete: false,
    reason: null,
  })),
};
const RECIPE_COST = (type: string) => ({
  cost: {
    recipeKey: KEY,
    recipeId: "ed000000-0000-4000-8000-000000000401",
    version: 1,
    type,
    name: "Spezzatino con polenta (demo)",
    at: null,
    totalCostEur: 2.0567,
    unitCostEur: 2.0567,
    costUnit: "porz",
    incomplete: false,
    reasons: [],
    missingIngredients: [],
    lines: [],
    plate: type === "plate" ? PLATE : null,
  },
});

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
let role = "owner";
let recipeType = "plate";
let breakdownReply: Reply;
const paths: string[] = [];
const apiJson = vi.fn((path: string): Promise<Reply> => {
  paths.push(path);
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
  if (path.startsWith(`/api/costs/plates/${KEY}`)) return Promise.resolve(breakdownReply);
  if (path.startsWith(`/api/recipes/${KEY}/cost`)) {
    return Promise.resolve({ ok: true, status: 200, data: RECIPE_COST(recipeType) });
  }
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import OwnerPage from "@/app/(owner)/costi/ricette/[key]/page";
import ChefPage from "@/app/(owner)/margini/[key]/page";

beforeEach(() => {
  resetMe();
  role = "owner";
  recipeType = "plate";
  breakdownReply = { ok: true, status: 200, data: OWNER_DOC };
  paths.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const open = async (page: typeof OwnerPage) => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      createElement(
        Suspense,
        { fallback: null },
        createElement(page, { params: Promise.resolve({ key: KEY }) }),
      ),
    );
  });
  return view;
};

describe("the owner's cost page for a plate", () => {
  it("shows the breakdown with euro figures and bars, from /api/costs/plates/:key", async () => {
    const { container } = await open(OwnerPage);
    await screen.findByRole("heading", { name: "Ripartizione del costo" });
    expect(paths).toContain(`/api/costs/plates/${KEY}`);
    const section = screen.getByRole("region", { name: "Ripartizione del costo" });
    expect(section.textContent).toMatch(/1,67\s€/);
    expect(section.textContent).toMatch(/81,0\s%/);
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(3);
    expect([...section.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      expect.stringContaining("Manzo (demo)"),
      expect.stringContaining("Pane (demo)"),
      expect.stringContaining("Farina (demo)"),
    ]);
  });

  it("keeps the existing cost lines below it", async () => {
    await open(OwnerPage);
    await screen.findByRole("heading", { name: "Ripartizione del costo" });
    expect(screen.getByText("Righe della ricetta")).toBeTruthy();
  });

  it("asks nothing about a batch recipe's breakdown", async () => {
    recipeType = "batch";
    await open(OwnerPage);
    await screen.findByText("Costo del lotto");
    expect(paths.some((p) => p.startsWith("/api/costs/plates/"))).toBe(false);
    expect(screen.queryByRole("heading", { name: "Ripartizione del costo" })).toBeNull();
  });

  it("a refused breakdown shows one alert and leaves the rest of the page", async () => {
    breakdownReply = {
      ok: false,
      status: 500,
      error: { code: "cost_unavailable", message: "Non disponibile." },
    };
    await open(OwnerPage);
    expect((await screen.findByRole("alert")).textContent).toBe("Non disponibile.");
    expect(screen.getByText("Costo del piatto")).toBeTruthy();
  });
});

describe("the chef's margin page for a plate", () => {
  beforeEach(() => {
    role = "chef";
    breakdownReply = { ok: true, status: 200, data: CHEF_DOC };
  });

  it("reads /api/costs/plates/:key with no query and shows percentages only, no euro sign anywhere", async () => {
    const { container } = await open(ChefPage);
    await screen.findByRole("heading", { name: "Ripartizione del costo" });
    expect(paths).toContain(`/api/costs/plates/${KEY}`);
    expect(paths.filter((p) => p.includes("?"))).toEqual([]);
    expect(container.textContent).toMatch(/81,0\s%/);
    expect(container.textContent).toMatch(/Food cost 18,9\s%/);
    expect(container.textContent).not.toContain("€");
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(3);
  });

  it("starts with a link back to the margins", async () => {
    const { container } = await open(ChefPage);
    await screen.findByRole("heading", { name: "Ripartizione del costo" });
    const first = container.querySelector("a")!;
    expect(first.getAttribute("href")).toBe("/margini");
    expect(first.textContent).toContain("Torna ai margini");
  });

  it("shows no euro sign even if the database sent a euro field by mistake (the page names what it draws)", async () => {
    breakdownReply = {
      ok: true,
      status: 200,
      data: { ...CHEF_DOC, lines: CHEF_DOC.lines.map((l) => ({ ...l, lineCostEur: 1.5 })) },
    };
    const { container } = await open(ChefPage);
    await screen.findByRole("heading", { name: "Ripartizione del costo" });
    expect(container.textContent).not.toContain("€");
  });

  it("a 403 (the waiter, by direct address) is the forbidden notice and no breakdown", async () => {
    role = "waiter";
    breakdownReply = {
      ok: false,
      status: 403,
      error: { code: "forbidden", message: "Operazione non consentita per il tuo ruolo." },
    };
    const { container } = await open(ChefPage);
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    expect(screen.getByRole("alert").textContent).toContain(
      "non sono disponibili per il tuo ruolo",
    );
    expect(screen.queryByRole("heading", { name: "Ripartizione del costo" })).toBeNull();
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(0);
  });

  it("an unknown plate is the server's not-found text", async () => {
    breakdownReply = {
      ok: false,
      status: 404,
      error: { code: "not_found", message: "Risorsa non trovata." },
    };
    await open(ChefPage);
    expect((await screen.findByRole("alert")).textContent).toBe("Risorsa non trovata.");
  });
});
