// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let role = "owner";
type Reply =
  { ok: true; status: 200; data: unknown } | { ok: false; status: number; error: unknown };
let todayReply: () => Promise<Reply>;
// M25b: Home also reads the three newest open alerts (owner and chef) and acknowledges them.
const EMPTY_ALERTS = { alerts: [], nextCursor: null, canRaiseTest: false };
let alertsReply: () => Promise<Reply> = () =>
  Promise.resolve({ ok: true, status: 200, data: EMPTY_ALERTS });
// The owner's and the admin's Oggi read /api/dashboard, whose `today` block is the /api/today summary (UX plan 3.3, owner
// dashboard plan 2.3). These tests keep scripting the summary with `todayReply`; the dashboard reply wraps it.
let passwordMethod: "link" | "password" = "password";
// QW3: owner and admin also read the number of booking requests waiting (one GET, a count only).
let pendingReply: () => Promise<Reply> = () =>
  Promise.resolve({ ok: true, status: 200, data: { pending: 2 } });
// P4 K1: the chef's Home also reads the kitchen board for its card (counts only).
let kitchenReply: () => Promise<Reply> = () =>
  Promise.resolve({ ok: true, status: 200, data: KITCHEN_TICKETS });
const apiJson = vi.fn((path: string, init?: { method?: string }): Promise<Reply> => {
  if (path === "/api/kitchen/tickets") return kitchenReply();
  if (path === "/api/me/password") {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: { signInMethod: passwordMethod, recentSignIn: false, recentUntil: null, minLength: 10 },
    });
  }
  if (path === "/api/reservations/pending-count") return pendingReply();
  if (path.startsWith("/api/alerts?")) return alertsReply();
  if (path.endsWith("/ack") && init?.method === "POST")
    return Promise.resolve({ ok: true, status: 200, data: { alert: {} } });
  if (path === "/api/today") return todayReply();
  if (path === "/api/dashboard") {
    return todayReply().then((reply) =>
      reply.ok && typeof reply.data === "object" && reply.data !== null && "cards" in reply.data
        ? { ...reply, data: { ...(role === "admin" ? ADMIN : OWNER), today: reply.data } }
        : reply,
    );
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    data: {
      user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo", isDemo: false },
    },
  });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: { method?: string }) => apiJson(path, init),
}));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import HomePage from "@/app/(owner)/page";
import { resetMe } from "@/components/use-me";
import { renderDashboard } from "@/server/dashboard/render";
import { dashboardSqlSchema } from "@/server/dashboard/sql-schema";
import { adminSql, ownerSql } from "../fixtures/dashboard-sql";
import { KITCHEN_TICKETS } from "../helpers/kitchen-data";

const OWNER = renderDashboard(dashboardSqlSchema.parse(ownerSql()), "it");
const ADMIN = renderDashboard(dashboardSqlSchema.parse(adminSql()), "it");

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
  passwordMethod = "password";
  todayReply = reply(OWNER_TODAY);
  alertsReply = reply(EMPTY_ALERTS);
  pendingReply = reply({ pending: 2 });
  kitchenReply = reply(KITCHEN_TICKETS);
  reportError.mockClear();
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
  it("fetches /api/dashboard once, after /api/me, and never /api/today", async () => {
    await open("owner");
    await screen.findByText("Fatture da rivedere · 2");
    expect(apiJson.mock.calls.filter(([p]) => p === "/api/dashboard")).toHaveLength(1);
    // M25b: the owner's Home also reads the three newest open alerts.
    expect(
      apiJson.mock.calls
        .map(([p]) => p)
        .filter((p) => p !== "/api/dashboard/opens" && p !== "/api/me/password"),
    ).toEqual([
      "/api/me",
      "/api/dashboard",
      "/api/reservations/pending-count",
      "/api/alerts?filter=open&limit=3",
    ]);
    expect(apiJson.mock.calls.map(([p]) => p)).not.toContain("/api/today");
  });

  it("puts a word badge with the count on the actions that have one", async () => {
    await open("owner");
    expect(
      within(link("Carica una fattura").parentElement!).getByText("Fatture da rivedere · 2"),
    ).toBeTruthy();
    // M25b: the alerts badge moved from the former "Avvisi" action to the strip's heading.
    expect(
      within(screen.getByRole("heading", { level: 2, name: "Avvisi" }).parentElement!).getByText(
        "Avvisi da vedere · 3",
      ),
    ).toBeTruthy();
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

  it("shows no euro sign in the to-do block, for any count (the dashboard tiles below it do show money)", async () => {
    const { container } = await open("owner");
    await screen.findByText("Fatture da rivedere · 2");
    await screen.findByTestId("dashboard-tiles");
    container.querySelector("[data-dashboard]")?.remove();
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
    await screen.findByTestId("dashboard-tiles");
    container.querySelector("[data-dashboard]")?.remove();
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
    // M25b: "Cosa preparare" (a second link to /avvisi) is gone; the strip carries the badge.
    expect(
      within(screen.getByRole("heading", { level: 2, name: "Avvisi" }).parentElement!).getByText(
        "Avvisi da vedere · 2",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Cosa preparare/ })).toBeNull();
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

describe("Oggi: when the read fails", () => {
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
    expect(screen.getByRole("alert").textContent).toContain("Il cruscotto non è disponibile.");
    expect(link("Carica una fattura").getAttribute("href")).toBe("/fatture");
    expect(screen.getByRole("link", { name: "Tutti gli avvisi" }).getAttribute("href")).toBe(
      "/avvisi",
    );
    // M25b: the strip's own "Nessun avviso da vedere." is not a badge, so the pattern names the badge words only.
    expect(screen.queryByText(/da rivedere|Avvisi da vedere|Niente da fare/)).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Primi passi" }).parentElement!.querySelectorAll("a"),
    ).toHaveLength(6);
  });

  it("the chef's failure keeps the old notice about today's numbers, and Riprova reads /api/today again", async () => {
    todayReply = () =>
      Promise.resolve({
        ok: false,
        status: 500,
        error: { code: "today_unavailable", message: "x" },
      });
    await open("chef");
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("numeri di oggi");
    todayReply = reply({
      cards: [card("alerts", 2), card("batchesUseBy", 1), card("countOpen", 0)],
      setup: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(await screen.findByText("Lotti in scadenza · 1")).toBeTruthy();
    expect(apiJson.mock.calls.filter(([p]) => p === "/api/today")).toHaveLength(2);
  });

  it("Riprova asks /api/dashboard again and then shows the badges", async () => {
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

// M25b step 13 (plan §3.1.7): Home opens with the open alerts, then the tiles, then the to-dos, "Primi passi", the account card, "Esci".
describe("Home order (M25b)", () => {
  const alertItem = (n: number) => ({
    id: `a1000000-0000-4000-8000-00000000000${n}`,
    kind: "test_alert",
    severity: "info",
    entityType: "tenant",
    entityId: null,
    businessDate: "2026-10-25",
    createdAt: "2026-10-25T00:30:00.000Z",
    title: `Avviso ${n}`,
    body: `Corpo ${n}`,
    href: null,
    acknowledged: null,
  });
  const alertList = (n: number, nextCursor: string | null = null) => ({
    alerts: Array.from({ length: n }, (_, i) => alertItem(i + 1)),
    nextCursor,
    canRaiseTest: true,
  });
  const before = (a: Element, b: Element) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  // QW4 (ADR-041): the actions come before the dashboard for owner and admin; the alert strip stays first.
  it("owner: h1, Avvisi, Carica una fattura, the last action, the dashboard, Primi passi, the account card", async () => {
    alertsReply = reply(alertList(3));
    const { container } = await open("owner");
    await screen.findByTestId("dashboard-tiles");
    await screen.findByText("Avviso 1");
    const main = container;
    const h1 = main.querySelector("h1")!;
    const strip = screen.getByRole("heading", { level: 2, name: "Avvisi" }).closest("section")!;
    const dashboard = main.querySelector("[data-dashboard]")!;
    const firstAction = screen.getByRole("link", { name: /^Carica una fattura/ });
    const lastAction = screen.getByRole("link", { name: /^Menu e prezzi/ });
    const steps = screen.getByRole("heading", { name: "Primi passi" });
    const card = screen.getByTestId("role");
    const chain = [h1, strip, firstAction, lastAction, dashboard, steps, card];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(before(chain[i]!, chain[i + 1]!), `step ${i}`).toBe(true);
    }
    // "Esci" is no longer part of the page: it is in the header band (QW6).
    expect(screen.queryByRole("button", { name: "Esci" })).toBeNull();
  });

  it("admin: h1, Personale e dispositivi, the last action, the dashboard, Primi passi, the account card", async () => {
    const { container } = await open("admin");
    await screen.findByTestId("dashboard-tiles");
    const dashboard = container.querySelector("[data-dashboard]")!;
    const firstAction = screen.getByRole("link", { name: /^Personale e dispositivi/ });
    const lastAction = screen.getByRole("link", { name: /^Fatture/ });
    const steps = screen.getByRole("heading", { name: "Primi passi" });
    const chain = [
      container.querySelector("h1")!,
      firstAction,
      lastAction,
      dashboard,
      steps,
      screen.getByTestId("role"),
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(before(chain[i]!, chain[i + 1]!), `step ${i}`).toBe(true);
    }
  });

  it("the chef's Home is unchanged: strip, then the actions, with no dashboard", async () => {
    alertsReply = reply(alertList(1));
    const { container } = await open("chef");
    await screen.findByText("Avviso 1");
    expect(container.querySelector("[data-dashboard]")).toBeNull();
    const strip = screen.getByRole("heading", { level: 2, name: "Avvisi" }).closest("section")!;
    expect(before(strip, screen.getByRole("link", { name: /^Nuova produzione/ }))).toBe(true);
  });

  it("owner: one /api/dashboard and one /api/alerts?filter=open&limit=3, none to /api/today", async () => {
    await open("owner");
    await screen.findByText("Fatture da rivedere · 2");
    const paths = apiJson.mock.calls.map(([p]) => p);
    expect(paths.filter((p) => p === "/api/dashboard")).toHaveLength(1);
    expect(paths.filter((p) => p === "/api/alerts?filter=open&limit=3")).toHaveLength(1);
    expect(paths).not.toContain("/api/today");
  });

  it("admin: one /api/dashboard, zero /api/alerts, no Avvisi section", async () => {
    await open("admin");
    await screen.findByTestId("dashboard-tiles");
    const paths = apiJson.mock.calls.map(([p]) => p);
    expect(paths.filter((p) => p === "/api/dashboard")).toHaveLength(1);
    expect(paths.some((p) => p.startsWith("/api/alerts"))).toBe(false);
    expect(screen.queryByRole("heading", { level: 2, name: "Avvisi" })).toBeNull();
  });

  it("chef: one /api/today and one alerts read, no tiles, no euro sign", async () => {
    todayReply = reply({ cards: [card("alerts", 2)], setup: null });
    alertsReply = reply(alertList(2));
    const { container } = await open("chef");
    await screen.findByText("Avviso 2");
    const paths = apiJson.mock.calls.map(([p]) => p);
    expect(paths.filter((p) => p === "/api/today")).toHaveLength(1);
    expect(paths.filter((p) => p === "/api/alerts?filter=open&limit=3")).toHaveLength(1);
    expect(paths).not.toContain("/api/dashboard");
    expect(screen.queryByTestId("dashboard-tiles")).toBeNull();
    expect(container.textContent).not.toContain("€");
  });

  it("waiter: no request beyond /api/me", async () => {
    role = "waiter";
    render(createElement(HomePage));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/tavoli"));
    expect(apiJson.mock.calls.map(([p]) => p)).toEqual(["/api/me"]);
  });

  it("strip: three alerts give three rows and the link to all of them", async () => {
    alertsReply = reply(alertList(3));
    await open("owner");
    await screen.findByText("Avviso 3");
    const strip = screen.getByRole("heading", { level: 2, name: "Avvisi" }).closest("section")!;
    expect(strip.querySelectorAll("li")).toHaveLength(3);
    expect(within(strip).getByRole("link", { name: "Tutti gli avvisi" }).getAttribute("href")).toBe(
      "/avvisi",
    );
  });

  it("strip: no open alert says Nessun avviso da vedere", async () => {
    await open("owner");
    expect(await screen.findByText("Nessun avviso da vedere.")).toBeTruthy();
  });

  it("strip: Ho visto posts the acknowledgement, then reads the alerts and the counts again", async () => {
    alertsReply = reply(alertList(3));
    await open("owner");
    await screen.findByText("Avviso 1");
    const dashboardBefore = apiJson.mock.calls.filter(([p]) => p === "/api/dashboard").length;
    fireEvent.click(screen.getAllByRole("button", { name: "Ho visto" })[0]!);
    await waitFor(() =>
      expect(
        apiJson.mock.calls.filter(([p]) => p === "/api/alerts?filter=open&limit=3"),
      ).toHaveLength(2),
    );
    const acks = apiJson.mock.calls.filter(([p]) => p.endsWith("/ack"));
    expect(acks).toHaveLength(1);
    expect(acks[0]![0]).toBe("/api/alerts/a1000000-0000-4000-8000-000000000001/ack");
    await waitFor(() =>
      expect(apiJson.mock.calls.filter(([p]) => p === "/api/dashboard")).toHaveLength(
        dashboardBefore + 1,
      ),
    );
  });

  it("strip: an alerts failure is one alert in the strip while the tiles still render", async () => {
    alertsReply = () =>
      Promise.resolve({ ok: false, status: 500, error: { code: "x", message: "x" } });
    await open("owner");
    await screen.findByTestId("dashboard-tiles");
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    const strip = screen.getByRole("heading", { level: 2, name: "Avvisi" }).closest("section")!;
    expect(within(strip).getByRole("alert").textContent).toBe("Gli avvisi non sono disponibili.");
  });

  it("strip: a reply of the wrong shape is the same error", async () => {
    alertsReply = reply({ nothing: true });
    await open("owner");
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
  });
});

describe("the password link in the account card (M25a)", () => {
  it("offers an owner who came in by link to set a password", async () => {
    passwordMethod = "link";
    render(createElement(HomePage));
    const link = await screen.findByRole("link", { name: "Imposta una password" });
    expect(link.getAttribute("href")).toBe("/password");
    expect(screen.queryByRole("link", { name: "Cambia password" })).toBeNull();
  });

  it("offers an admin who signed in with a password to change it", async () => {
    role = "admin";
    todayReply = reply(OWNER_TODAY);
    render(createElement(HomePage));
    const link = await screen.findByRole("link", { name: "Cambia password" });
    expect(link.getAttribute("href")).toBe("/password");
  });

  it("asks the status exactly once for the owner", async () => {
    render(createElement(HomePage));
    await screen.findByRole("link", { name: "Cambia password" });
    expect(apiJson.mock.calls.filter(([path]) => path === "/api/me/password")).toHaveLength(1);
  });

  it("does not ask for a chef and shows no link", async () => {
    role = "chef";
    todayReply = reply({ cards: [], setup: null });
    render(createElement(HomePage));
    await screen.findByText("Osteria Demo");
    // The mock's wrapper passes `init` through, so the spy records a trailing undefined: a plain GET with no options.
    await waitFor(() => expect(apiJson).toHaveBeenCalledWith("/api/today", undefined));
    expect(apiJson.mock.calls.map(([path]) => path)).not.toContain("/api/me/password");
    expect(screen.queryByRole("link", { name: "Cambia password" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Imposta una password" })).toBeNull();
  });
});

// QW3 (docs/plans/2026-11-13-ux-quick-wins.md): "Prenotazioni da confermare · n" on the Home of the owner and the admin.
describe("Home: booking requests (QW3)", () => {
  const paths = () => apiJson.mock.calls.map(([p]) => p);

  it.each(["owner", "admin"])(
    "the %s reads the count once and sees it on the Prenotazioni row",
    async (who) => {
      await open(who);
      const row = link("Prenotazioni");
      expect(row.getAttribute("href")).toBe("/prenotazioni");
      expect(await within(row).findByText("Prenotazioni da confermare · 2")).toBeTruthy();
      expect(paths().filter((p) => p === "/api/reservations/pending-count")).toHaveLength(1);
    },
  );

  it("says Niente da fare when no request waits", async () => {
    pendingReply = reply({ pending: 0 });
    await open("owner");
    const row = link("Prenotazioni");
    await waitFor(() => expect(within(row).getByText("Niente da fare")).toBeTruthy());
  });

  it("the chef never reads the count and has no Prenotazioni row", async () => {
    await open("chef");
    await screen.findByText("Lotti in scadenza · 1");
    expect(paths()).not.toContain("/api/reservations/pending-count");
    expect(screen.queryByRole("link", { name: /^Prenotazioni/ })).toBeNull();
  });

  it("with an error the row stays, without a badge, and the rest of Home is there", async () => {
    pendingReply = () =>
      Promise.resolve({ ok: false, status: 500, error: { code: "internal", message: "x" } });
    await open("owner");
    await screen.findByText("Fatture da rivedere · 2");
    const row = link("Prenotazioni");
    expect(row.textContent).not.toMatch(/da confermare ·|Niente da fare/);
  });

  it("shows a count only: no customer name, phone or e-mail on the row", async () => {
    await open("owner");
    const row = link("Prenotazioni");
    await within(row).findByText("Prenotazioni da confermare · 2");
    expect(row.textContent).not.toMatch(/@|\+39|Cliente/);
  });
});

describe("the chef's kitchen card (P4 K1)", () => {
  const kitchenReads = () => apiJson.mock.calls.filter(([p]) => p === "/api/kitchen/tickets");

  it("shows the open comande and what is left to do", async () => {
    const { container } = await open("chef");
    expect(await screen.findByText("Comande aperte · 2")).toBeTruthy();
    expect(screen.getByText("Da fare: 2")).toBeTruthy();
    expect(container.querySelector("[data-kitchen-card]")?.getAttribute("href")).toBe("/cucina");
    expect(container.textContent).not.toContain("€");
  });

  it("sits after the alert strip and before 'Nuova produzione'", async () => {
    const { container } = await open("chef");
    await screen.findByText("Comande aperte · 2");
    const strip = screen.getByRole("heading", { level: 2, name: "Avvisi" }).closest("section")!;
    const card = container.querySelector("[data-kitchen-card]")!;
    const primary = screen.getByRole("link", { name: /^Nuova produzione/ });
    expect(strip.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads the kitchen board exactly once", async () => {
    await open("chef");
    await screen.findByText("Comande aperte · 2");
    expect(kitchenReads()).toHaveLength(1);
  });

  it("reads once more when the page comes back to the front, and not while hidden", async () => {
    await open("chef");
    await screen.findByText("Comande aperte · 2");
    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(kitchenReads()).toHaveLength(1);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(kitchenReads()).toHaveLength(2);
    await waitFor(() => expect(screen.getByText("Comande aperte · 2")).toBeTruthy());
  });

  it.each(["owner", "admin"])("%s: no card and no kitchen read", async (who) => {
    const { container } = await open(who);
    await screen.findByTestId("dashboard-tiles");
    expect(container.querySelector("[data-kitchen-card]")).toBeNull();
    expect(kitchenReads()).toHaveLength(0);
  });

  it("a failing kitchen read says so in the card, adds no alert and is reported once with a code", async () => {
    await open("chef");
    await screen.findByText("Comande aperte · 2");
    const alertsBefore = screen.queryAllByRole("alert").length;
    cleanup();
    reportError.mockClear();
    resetMe();
    kitchenReply = () =>
      Promise.resolve({ ok: false, status: 500, error: { code: "x", message: "secret body" } });
    await open("chef");
    expect(await screen.findByText("Il numero delle comande non è disponibile.")).toBeTruthy();
    expect(screen.queryAllByRole("alert")).toHaveLength(alertsBefore);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect((reportError.mock.calls[0]![0] as Error).message).toBe("home.kitchen_board");
  });
});
