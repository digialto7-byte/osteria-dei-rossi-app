// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDashboard } from "@/server/dashboard/render";
import { dashboardSqlSchema } from "@/server/dashboard/sql-schema";
import { adminSql, ownerSql } from "../fixtures/dashboard-sql";

let role = "owner";
type Reply =
  { ok: true; status: 200; data: unknown } | { ok: false; status: number; error: unknown };
let dashboardReply: () => Promise<Reply>;
let todayReply: () => Promise<Reply>;
const apiJson = vi.fn((path: string): Promise<Reply> => {
  if (path === "/api/dashboard") return dashboardReply();
  if (path === "/api/today") return todayReply();
  return Promise.resolve({
    ok: true,
    status: 200,
    data: {
      user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo", isDemo: false },
    },
  });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import HomePage from "@/app/(owner)/page";
import { resetMe } from "@/components/use-me";

const OWNER = renderDashboard(dashboardSqlSchema.parse(ownerSql()), "it");
const ADMIN = renderDashboard(dashboardSqlSchema.parse(adminSql()), "it");
const reply =
  (data: unknown): (() => Promise<Reply>) =>
  () =>
    Promise.resolve({ ok: true, status: 200, data });
const CHEF_TODAY = {
  cards: [
    { key: "alerts", count: 2, more: false, href: "/avvisi" },
    { key: "batchesUseBy", count: 1, more: false, href: "/produzione" },
    { key: "countOpen", count: 1, more: false, href: "/magazzino/conteggi" },
  ],
  setup: null,
};

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
  replace.mockClear();
  role = "owner";
  dashboardReply = reply(OWNER);
  todayReply = reply(CHEF_TODAY);
});
afterEach(cleanup);

const open = async (who: string) => {
  role = who;
  const view = render(createElement(HomePage));
  await screen.findByRole("heading", { name: /Utente Demo/ });
  return view;
};
const tileKeys = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-testid=dashboard-tiles] > [data-tile]")].map((el) =>
    el.getAttribute("data-tile"),
  );

describe("Oggi is the dashboard for the owner", () => {
  it("makes one request to /api/dashboard and none to /api/today", async () => {
    await open("owner");
    await screen.findByText("Fatture da rivedere · 2");
    expect(apiJson.mock.calls.map(([p]) => p)).toEqual(["/api/me", "/api/dashboard"]);
  });

  it("shows the to-do block from today, then the tiles in the owner's order", async () => {
    const { container } = await open("owner");
    await screen.findByText("Fatture da rivedere · 2");
    expect(screen.getByRole("heading", { name: "Primi passi" })).toBeTruthy();
    await screen.findByTestId("dashboard-tiles");
    expect(tileKeys(container)).toEqual([
      "todayLists",
      "plates",
      "foodCost",
      "payables",
      "stockAtRisk",
      "waste",
      "priceVariance",
      "fixedCosts",
      "comingSoon",
    ]);
    const todos = screen.getByRole("heading", { name: "Primi passi" });
    const tiles = screen.getByTestId("dashboard-tiles");
    expect(todos.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("wraps the page as a wide layout", async () => {
    const { container } = await open("owner");
    await screen.findByTestId("dashboard-tiles");
    expect(container.querySelector('[data-layout="wide"]')).not.toBeNull();
  });

  it("says the dashboard is loading while the tiles are not there, and keeps the actions", async () => {
    dashboardReply = () => new Promise(() => {});
    await open("owner");
    expect(screen.getByText("Caricamento del cruscotto…")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-tiles")).toBeNull();
    expect(screen.getByRole("link", { name: /^Carica una fattura/ })).toBeTruthy();
  });

  it("the plates tile names its rows by recipe key", async () => {
    const { container } = await open("owner");
    await screen.findByTestId("dashboard-tiles");
    const plates = container.querySelector('[data-tile="plates"]')!;
    expect(within(plates as HTMLElement).getByText("Tagliatelle (fixture)")).toBeTruthy();
    expect(plates.querySelector("[data-recipe-key]")).not.toBeNull();
  });
});

describe("Oggi for the admin", () => {
  it("has no Da fare oggi, Aumenti di prezzo or Costi fissi tile", async () => {
    dashboardReply = reply(ADMIN);
    const { container } = await open("admin");
    await screen.findByTestId("dashboard-tiles");
    expect(tileKeys(container)).toEqual([
      "plates",
      "foodCost",
      "payables",
      "stockAtRisk",
      "waste",
      "comingSoon",
    ]);
    expect(screen.queryByText("Da fare oggi")).toBeNull();
    expect(screen.queryByText("Aumenti di prezzo")).toBeNull();
    expect(screen.queryByText("Costi fissi")).toBeNull();
    expect(apiJson.mock.calls.map(([p]) => p)).toEqual(["/api/me", "/api/dashboard"]);
  });
});

describe("Oggi for the chef and the waiter", () => {
  it("the chef makes one request to /api/today, none to /api/dashboard, sees no tiles and no euro", async () => {
    const { container } = await open("chef");
    await screen.findByText("Lotti in scadenza · 1");
    expect(apiJson.mock.calls.map(([p]) => p)).toEqual(["/api/me", "/api/today"]);
    expect(screen.queryByTestId("dashboard-tiles")).toBeNull();
    expect(container.querySelector('[data-layout="wide"]')).toBeNull();
    expect(container.textContent).not.toContain("€");
  });

  it("the waiter is sent to the tables and reads neither endpoint", async () => {
    role = "waiter";
    render(createElement(HomePage));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/tavoli"));
    const paths = apiJson.mock.calls.map(([p]) => p);
    expect(paths).not.toContain("/api/dashboard");
    expect(paths).not.toContain("/api/today");
  });
});

describe("Oggi when the dashboard fails", () => {
  const fail = () =>
    Promise.resolve<Reply>({
      ok: false,
      status: 500,
      error: { code: "dashboard_unavailable", message: "x" },
    });

  it("shows one alert, keeps the static actions, and Riprova reads again", async () => {
    dashboardReply = fail;
    await open("owner");
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    expect(screen.getByRole("alert").textContent).toContain("Il cruscotto non è disponibile.");
    expect(screen.getByRole("link", { name: /^Carica una fattura/ }).getAttribute("href")).toBe(
      "/fatture",
    );
    expect(screen.queryByTestId("dashboard-tiles")).toBeNull();
    dashboardReply = reply(OWNER);
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(await screen.findByTestId("dashboard-tiles")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(apiJson.mock.calls.filter(([p]) => p === "/api/dashboard")).toHaveLength(2);
  });

  it("a reply of the wrong shape is the same error", async () => {
    dashboardReply = reply({ nothing: true });
    await open("owner");
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
  });
});
