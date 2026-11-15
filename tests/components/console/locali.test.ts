// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meReply, tenantSummary } from "./console-fixtures";

// SP3 step 18, step 17: Locali, the console's home. It reads nothing itself: the shell's tenant list is the data.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

const calls: { path: string; method: string | undefined }[] = [];
let replies: Record<string, (Reply | "pending")[]> = {};
const apiJson = vi.fn((path: string, init?: { method?: string }) => {
  calls.push({ path, method: init?.method });
  const next = replies[path]?.shift();
  if (next === "pending") return new Promise(() => undefined);
  return Promise.resolve(next ?? { ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string }) => apiJson(path, init),
}));

// The address as a tiny store: router.replace writes it, useSearchParams reads it, so a header click really changes what the screen sees.
const address = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  return {
    get: () => search,
    set(next: string) {
      search = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
});
const replace = vi.fn((href: string) => address.set(href.split("?")[1] ?? ""));
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/",
    useRouter: () => ({ replace, push: vi.fn() }),
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(address.subscribe, address.get, address.get)),
  };
});

import { ConsoleShell } from "@/components/console/console-shell";
import { LocaliScreen } from "@/components/console/locali-screen";

const ME = "/api/platform/me";
const TENANTS = "/api/platform/tenants";
const MODE = "/api/platform/console";
const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;
const ok = (data: unknown): Reply => ({ ok: true, status: 200, data });
const fail = (status: number, code: string): Reply => ({
  ok: false,
  status,
  error: { code, message: "dal server" },
});
const ids = {
  a: "a0000000-0000-4000-8000-00000000000a",
  b: "b0000000-0000-4000-8000-00000000000b",
  c: "c0000000-0000-4000-8000-00000000000c",
  d: "d0000000-0000-4000-8000-00000000000d",
};
const org = (name: string, tenantCount: number) => ({
  id: "e0000000-0000-4000-8000-00000000000e",
  name,
  tenantCount,
});
// server order: A, B, C, D
const TENANT_LIST = [
  tenantSummary({
    id: ids.a,
    name: "Osteria Demo A",
    organisation: org("Osteria Demo A", 1),
    members: { owner: 1, admin: 0, chef: 1, waiter: 2 },
    digialtoAttached: false,
    lastActivityDate: "2026-11-15",
  }),
  tenantSummary({
    id: ids.b,
    name: "Bar Demo",
    organisation: org("Gruppo Demo", 2),
    members: { owner: 1, admin: 0, chef: 0, waiter: 0 },
    digialtoAttached: true,
    lastActivityDate: "2026-11-14",
  }),
  tenantSummary({
    id: ids.c,
    name: "Zeta Demo",
    organisation: org("Gruppo Demo", 2),
    members: { owner: 0, admin: 1, chef: 0, waiter: 0 },
    digialtoAttached: true,
    lastActivityDate: null,
  }),
  tenantSummary({
    id: ids.d,
    name: "Cantina Demo",
    organisation: org("Cantina Demo", 1),
    members: { owner: 2, admin: 0, chef: 0, waiter: 0 },
    digialtoAttached: false,
    lastActivityDate: "2026-11-12",
  }),
];
const SERVER_ORDER = ["Osteria Demo A", "Bar Demo", "Zeta Demo", "Cantina Demo"];

function happy(unread = 1) {
  replies[ME] = [ok(meReply({ unreadNotices: unread }))];
  replies[TENANTS] = [ok({ tenants: TENANT_LIST })];
}
const mount = () => render(createElement(ConsoleShell, null, createElement(LocaliScreen)));
const table = () => screen.getByTestId("locali-table");
const list = () => screen.getByTestId("locali-list");
const tableNames = () =>
  within(table())
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("link")[0]!.textContent!.trim());
const listNames = () =>
  within(list())
    .getAllByRole("listitem")
    .map(
      (li) => within(li).getAllByRole("link")[0]!.querySelector("[data-slot=title]")!.textContent,
    );
const ready = () => screen.findByTestId("locali-table");
const th = (name: string) => within(table()).getByRole("columnheader", { name });
const sortButton = (name: string) => within(th(name)).getByRole("button");

beforeEach(() => {
  calls.length = 0;
  replies = {};
  address.set("");
  apiJson.mockClear();
  replace.mockClear();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
  Object.defineProperty(window, "location", {
    value: { assign: vi.fn(), reload: vi.fn(), replace: vi.fn(), pathname: "/", search: "" },
    configurable: true,
  });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  Object.defineProperty(window, "location", originalLocation);
});

describe("Locali: the rows", () => {
  it("renders the h1 «Locali» and one row per tenant from the shell's read, in the server order", async () => {
    happy();
    mount();
    await ready();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Locali" })).toBeTruthy();
    expect(tableNames()).toEqual(SERVER_ORDER);
    expect(listNames()).toEqual(SERVER_ORDER);
    // the screen reads nothing of its own: the shell's one read is the data
    expect(calls.filter((c) => c.path === TENANTS)).toHaveLength(1);
  });

  it("shows Locale (with the people), Gruppo, Ultima attività and DigiAlto in the columns", async () => {
    happy();
    mount();
    await ready();
    const rows = within(table()).getAllByRole("row");
    expect(
      within(rows[0]!)
        .getAllByRole("columnheader")
        .map((h) => h.textContent!.replace(/[▲▼]/g, "").trim()),
    ).toEqual(["Locale", "Gruppo", "Ultima attività", "DigiAlto"]);
    const cells = (i: number) =>
      within(rows[i]!)
        .getAllByRole("cell")
        .map((c) => c.textContent);
    expect(cells(1)).toEqual(["Osteria Demo A4 persone", "—", "oggi", "No"]);
    expect(cells(2)).toEqual(["Bar Demo1 persona", "Gruppo Demo", "ieri", "Sì"]);
    expect(cells(3)).toEqual(["Zeta Demo1 persona", "Gruppo Demo", "—", "Sì"]);
    expect(cells(4)).toEqual(["Cantina Demo2 persone", "—", "12 nov", "No"]);
  });

  it("a «No» is wrapped in <strong> and a «Sì» is not, with no font-bold class on the cell", async () => {
    happy();
    mount();
    await ready();
    const rows = within(table()).getAllByRole("row");
    const digialto = (i: number) => within(rows[i]!).getAllByRole("cell")[3]!;
    expect(digialto(1).querySelector("strong")!.textContent).toBe("No");
    expect(digialto(2).querySelector("strong")).toBeNull();
    expect(digialto(1).className).not.toContain("font-bold");
  });

  it("on the phone the «no» of «DigiAlto: no» is <strong>, the «sì» of «DigiAlto: sì» is not", async () => {
    happy();
    mount();
    await ready();
    const items = within(list()).getAllByRole("listitem");
    const strongs = (i: number) =>
      [...items[i]!.querySelectorAll("strong")].map((n) => n.textContent);
    expect(strongs(0)).toEqual(["no"]);
    expect(strongs(1)).toEqual([]);
    expect(strongs(2)).toEqual([]);
    expect(strongs(3)).toEqual(["no"]);
  });

  it("the phone list shows the meta line of each venue", async () => {
    happy();
    mount();
    await ready();
    const metas = within(list())
      .getAllByRole("listitem")
      .map((li) => li.querySelector("[data-slot=meta]")!.textContent);
    expect(metas).toEqual([
      "4 persone · — · oggi · DigiAlto: no",
      "1 persona · Gruppo Demo · ieri · DigiAlto: sì",
      "1 persona · Gruppo Demo · — · DigiAlto: sì",
      "2 persone · — · 12 nov · DigiAlto: no",
    ]);
  });

  it("each row has one link, to /locali/<id>, in the table and in the list", async () => {
    happy();
    mount();
    await ready();
    const rows = within(table()).getAllByRole("row").slice(1);
    for (const [i, row] of rows.entries()) {
      const links = within(row).getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]!.getAttribute("href")).toBe(`/locali/${TENANT_LIST[i]!.id}`);
    }
    const items = within(list()).getAllByRole("listitem");
    for (const [i, item] of items.entries()) {
      const links = within(item).getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]!.getAttribute("href")).toBe(`/locali/${TENANT_LIST[i]!.id}`);
    }
  });

  it("no link anywhere starts with /console", async () => {
    happy();
    const { container } = mount();
    await ready();
    for (const a of container.querySelectorAll("a"))
      expect(a.getAttribute("href")).not.toMatch(/^\/console/);
  });
});

describe("Locali: sorting", () => {
  it("a header click writes ?ordina=nome&verso=asc, a second click desc", async () => {
    happy();
    mount();
    await ready();
    fireEvent.click(sortButton("Locale"));
    expect(replace).toHaveBeenLastCalledWith("/?ordina=nome&verso=asc");
    await waitFor(() =>
      expect(tableNames()).toEqual(["Bar Demo", "Cantina Demo", "Osteria Demo A", "Zeta Demo"]),
    );
    fireEvent.click(sortButton("Locale"));
    expect(replace).toHaveBeenLastCalledWith("/?ordina=nome&verso=desc");
    await waitFor(() =>
      expect(tableNames()).toEqual(["Zeta Demo", "Osteria Demo A", "Cantina Demo", "Bar Demo"]),
    );
  });

  it("a first click on Ultima attività sorts newest first", async () => {
    happy();
    mount();
    await ready();
    fireEvent.click(sortButton("Ultima attività"));
    expect(replace).toHaveBeenLastCalledWith("/?ordina=attivita&verso=desc");
  });

  it("every header carries aria-sort: none until chosen, then ascending or descending", async () => {
    happy();
    mount();
    await ready();
    for (const name of ["Locale", "Gruppo", "Ultima attività", "DigiAlto"])
      expect(th(name).getAttribute("aria-sort")).toBe("none");
    fireEvent.click(sortButton("Gruppo"));
    await waitFor(() => expect(th("Gruppo").getAttribute("aria-sort")).toBe("ascending"));
    expect(th("Locale").getAttribute("aria-sort")).toBe("none");
    fireEvent.click(sortButton("Gruppo"));
    await waitFor(() => expect(th("Gruppo").getAttribute("aria-sort")).toBe("descending"));
  });

  it("applies ?ordina=attivita&verso=asc on load (no date last)", async () => {
    address.set("ordina=attivita&verso=asc");
    happy();
    mount();
    await ready();
    expect(tableNames()).toEqual(["Cantina Demo", "Bar Demo", "Osteria Demo A", "Zeta Demo"]);
    // the phone list follows the same sort
    expect(listNames()).toEqual(tableNames());
  });

  it("ignores an unknown ?ordina=prezzo: the server order, no aria-sort", async () => {
    address.set("ordina=prezzo&verso=desc");
    happy();
    mount();
    await ready();
    expect(tableNames()).toEqual(SERVER_ORDER);
    expect(table().querySelector("[aria-sort=ascending],[aria-sort=descending]")).toBeNull();
  });

  it("the sort buttons are 44 px targets", async () => {
    happy();
    mount();
    await ready();
    for (const b of within(table()).getAllByRole("button"))
      expect(b.className).toContain("min-h-tap");
  });
});

describe("Locali: search", () => {
  it("filters the rows, writes cerca, and says how many are shown", async () => {
    happy();
    mount();
    await ready();
    expect(screen.getByText("Mostro 4 locali.")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Cerca un locale…" }), {
      target: { value: "bar" },
    });
    expect(replace).toHaveBeenLastCalledWith("/?cerca=bar");
    expect(tableNames()).toEqual(["Bar Demo"]);
    expect(listNames()).toEqual(["Bar Demo"]);
    expect(screen.getByText("Mostro 1 di 4 locali.")).toBeTruthy();
  });

  it("keeps the sort in the address while searching", async () => {
    address.set("ordina=nome&verso=desc");
    happy();
    mount();
    await ready();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "demo" } });
    expect(replace).toHaveBeenLastCalledWith("/?ordina=nome&verso=desc&cerca=demo");
  });

  it("starts from ?cerca= in the address", async () => {
    address.set("cerca=cantina");
    happy();
    mount();
    await ready();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("cantina");
    expect(tableNames()).toEqual(["Cantina Demo"]);
  });

  it("says so when nothing matches, and «Togli i filtri» clears the search", async () => {
    happy();
    mount();
    await ready();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyz" } });
    expect(screen.getByText("Nessun locale con questi filtri.")).toBeTruthy();
    expect(screen.queryByTestId("locali-table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Togli i filtri" }));
    expect(replace).toHaveBeenLastCalledWith("/");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(tableNames()).toEqual(SERVER_ORDER);
  });

  it("says «Mostro 0 locali.» when there are no venues at all, with no filter button", async () => {
    replies[ME] = [ok(meReply())];
    replies[TENANTS] = [ok({ tenants: [] })];
    mount();
    await screen.findByText("Mostro 0 locali.");
    expect(screen.queryByRole("button", { name: "Togli i filtri" })).toBeNull();
  });
});

describe("Locali: the address changes from outside", () => {
  it("a move to / clears the search box and the filter, and the next header click does not write cerca back", async () => {
    happy();
    mount();
    await ready();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "osteria" } });
    expect(tableNames()).toEqual(["Osteria Demo A"]);
    expect(address.get()).toBe("cerca=osteria");
    act(() => address.set(""));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(tableNames()).toEqual(SERVER_ORDER);
    fireEvent.click(sortButton("Locale"));
    expect(replace).toHaveBeenLastCalledWith("/?ordina=nome&verso=asc");
  });

  it("a move to another ?cerca= is followed", async () => {
    happy();
    mount();
    await ready();
    act(() => address.set("cerca=cantina"));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("cantina");
    expect(tableNames()).toEqual(["Cantina Demo"]);
  });

  it("typing stays responsive when the address lags behind: a later keystroke is not overwritten by an earlier address", async () => {
    happy();
    replace.mockImplementationOnce(() => undefined).mockImplementationOnce(() => undefined);
    mount();
    await ready();
    const box = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "bar" } });
    expect(box.value).toBe("bar");
    fireEvent.change(box, { target: { value: "bar d" } });
    expect(box.value).toBe("bar d");
    // the address catches up with the first value only
    act(() => address.set("cerca=bar"));
    expect(box.value).toBe("bar d");
  });
});

describe("Locali: states", () => {
  it("shows «Caricamento…» with the search disabled until the list arrives", () => {
    replies[ME] = ["pending"];
    replies[TENANTS] = ["pending"];
    mount();
    expect(screen.getByText("Caricamento…")).toBeTruthy();
    expect((screen.getByRole("searchbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByTestId("locali-table")).toBeNull();
  });

  it("a failed read shows «Non riesco a leggere i locali.» and «Riprova» reads the list again", async () => {
    replies[ME] = [ok(meReply())];
    replies[TENANTS] = [fail(400, "invalid_request"), ok({ tenants: TENANT_LIST })];
    mount();
    expect(await screen.findByText("Non riesco a leggere i locali.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await ready();
    expect(calls.filter((c) => c.path === TENANTS)).toHaveLength(2);
  });

  it("a console that does not answer says so", async () => {
    replies[ME] = [fail(503, "console_switch_failed")];
    replies[TENANTS] = [fail(503, "console_switch_failed")];
    mount();
    expect(await screen.findByText("La console non risponde. Riprova tra poco.")).toBeTruthy();
  });

  it("«Riprova» after console_unavailable posts /api/platform/console again", async () => {
    sessionStorage.setItem("costi.console.switching", "1");
    replies[ME] = [fail(409, "console_selection_required")];
    replies[TENANTS] = [fail(409, "console_selection_required")];
    mount();
    expect(await screen.findByText("La console non risponde. Riprova tra poco.")).toBeTruthy();
    expect(calls.filter((c) => c.path === MODE)).toHaveLength(0);
    replies[TENANTS] = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await waitFor(() => expect(calls.filter((c) => c.path === MODE)).toHaveLength(1));
  });

  it("shows no list and no error while the page is being left for another", async () => {
    replies[ME] = [fail(409, "console_selection_required")];
    replies[TENANTS] = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    mount();
    await waitFor(() => expect(calls.filter((c) => c.path === MODE)).toHaveLength(1));
    expect(screen.getByText("Caricamento…")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Locali: the notices link", () => {
  it("«1 avviso da leggere» links to /avvisi", async () => {
    happy(1);
    mount();
    const link = await screen.findByRole("link", { name: "1 avviso da leggere" });
    expect(link.getAttribute("href")).toBe("/avvisi");
  });

  it("uses the plural, and is hidden at zero and while /me has not answered", async () => {
    happy(3);
    mount();
    expect(await screen.findByRole("link", { name: "3 avvisi da leggere" })).toBeTruthy();
    cleanup();
    happy(0);
    mount();
    await ready();
    expect(screen.queryByText(/da leggere/)).toBeNull();
  });
});

describe("Locali: layout and content rules", () => {
  it("the table is for laptops and the list for phones", async () => {
    happy();
    mount();
    await ready();
    expect(table().className).toMatch(/\bhidden\b/);
    expect(table().className).toContain("lg:block");
    expect(list().className).toContain("lg:hidden");
  });

  it("long names wrap instead of widening the page (360 px)", async () => {
    happy();
    mount();
    await ready();
    for (const el of [...table().querySelectorAll("a"), ...list().querySelectorAll("a")])
      expect(el.className + el.innerHTML).toContain("overflow-wrap:anywhere");
    expect(table().querySelector("table")!.className).toContain("w-full");
  });

  it("has no Stato, Piano, Salute or «Nuovo locale», no e-mail address and no primary button", async () => {
    happy();
    const { container } = mount();
    await ready();
    const text = container.textContent!;
    for (const word of ["Stato", "Piano", "Salute", "Nuovo locale"])
      expect(text).not.toContain(word);
    expect(container.innerHTML).not.toContain("@");
    expect(container.querySelector("button[class*='bg-accent']")).toBeNull();
  });

  it("makes no second read when time passes", async () => {
    happy();
    mount();
    await ready();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls.filter((c) => c.path === TENANTS)).toHaveLength(1);
    expect(calls.filter((c) => c.path === ME)).toHaveLength(1);
  });
});
