// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGE_MENU, WEIGHTED_ITEM } from "../helpers/menu-tables-data";
import { PUSH_LIST_CHEF, PUSH_LIST_OWNER } from "../helpers/push-data";
import { SELL_THROUGH_EMPTY as SELL_EMPTY } from "../helpers/push-data";

type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const fail = (status: number, code: string, message: string): Result => ({
  ok: false,
  status,
  error: { code, message },
});

const STEW_ITEM = "11000000-0000-4000-8000-000000000001";
const B1 = "ba000000-0000-4000-8000-000000000001";
const B2 = "ba000000-0000-4000-8000-000000000002";
const L1 = "1e000000-0000-4000-8000-000000000001";

let list: () => Result;
let menuReply: Result;
let pushReply: Result;
const calls: Array<{ path: string; method: string; body: unknown }> = [];
// P2-2: "Com'è andata" reads its own endpoint when the page opens. Its calls are kept apart so the counts of the page's own reads stay as they were.
const sellCalls: string[] = [];
const defaultApi = (path: string, init?: { method?: string; body?: unknown }): Promise<Result> => {
  if (path.startsWith("/api/reports/push-sell-through")) {
    sellCalls.push(path);
    return Promise.resolve(ok(SELL_EMPTY));
  }
  calls.push({ path, method: init?.method ?? "GET", body: init?.body });
  if (path === "/api/reports/push-list") return Promise.resolve(list());
  if (path === "/api/menu/items") return Promise.resolve(menuReply);
  if (path.endsWith("/push")) return Promise.resolve(pushReply);
  return Promise.resolve(fail(404, "not_found", "x"));
};
const apiJson = vi.fn(defaultApi);
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));

// M24 step 11: the CSV links read the role from useMe; a mock keeps /api/me out of the calls these tests count.
let meRole: string | null = "owner";
vi.mock("@/components/use-me", () => ({
  useMe: () => ({
    status: meRole === null ? "loading" : "ok",
    me:
      meRole === null
        ? null
        : {
            user: { id: "u", displayName: "Titolare Demo", role: meRole },
            tenant: { id: "t", name: "Osteria Demo A" },
          },
    retry: () => undefined,
  }),
}));

import PushPage from "@/app/(owner)/spingere/page";

const MENU_WITH_STEW = {
  ...MANAGE_MENU,
  items: [{ ...MANAGE_MENU.items[0]!, id: STEW_ITEM, name: "Spezzatino con polenta", price: 14 }],
};
const PUSHED_RESULT = { changed: true, item: { ...MENU_ITEM_STUB() } };
function MENU_ITEM_STUB() {
  return MENU_WITH_STEW.items[0]!;
}

beforeEach(() => {
  meRole = "owner";
  list = () => ok(PUSH_LIST_OWNER);
  menuReply = ok(MENU_WITH_STEW);
  pushReply = ok(PUSHED_RESULT);
  calls.length = 0;
  sellCalls.length = 0;
  apiJson.mockClear();
  apiJson.mockImplementation(defaultApi);
});
afterEach(cleanup);

const open = async () => {
  const view = render(createElement(PushPage));
  await screen.findByRole("heading", { name: "Da spingere" });
  await waitFor(() => expect(view.container.querySelector("[data-push-row-id]")).not.toBeNull());
  return view;
};
const rowOf = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-push-row-id="${id}"]`) as HTMLElement;
const plain = (text: string | null) => (text ?? "").replace(/ /g, " ").replace(/\s+/g, " ");

describe("the push page: owner", () => {
  it("makes one request on open and lists the rows by id, in the API's order", async () => {
    const { container } = await open();
    expect(calls).toEqual([{ path: "/api/reports/push-list", method: "GET", body: undefined }]);
    const ids = [...container.querySelectorAll("[data-push-row-id]")].map((el) =>
      el.getAttribute("data-push-row-id"),
    );
    expect(ids).toEqual(PUSH_LIST_OWNER.rows.map((r) => r.id));
    expect(plain(rowOf(container, B1).textContent)).toContain(
      "Spezzatino, prodotto lun, da consumare entro mer 20:00, 14 porzioni, 38,00 € a rischio → spingi Spezzatino con polenta",
    );
  });

  it("shows the hours left as a badge", async () => {
    const { container } = await open();
    expect(plain(rowOf(container, B2).textContent)).toContain("tra 4 h");
  });

  it("'Spingi oggi' opens the sheet with the plate and the menu price; 'Conferma' posts the price once and reloads the list", async () => {
    const { container } = await open();
    fireEvent.click(within(rowOf(container, B1)).getByRole("button", { name: /^Spingi oggi/ }));
    const sheet = await screen.findByRole("group", { name: "Spezzatino con polenta" });
    await waitFor(() => expect(plain(sheet.textContent)).toMatch(/Prezzo del menu: 14,00 €/));
    fireEvent.change(within(sheet).getByLabelText(/Prezzo del giorno/), {
      target: { value: "12,50" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")).toEqual({
      path: `/api/menu/${STEW_ITEM}/push`,
      method: "POST",
      body: { pushed: true, pushPrice: 12.5 },
    });
    await waitFor(() =>
      expect(calls.filter((c) => c.path === "/api/reports/push-list")).toHaveLength(2),
    );
    expect(screen.queryByRole("group", { name: "Spezzatino con polenta" })).toBeNull();
  });

  it("a plate shared by two rows opens exactly one sheet, in the row it was opened from", async () => {
    const RAGU_ITEM = "11000000-0000-4000-8000-000000000002";
    const shared = PUSH_LIST_OWNER.rows.map((row) =>
      row.id === L1 ? { ...row, plates: PUSH_LIST_OWNER.rows[0]!.plates } : row,
    );
    list = () => ok({ ...PUSH_LIST_OWNER, rows: shared });
    const { container } = await open();
    fireEvent.click(within(rowOf(container, L1)).getByRole("button", { name: /^Spingi oggi/ }));
    await screen.findByRole("group", { name: "Tagliatelle al ragù (demo)" });
    expect(screen.getAllByRole("group", { name: "Tagliatelle al ragù (demo)" })).toHaveLength(1);
    expect(within(rowOf(container, L1)).getAllByRole("button", { name: "Conferma" })).toHaveLength(
      1,
    );
    expect(within(rowOf(container, B2)).queryByRole("button", { name: "Conferma" })).toBeNull();
    expect(RAGU_ITEM).toBe(shared[0]!.plates[0]!.menuItemId);
  });

  it("a failed 'Togli' shows its error on its own row, not in another plate's open sheet", async () => {
    const pushedB1 = PUSH_LIST_OWNER.rows.map((row) =>
      row.id === B1
        ? {
            ...row,
            plates: row.plates.map((p) => ({
              ...p,
              pushed: true,
              pushUntil: "2026-11-05T01:00:00Z",
              pushPrice: 12,
            })),
          }
        : row,
    );
    list = () => ok({ ...PUSH_LIST_OWNER, rows: pushedB1 });
    const { container } = await open();
    fireEvent.click(within(rowOf(container, B2)).getByRole("button", { name: /^Spingi oggi/ }));
    const sheet = await screen.findByRole("group", { name: "Tagliatelle al ragù (demo)" });
    pushReply = fail(500, "internal", "Togli non riuscito");
    fireEvent.click(within(rowOf(container, B1)).getByRole("button", { name: /^Togli/ }));
    const message = await within(rowOf(container, B1)).findByText("Togli non riuscito");
    expect(message.getAttribute("role")).toBe("alert");
    expect(within(sheet).queryByText("Togli non riuscito")).toBeNull();
  });

  it("an empty price posts pushPrice null", async () => {
    const { container } = await open();
    fireEvent.click(within(rowOf(container, B1)).getByRole("button", { name: /^Spingi oggi/ }));
    const sheet = await screen.findByRole("group", { name: "Spezzatino con polenta" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ pushed: true, pushPrice: null });
  });

  it("a price the owner cannot type is refused on the screen, without a request", async () => {
    const { container } = await open();
    fireEvent.click(within(rowOf(container, B1)).getByRole("button", { name: /^Spingi oggi/ }));
    const sheet = await screen.findByRole("group", { name: "Spezzatino con polenta" });
    fireEvent.change(within(sheet).getByLabelText(/Prezzo del giorno/), {
      target: { value: "abc" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Conferma" }));
    await within(sheet).findByText(/non è valido/);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("a 422 shows the Italian message with the menu price, in an aria-live region", async () => {
    pushReply = fail(422, "push_price_above_menu", "x");
    const { container } = await open();
    fireEvent.click(within(rowOf(container, B1)).getByRole("button", { name: /^Spingi oggi/ }));
    const sheet = await screen.findByRole("group", { name: "Spezzatino con polenta" });
    await waitFor(() => expect(plain(sheet.textContent)).toMatch(/14,00 €/));
    fireEvent.change(within(sheet).getByLabelText(/Prezzo del giorno/), {
      target: { value: "20" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Conferma" }));
    const message = await within(sheet).findByText(/non può superare il prezzo del menu/);
    expect(plain(message.textContent)).toBe(
      "Il prezzo del giorno non può superare il prezzo del menu (14,00 €).",
    );
    expect(message.closest("[aria-live]")).not.toBeNull();
  });

  it("menu_price_missing shows the server's message, not the above-menu template (M24 follow-up)", async () => {
    const text =
      "Questo piatto non ha un prezzo di menu in vigore: impostalo nel Menu prima di dargli un prezzo del giorno.";
    pushReply = fail(422, "menu_price_missing", text);
    const { container } = await open();
    fireEvent.click(within(rowOf(container, B1)).getByRole("button", { name: /^Spingi oggi/ }));
    const sheet = await screen.findByRole("group", { name: "Spezzatino con polenta" });
    await waitFor(() => expect(plain(sheet.textContent)).toMatch(/14,00 €/));
    fireEvent.change(within(sheet).getByLabelText(/Prezzo del giorno/), {
      target: { value: "12,00" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Conferma" }));
    const message = await within(sheet).findByText(/non ha un prezzo di menu in vigore/);
    expect(plain(message.textContent)).toBe(text);
    expect(message.closest("[aria-live]")).not.toBeNull();
    const live = message.closest("[aria-live]")!;
    expect(plain(live.textContent)).not.toMatch(/14,00/);
    expect(plain(live.textContent)).not.toMatch(/non può superare/);
  });

  it("a pushed plate says until when and at what price, and 'Togli' posts a stop", async () => {
    const pushedRows = PUSH_LIST_OWNER.rows.map((row) =>
      row.id === B1
        ? {
            ...row,
            plates: row.plates.map((p) => ({
              ...p,
              pushed: true,
              pushUntil: "2026-11-05T01:00:00Z",
              pushPrice: 12,
            })),
          }
        : row,
    );
    list = () => ok({ ...PUSH_LIST_OWNER, rows: pushedRows });
    const { container } = await open();
    const row = rowOf(container, B1);
    // The price follows the menu read (D-11: the unit must be known first), so wait for it.
    await waitFor(() =>
      expect(plain(row.textContent)).toContain("In evidenza fino alle 02:00 · 12,00 €"),
    );
    fireEvent.click(within(row).getByRole("button", { name: /^Togli/ }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")).toEqual({
      path: `/api/menu/${STEW_ITEM}/push`,
      method: "POST",
      body: { pushed: false },
    });
  });

  it("every button is a tap target of 44 px (the min-h-tap class)", async () => {
    const { container } = await open();
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button.className).toContain("min-h-tap");
  });

  it("the footer counts the expired stock with links to Produzione and Magazzino", async () => {
    list = () => ok({ ...PUSH_LIST_OWNER, expired: { batches: 2, lots: 1 } });
    await open();
    expect(screen.getByText("2 preparazioni e 1 lotto scaduti: da scartare")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Apri Produzione" }).getAttribute("href")).toBe(
      "/produzione",
    );
    expect(screen.getByRole("link", { name: "Apri Magazzino" }).getAttribute("href")).toBe(
      "/magazzino",
    );
  });

  it("the footer is absent without expired stock and an incomplete recipe is noted", async () => {
    list = () => ok({ ...PUSH_LIST_OWNER, expired: { batches: 0, lots: 0 }, unresolvedRecipes: 2 });
    await open();
    expect(screen.queryByText(/scaduti: da scartare/)).toBeNull();
    expect(
      screen.getByText("Alcune ricette non sono complete: i piatti collegati potrebbero mancare."),
    ).toBeTruthy();
  });

  it("an empty list says nothing expires by tomorrow", async () => {
    list = () =>
      ok({
        ...PUSH_LIST_OWNER,
        rows: [],
        totals: { count: 0, costAtRiskEur: 0, unvaluedCount: 0 },
        expired: { batches: 0, lots: 0 },
      });
    render(createElement(PushPage));
    expect(await screen.findByText("Niente in scadenza entro domani.")).toBeTruthy();
  });

  it("a lot row without a plate shows the batch recipes and no push button", async () => {
    const { container } = await open();
    const row = rowOf(container, L1);
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("the push page: chef", () => {
  beforeEach(() => {
    list = () => ok(PUSH_LIST_CHEF);
  });

  it("shows the rows with no euro, no button and the hint", async () => {
    const { container } = await open();
    // No action button in any row (the panel under the list has its own day button).
    expect(container.querySelectorAll("[data-push-row-id] button")).toHaveLength(0);
    expect(container.textContent).not.toContain("€");
    expect(plain(rowOf(container, B1).textContent)).toContain(
      "Chiedi al titolare di metterlo in evidenza",
    );
    expect(plain(rowOf(container, B1).textContent)).not.toContain("a rischio");
  });

  it("never asks for the menu prices", async () => {
    await open();
    expect(calls.map((c) => c.path)).toEqual(["/api/reports/push-list"]);
  });
});

describe("the push page: refusals", () => {
  it("a 403 says the page is reserved", async () => {
    list = () => fail(403, "forbidden", "x");
    render(createElement(PushPage));
    expect(await screen.findByText(/riservata/)).toBeTruthy();
  });

  it("any other failure shows the server's message", async () => {
    list = () => fail(500, "report_unavailable", "I dati non sono disponibili. Riprova tra poco.");
    render(createElement(PushPage));
    expect(await screen.findByText("I dati non sono disponibili. Riprova tra poco.")).toBeTruthy();
  });
});

describe("M24: the CSV link", () => {
  it("the owner has a download link to push-list.csv", async () => {
    await open();
    const link = await screen.findByRole("link", { name: "Scarica CSV" });
    expect(link.getAttribute("href")).toBe("/api/exports/push-list.csv");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("the chef has none", async () => {
    meRole = "chef";
    list = () => ok(PUSH_LIST_CHEF);
    await open();
    expect(screen.queryByRole("link", { name: "Scarica CSV" })).toBeNull();
  });

  it("there is none while the list is loading", () => {
    list = () => new Promise(() => undefined) as never;
    render(createElement(PushPage));
    expect(screen.queryByRole("link", { name: "Scarica CSV" })).toBeNull();
  });
});

describe("the push page, a dish sold by weight (P2-0b, D-11)", () => {
  const WEIGHTED_MENU = {
    ...MANAGE_MENU,
    items: [{ ...WEIGHTED_ITEM, id: STEW_ITEM, name: "Spezzatino con polenta" }],
  };

  it("the sheet says the menu price per 100 g, and a refusal repeats it per 100 g", async () => {
    menuReply = ok(WEIGHTED_MENU);
    pushReply = fail(422, "push_price_above_menu", "x");
    const { container } = await open();
    fireEvent.click(within(rowOf(container, B1)).getByRole("button", { name: /^Spingi oggi/ }));
    const sheet = await screen.findByRole("group", { name: "Spezzatino con polenta" });
    await waitFor(() =>
      expect(plain(sheet.textContent)).toMatch(/Prezzo del menu: 4,25 € \/ 100 g/),
    );
    fireEvent.change(within(sheet).getByLabelText(/Prezzo del giorno per etto/), {
      target: { value: "9" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(plain(sheet.textContent)).toMatch(/4,25 € \/ 100 g/));
    expect(plain(sheet.textContent)).toMatch(/non può superare/);
  });

  it("a pushed weighted plate shows its push price per 100 g, read from the menu without opening a sheet", async () => {
    menuReply = ok(WEIGHTED_MENU);
    const pushedRows = PUSH_LIST_OWNER.rows.map((row) =>
      row.id === B1
        ? {
            ...row,
            plates: row.plates.map((p) => ({
              ...p,
              pushed: true,
              pushUntil: "2026-11-05T01:00:00Z",
              pushPrice: 3.9,
            })),
          }
        : row,
    );
    list = () => ok({ ...PUSH_LIST_OWNER, rows: pushedRows });
    const { container } = await open();
    await waitFor(() => expect(plain(rowOf(container, B1).textContent)).toMatch(/3,90 € \/ 100 g/));
    expect(calls.filter((c) => c.path === "/api/menu/items")).toHaveLength(1);
  });

  it("a chef never triggers the menu read", async () => {
    meRole = "chef";
    list = () => ok(PUSH_LIST_CHEF);
    await open();
    expect(calls.map((c) => c.path)).toEqual(["/api/reports/push-list"]);
  });

  const pushedList = () => {
    const rows = PUSH_LIST_OWNER.rows.map((row) =>
      row.id === B1
        ? {
            ...row,
            plates: row.plates.map((p) => ({
              ...p,
              pushed: true,
              pushUntil: "2026-11-05T01:00:00Z",
              pushPrice: 3.9,
            })),
          }
        : row,
    );
    return ok({ ...PUSH_LIST_OWNER, rows });
  };

  it("until the menu has answered, or if it fails, a pushed price is not shown bare; once known it is per 100 g", async () => {
    list = pushedList;
    let release: (value: Result) => void = () => undefined;
    menuReply = ok(WEIGHTED_MENU);
    const pending = new Promise<Result>((resolve) => (release = resolve));
    // The menu read waits for `release`; every other path answers as in the other tests.
    apiJson.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
      if (path !== "/api/menu/items") return defaultApi(path, init);
      calls.push({ path, method: "GET", body: undefined });
      return pending;
    });
    const { container } = await open();
    await waitFor(() => expect(calls.some((c) => c.path === "/api/menu/items")).toBe(true));
    // Pending: the time only, no euro.
    expect(plain(rowOf(container, B1).textContent)).toContain("In evidenza fino alle 02:00");
    expect(plain(rowOf(container, B1).textContent)).not.toMatch(/3,90/);
    release(ok(WEIGHTED_MENU));
    await waitFor(() => expect(plain(rowOf(container, B1).textContent)).toMatch(/3,90 € \/ 100 g/));
  });

  it("a failed menu read leaves the time only, never a bare price", async () => {
    list = pushedList;
    menuReply = fail(500, "internal", "x");
    const { container } = await open();
    await waitFor(() => expect(calls.some((c) => c.path === "/api/menu/items")).toBe(true));
    // Let the failed read settle (its reply, then the page's handler) before checking nothing appeared.
    const menuCall = apiJson.mock.calls.findIndex(([path]) => path === "/api/menu/items");
    await apiJson.mock.results[menuCall]!.value;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plain(rowOf(container, B1).textContent)).toContain("In evidenza fino alle 02:00");
    expect(plain(rowOf(container, B1).textContent)).not.toMatch(/3,90/);
  });

  it("opening a sheet while the menu read is in flight makes one request, not two", async () => {
    list = pushedList;
    let release: (value: Result) => void = () => undefined;
    const pending = new Promise<Result>((resolve) => (release = resolve));
    // The menu read waits for `release`; every other path answers as in the other tests.
    apiJson.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
      if (path !== "/api/menu/items") return defaultApi(path, init);
      calls.push({ path, method: "GET", body: undefined });
      return pending;
    });
    const { container } = await open();
    await waitFor(() => expect(calls.some((c) => c.path === "/api/menu/items")).toBe(true));
    const other = PUSH_LIST_OWNER.rows.find((row) => row.id !== B1 && row.plates.length > 0)!;
    fireEvent.click(
      within(rowOf(container, other.id)).getByRole("button", { name: /^Spingi oggi/ }),
    );
    release(ok(WEIGHTED_MENU));
    await screen.findByRole("group");
    expect(calls.filter((c) => c.path === "/api/menu/items")).toHaveLength(1);
  });
});

describe("the push page, Com'è andata (P2-2)", () => {
  it("shows the section below the list, and reads it once, with no date, next to the list's own read", async () => {
    const view = await open();
    await screen.findByRole("heading", { name: "Com'è andata" });
    expect(sellCalls).toEqual(["/api/reports/push-sell-through"]);
    const headings = [...view.container.querySelectorAll("h1, h2")].map((h) => h.textContent);
    expect(headings.indexOf("Da spingere")).toBeLessThan(headings.indexOf("Com'è andata"));
    const list = view.container.querySelector("[data-push-row-id]")!;
    const section = view.container.querySelector("#sell-title")!;
    expect(list.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
