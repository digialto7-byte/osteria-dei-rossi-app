// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let role = "owner";
type Reply =
  { ok: true; status: 200; data: unknown } | { ok: false; status: number; error: unknown };
let todayReply: () => Promise<Reply>;
const apiJson = vi.fn((path: string): Promise<Reply> => {
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

const card = (key: string, count: number, more = false) => ({ key, count, more, href: "/x" });
const step = (key: string, done: boolean) => ({ key, done, href: `/${key}` });
const SETUP_KEYS = [
  "locations",
  "suppliers",
  "ingredients",
  "invoice",
  "staff",
  "device",
  "tables",
  "menu",
];
const setup = (...doneKeys: string[]) => SETUP_KEYS.map((key) => step(key, doneKeys.includes(key)));
const reply =
  (data: unknown): (() => Promise<Reply>) =>
  () =>
    Promise.resolve({ ok: true, status: 200, data });

const OWNER_TODAY = {
  cards: [
    card("alerts", 3),
    card("invoicesToReview", 2),
    card("payablesOverdue", 1),
    card("payablesUnpaid", 4),
    card("batchesUseBy", 1),
    card("countOpen", 1),
  ],
  setup: setup("invoice"),
};

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
  replace.mockClear();
  role = "owner";
  todayReply = reply(OWNER_TODAY);
});
afterEach(cleanup);

const open = async (who: string) => {
  role = who;
  const view = render(createElement(HomePage));
  await screen.findByRole("heading", { name: /Utente Demo/ });
  return view;
};
const link = (name: string) => screen.getByRole("link", { name: new RegExp(`^${name}`) });

describe("Oggi with counts (owner)", () => {
  it("fetches /api/today once, after /api/me", async () => {
    await open("owner");
    await screen.findByText("Fatture da rivedere · 2");
    expect(apiJson.mock.calls.filter(([p]) => p === "/api/today")).toHaveLength(1);
    expect(apiJson.mock.calls.map(([p]) => p)).toEqual(["/api/me", "/api/today"]);
  });

  it("puts a word badge with the count on the actions that have one", async () => {
    await open("owner");
    expect(
      within(link("Carica una fattura").parentElement!).getByText("Fatture da rivedere · 2"),
    ).toBeTruthy();
    expect(within(link("Avvisi")).getByText("Avvisi da vedere · 3")).toBeTruthy();
    expect(within(link("Pagamenti")).getByText("Pagamenti scaduti · 1")).toBeTruthy();
  });

  it("shows Niente da fare for a count of 0", async () => {
    todayReply = reply({
      ...OWNER_TODAY,
      cards: OWNER_TODAY.cards.map((c) => ({ ...c, count: 0 })),
    });
    await open("owner");
    await waitFor(() =>
      expect(screen.getAllByText("Niente da fare").length).toBeGreaterThanOrEqual(3),
    );
    expect(screen.queryByText(/Fatture da rivedere/)).toBeNull();
  });

  it("shows no euro sign anywhere, for any count", async () => {
    const { container } = await open("owner");
    await screen.findByText("Fatture da rivedere · 2");
    expect(container.textContent).not.toContain("€");
  });

  it("shows 'o più' when the alert count stopped at the cap", async () => {
    todayReply = reply({ ...OWNER_TODAY, cards: [card("alerts", 50, true)] });
    await open("owner");
    expect(await screen.findByText("Avvisi da vedere · 50 o più")).toBeTruthy();
  });

  it("the badges add no links: the page has the same links before and after the counts arrive", async () => {
    let release: (reply: Reply) => void = () => {};
    todayReply = () => new Promise((resolve) => (release = resolve));
    const { container } = await open("owner");
    const before = container.querySelectorAll("a").length;
    release({ ok: true, status: 200, data: OWNER_TODAY });
    await screen.findByText("Fatture da rivedere · 2");
    expect(container.querySelectorAll("a")).toHaveLength(before);
  });
});

describe("Oggi: Primi passi from the server", () => {
  it("shows Da fare and Fatto on the six steps", async () => {
    await open("owner");
    const heading = await screen.findByRole("heading", { name: "Primi passi" });
    await screen.findAllByText("Da fare");
    const list = heading.parentElement!.querySelector("ul")!;
    expect(within(list).getByRole("link", { name: /^Ubicazioni/ }).textContent).toContain(
      "Da fare",
    );
    expect(
      within(list).getByRole("link", { name: /^Carica la prima fattura/ }).textContent,
    ).toContain("Fatto");
    expect(list.querySelectorAll("a")).toHaveLength(6);
  });

  it("a fresh owner sees Ubicazioni · Da fare, and Fatto once a location exists", async () => {
    todayReply = reply({ ...OWNER_TODAY, setup: setup() });
    const first = await open("owner");
    const row = await screen.findByRole("link", { name: /^Ubicazioni/ });
    await waitFor(() => expect(row.textContent).toContain("Da fare"));
    first.unmount();

    resetMe();
    todayReply = reply({ ...OWNER_TODAY, setup: setup("locations") });
    await open("owner");
    const again = await screen.findByRole("link", { name: /^Ubicazioni/ });
    await waitFor(() => expect(again.textContent).toContain("Fatto"));
  });

  it("hides the whole list once every step is done", async () => {
    todayReply = reply({ ...OWNER_TODAY, setup: setup(...SETUP_KEYS) });
    await open("owner");
    await screen.findByText("Fatture da rivedere · 2");
    expect(screen.queryByRole("heading", { name: "Primi passi" })).toBeNull();
  });

  it("while the counts load, the list is there without any state", async () => {
    todayReply = () => new Promise(() => {});
    await open("owner");
    const heading = screen.getByRole("heading", { name: "Primi passi" });
    expect(heading.parentElement!.querySelectorAll("a")).toHaveLength(6);
    expect(screen.queryByText("Da fare")).toBeNull();
    expect(screen.queryByText("Fatto")).toBeNull();
  });
});

describe("Oggi: roles", () => {
  it("the admin gets no alerts badge and sees the invoices count on Fatture", async () => {
    todayReply = reply({
      ...OWNER_TODAY,
      cards: OWNER_TODAY.cards.filter((c) => c.key !== "alerts"),
    });
    await open("admin");
    expect(await screen.findByText("Fatture da rivedere · 2")).toBeTruthy();
    expect(screen.queryByText(/Avvisi da vedere/)).toBeNull();
  });

  it("the chef sees lots, alerts and the count in progress, no first steps, no euro sign", async () => {
    todayReply = reply({
      cards: [card("alerts", 2), card("batchesUseBy", 1), card("countOpen", 1)],
      setup: null,
    });
    const { container } = await open("chef");
    expect(await screen.findByText("Lotti in scadenza · 1")).toBeTruthy();
    expect(within(link("Cosa preparare")).getByText("Avvisi da vedere · 2")).toBeTruthy();
    expect(within(link("Conteggio giornaliero")).getByText("Conteggio in corso")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Primi passi" })).toBeNull();
    expect(container.textContent).not.toContain("€");
  });

  it("the waiter is sent to the tables and /api/today is never read", async () => {
    role = "waiter";
    render(createElement(HomePage));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/tavoli"));
    expect(apiJson.mock.calls.map(([p]) => p)).not.toContain("/api/today");
  });
});

describe("Oggi: when /api/today fails", () => {
  const failures: [string, () => Promise<Reply>][] = [
    [
      "a 500",
      () =>
        Promise.resolve({
          ok: false,
          status: 500,
          error: { code: "today_unavailable", message: "x" },
        }),
    ],
    [
      "a network failure",
      () => Promise.resolve({ ok: false, status: 0, error: { code: "network", message: "x" } }),
    ],
    ["a reply of the wrong shape", reply({ nothing: true })],
  ];

  it.each(failures)("%s: the actions stay, one alert, no badge", async (_name, fail) => {
    todayReply = fail;
    await open("owner");
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    expect(screen.getByRole("alert").textContent).toContain("numeri di oggi");
    expect(link("Carica una fattura").getAttribute("href")).toBe("/fatture");
    expect(link("Avvisi").getAttribute("href")).toBe("/avvisi");
    expect(screen.queryByText(/da rivedere|da vedere|Niente da fare/)).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Primi passi" }).parentElement!.querySelectorAll("a"),
    ).toHaveLength(6);
  });

  it("Riprova asks /api/today again and then shows the badges", async () => {
    todayReply = () =>
      Promise.resolve({ ok: false, status: 500, error: { code: "x", message: "x" } });
    await open("owner");
    await screen.findByRole("alert");
    todayReply = reply(OWNER_TODAY);
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(await screen.findByText("Fatture da rivedere · 2")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
