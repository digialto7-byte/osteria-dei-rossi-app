// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditRow,
  DEMO_TENANT_B_ID,
  DEMO_TENANT_ID,
  meReply,
  tenantSummary,
} from "./console-fixtures";
import { expectSameFocusedButton, pressRetryHolding } from "./retry-focus";

// SP3 step 18, step 19: the platform audit. Codes and ids only; dal and al are always sent.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
type Queued = Reply | "pending" | (() => Promise<Reply>);

const calls: { path: string; method: string | undefined }[] = [];
let replies: Record<string, Queued[]> = {};
const apiJson = vi.fn((path: string, init?: { method?: string }) => {
  calls.push({ path, method: init?.method });
  const key = path.startsWith("/api/platform/audit") ? "audit" : path;
  const next = replies[key]?.shift();
  if (next === "pending") return new Promise(() => undefined);
  if (typeof next === "function") return next();
  return Promise.resolve(next ?? { ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string }) => apiJson(path, init),
}));

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
    usePathname: () => "/registro",
    useRouter: () => ({ replace, push: vi.fn() }),
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(address.subscribe, address.get, address.get)),
  };
});

import { ConsoleShell } from "@/components/console/console-shell";
import { RegistroScreen } from "@/components/console/registro-screen";

const ME = "/api/platform/me";
const TENANTS = "/api/platform/tenants";
const MODE = "/api/platform/console";
const FIRST = "/api/platform/audit?dal=2026-10-17&al=2026-11-15";
const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;
const ok = (data: unknown): Reply => ({ ok: true, status: 200, data });
const fail = (status: number, code: string): Reply => ({
  ok: false,
  status,
  error: { code, message: "dal server" },
});
const ROWS = [
  auditRow({
    id: 10,
    at: "2026-11-14T08:40:00Z",
    tenantId: DEMO_TENANT_ID,
    tenantName: "Osteria Demo A",
    action: "console.tenant_opened",
    origin: "console",
    detail: { mode: "console", changed: true, note: null },
  }),
  auditRow({
    id: 9,
    at: "2026-11-14T07:12:00Z",
    tenantId: null,
    tenantName: null,
    action: "console.entered",
    origin: "console",
    detail: {},
  }),
  auditRow({
    id: 8,
    at: "2026-11-13T21:05:00Z",
    tenantId: DEMO_TENANT_B_ID,
    tenantName: "Bar Demo",
    action: "script.create_tenant",
    origin: "script",
    detail: { step: 3 },
  }),
];
const TENANT_LIST = [
  tenantSummary({ id: DEMO_TENANT_ID, name: "Osteria Demo A" }),
  tenantSummary({ id: DEMO_TENANT_B_ID, name: "Bar Demo" }),
];
const page = (rows = ROWS, nextBefore: number | null = null): Reply => ok({ rows, nextBefore });

function setup(first: Queued = page()) {
  replies[ME] = [ok(meReply())];
  replies[TENANTS] = [ok({ tenants: TENANT_LIST })];
  replies.audit = [first];
}
const mount = () => render(createElement(ConsoleShell, null, createElement(RegistroScreen)));
const auditCalls = () =>
  calls.filter((c) => c.path.startsWith("/api/platform/audit")).map((c) => c.path);
const table = () => screen.findByTestId("audit-table");
const list = () => screen.getByTestId("audit-list");
const options = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .map((o) => o.textContent);

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
    value: {
      assign: vi.fn(),
      reload: vi.fn(),
      replace: vi.fn(),
      pathname: "/registro",
      search: "",
    },
    configurable: true,
  });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  Object.defineProperty(window, "location", originalLocation);
});

describe("Registro: the first read", () => {
  it("with no params the first request is /api/platform/audit?dal=2026-10-17&al=2026-11-15", async () => {
    setup();
    mount();
    await table();
    expect(auditCalls()).toEqual([FIRST]);
  });

  it("has one h1 «Registro della piattaforma»", async () => {
    setup();
    mount();
    await table();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Registro della piattaforma" }),
    ).toBeTruthy();
  });

  it("the Azione options are «Tutte» and the ten sentences, in the order of the code list", async () => {
    setup();
    mount();
    await table();
    expect(options(screen.getByLabelText("Azione"))).toEqual([
      "Tutte",
      "Account DigiAlto creato",
      "Verifica in due passaggi attivata",
      "Accesso alla console",
      "Uscita dalla console",
      "Locale aperto dalla console",
      "Nuovo avviso",
      "Locale avvisato",
      "Locale creato con lo script",
      "Reset del secondo fattore (disconnessione da tutti i locali)",
      "Obbligo della verifica cambiato con lo script",
    ]);
  });

  it("the Locale options are «Tutti» and the shell's venues by name", async () => {
    setup();
    mount();
    await table();
    await waitFor(() =>
      expect(options(screen.getByLabelText("Locale"))).toEqual([
        "Tutti",
        "Bar Demo",
        "Osteria Demo A",
      ]),
    );
  });

  it("makes no second read of the venues for its filter", async () => {
    setup();
    mount();
    await table();
    expect(calls.filter((c) => c.path === TENANTS)).toHaveLength(1);
  });
});

describe("Registro: filters", () => {
  it("an Azione change sends dal, al and azione, and writes the address", async () => {
    setup();
    replies.audit!.push(page([ROWS[1]!]));
    mount();
    await table();
    fireEvent.change(screen.getByLabelText("Azione"), { target: { value: "console.entered" } });
    expect(replace).toHaveBeenLastCalledWith("/registro?azione=console.entered");
    await waitFor(() => expect(auditCalls()).toHaveLength(2));
    expect(auditCalls()[1]).toBe(`${FIRST}&azione=console.entered`);
  });

  it("a Locale change sends locale and writes the address", async () => {
    setup();
    replies.audit!.push(page([ROWS[0]!]));
    mount();
    await table();
    await waitFor(() => expect(options(screen.getByLabelText("Locale"))).toContain("Bar Demo"));
    fireEvent.change(screen.getByLabelText("Locale"), { target: { value: DEMO_TENANT_B_ID } });
    expect(replace).toHaveBeenLastCalledWith(`/registro?locale=${DEMO_TENANT_B_ID}`);
    await waitFor(() => expect(auditCalls()).toHaveLength(2));
    expect(auditCalls()[1]).toBe(`${FIRST}&locale=${DEMO_TENANT_B_ID}`);
  });

  it("a Dal change sends the new dal with the same al, and keeps the dates in the address", async () => {
    setup();
    replies.audit!.push(page([]));
    mount();
    await table();
    fireEvent.change(screen.getByLabelText("Dal"), { target: { value: "2026-10-01" } });
    expect(replace).toHaveBeenLastCalledWith("/registro?dal=2026-10-01&al=2026-11-15");
    await waitFor(() => expect(auditCalls()).toHaveLength(2));
    expect(auditCalls()[1]).toBe("/api/platform/audit?dal=2026-10-01&al=2026-11-15");
  });

  it("starts from the address: ?locale=<id> is preselected and sent", async () => {
    address.set(`locale=${DEMO_TENANT_B_ID}`);
    setup();
    mount();
    await table();
    expect(auditCalls()).toEqual([`${FIRST}&locale=${DEMO_TENANT_B_ID}`]);
    await waitFor(() =>
      expect((screen.getByLabelText("Locale") as HTMLSelectElement).value).toBe(DEMO_TENANT_B_ID),
    );
  });

  it("a locale the list does not hold is still shown selected, by its short id", async () => {
    address.set("locale=99999999-0000-4000-8000-000000000099");
    setup();
    mount();
    await table();
    await waitFor(() =>
      expect(options(screen.getByLabelText("Locale"))).toContain("Locale cancellato 99999999"),
    );
    expect((screen.getByLabelText("Locale") as HTMLSelectElement).value).toBe(
      "99999999-0000-4000-8000-000000000099",
    );
  });

  it("starts from ?dal and ?al and a known ?azione; an unknown azione is ignored", async () => {
    address.set("dal=2026-11-01&al=2026-11-10&azione=console.left");
    setup();
    mount();
    await table();
    expect(auditCalls()).toEqual([
      "/api/platform/audit?dal=2026-11-01&al=2026-11-10&azione=console.left",
    ]);
    cleanup();
    calls.length = 0;
    address.set("azione=nope");
    setup();
    mount();
    await table();
    expect(auditCalls()).toEqual([FIRST]);
  });

  it("Dal after Al shows «La data iniziale è dopo quella finale.» and sends no request", async () => {
    setup();
    mount();
    await table();
    fireEvent.change(screen.getByLabelText("Dal"), { target: { value: "2026-11-20" } });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La data iniziale è dopo quella finale.",
    );
    expect(auditCalls()).toEqual([FIRST]);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("audit-table")).toBeNull();
  });

  it("a range of 367 days shows the span error and sends no request; 366 days is sent", async () => {
    setup();
    replies.audit!.push(page([]));
    mount();
    await table();
    fireEvent.change(screen.getByLabelText("Dal"), { target: { value: "2025-11-13" } });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Il periodo può durare al massimo 366 giorni.",
    );
    expect(auditCalls()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Dal"), { target: { value: "2025-11-14" } });
    await waitFor(() => expect(auditCalls()).toHaveLength(2));
    expect(auditCalls()[1]).toBe("/api/platform/audit?dal=2025-11-14&al=2026-11-15");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a cleared date sends nothing, shows no list and says «Data non valida.»", async () => {
    setup();
    mount();
    await table();
    fireEvent.change(screen.getByLabelText("Al"), { target: { value: "" } });
    await waitFor(() => expect(screen.queryByTestId("audit-table")).toBeNull());
    expect((await screen.findByRole("alert")).textContent).toBe("Data non valida.");
    expect(auditCalls()).toHaveLength(1);
  });

  it("a date cleared and typed again reads the same range again", async () => {
    setup();
    replies.audit!.push(page([ROWS[1]!]));
    mount();
    await table();
    fireEvent.change(screen.getByLabelText("Al"), { target: { value: "" } });
    await waitFor(() => expect(screen.queryByTestId("audit-table")).toBeNull());
    fireEvent.change(screen.getByLabelText("Al"), { target: { value: "2026-11-15" } });
    await waitFor(() => expect(auditCalls()).toEqual([FIRST, FIRST]));
    await table();
  });

  it("a slow older answer never replaces a newer one", async () => {
    let releaseFirst!: (reply: Reply) => void;
    replies[ME] = [ok(meReply())];
    replies[TENANTS] = [ok({ tenants: TENANT_LIST })];
    replies.audit = [
      () => new Promise<Reply>((resolve) => (releaseFirst = resolve)),
      page([ROWS[1]!]),
    ];
    mount();
    await waitFor(() => expect(auditCalls()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Azione"), { target: { value: "console.entered" } });
    const inTable = () => within(screen.getByTestId("audit-table"));
    await waitFor(() => expect(inTable().getByText("Accesso alla console")).toBeTruthy());
    await act(async () => releaseFirst(page([ROWS[0]!])));
    expect(inTable().queryByText("Locale aperto dalla console")).toBeNull();
    expect(inTable().getByText("Accesso alla console")).toBeTruthy();
  });
});

describe("Registro: the address changes from outside", () => {
  it("a move from /registro?locale=<id> to /registro clears the filter, the select and the next request", async () => {
    address.set(`locale=${DEMO_TENANT_B_ID}`);
    setup();
    replies.audit!.push(page());
    mount();
    await table();
    expect(auditCalls()).toEqual([`${FIRST}&locale=${DEMO_TENANT_B_ID}`]);
    act(() => address.set(""));
    await waitFor(() => expect(auditCalls()).toHaveLength(2));
    expect(auditCalls()[1]).toBe(FIRST);
    expect((screen.getByLabelText("Locale") as HTMLSelectElement).value).toBe("");
  });

  it("a move to another address is followed, and typing a filter is not undone by its own address", async () => {
    setup();
    replies.audit!.push(page([ROWS[1]!]), page());
    mount();
    await table();
    fireEvent.change(screen.getByLabelText("Azione"), { target: { value: "console.entered" } });
    await waitFor(() => expect(auditCalls()).toHaveLength(2));
    expect((screen.getByLabelText("Azione") as HTMLSelectElement).value).toBe("console.entered");
    act(() => address.set("azione=console.left"));
    await waitFor(() => expect(auditCalls()).toHaveLength(3));
    expect(auditCalls()[2]).toBe(`${FIRST}&azione=console.left`);
    expect((screen.getByLabelText("Azione") as HTMLSelectElement).value).toBe("console.left");
  });
});

describe("Registro: extra pages and a restarted read", () => {
  it("a filter round trip back to the same range shows only the fresh first page", async () => {
    setup(page([ROWS[0]!], 9));
    replies.audit!.push(page([ROWS[1]!], null), page([ROWS[2]!], null), page([ROWS[0]!], 9));
    mount();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "Carica altri" }));
    await waitFor(() =>
      expect(within(screen.getByTestId("audit-table")).getAllByRole("row")).toHaveLength(3),
    );
    fireEvent.change(screen.getByLabelText("Azione"), { target: { value: "console.entered" } });
    await waitFor(() => expect(auditCalls()).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Azione"), { target: { value: "" } });
    await waitFor(() => expect(auditCalls()).toHaveLength(4));
    await waitFor(() =>
      expect(within(screen.getByTestId("audit-table")).getAllByRole("row")).toHaveLength(2),
    );
    expect(screen.getByRole("button", { name: "Carica altri" })).toBeTruthy();
  });
});

describe("Registro: the table and the list", () => {
  it("has the columns Quando, Locale, Azione and Da", async () => {
    setup();
    mount();
    const t = await table();
    expect(
      within(t)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Quando", "Locale", "Azione", "Da"]);
  });

  it("each row: the time, the venue (or a dash), the sentence with its raw code, and the origin", async () => {
    setup();
    mount();
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    const cells = (i: number) =>
      within(rows[i]!)
        .getAllByRole("cell")
        .map((c) => c.textContent);
    expect(cells(0)).toEqual([
      "14 nov 2026, 09:40",
      "Osteria Demo A",
      "Locale aperto dalla consolecodice: console.tenant_opened",
      "Console",
    ]);
    expect(cells(1)).toEqual([
      "14 nov 2026, 08:12",
      "—",
      "Accesso alla consolecodice: console.entered",
      "Console",
    ]);
    expect(cells(2)[3]).toBe("Script");
  });

  it("an erased venue shows «Locale cancellato» and its short id", async () => {
    setup(page([auditRow({ tenantId: "12345678-0000-4000-8000-000000000012", tenantName: null })]));
    mount();
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    expect(within(rows[0]!).getAllByRole("cell")[1]!.textContent).toBe(
      "Locale cancellato 12345678",
    );
  });

  it("an unknown action shows its code", async () => {
    setup(page([auditRow({ action: "future.thing" as never })]));
    mount();
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    expect(within(rows[0]!).getAllByRole("cell")[2]!.textContent).toBe(
      "future.thingcodice: future.thing",
    );
  });

  it("the phone list shows the sentence and «14 nov 2026, 09:40 · Osteria Demo A · Console»", async () => {
    setup();
    mount();
    await table();
    const first = within(list()).getAllByRole("listitem")[0]!;
    expect(first.querySelector("[data-slot=title]")!.textContent).toBe(
      "Locale aperto dalla console",
    );
    expect(first.querySelector("[data-slot=meta]")!.textContent).toBe(
      "14 nov 2026, 09:40 · Osteria Demo A · Console",
    );
  });

  it("the table is for laptops and the list for phones", async () => {
    setup();
    mount();
    const t = await table();
    expect(t.className).toMatch(/\bhidden\b/);
    expect(t.className).toContain("lg:block");
    expect(list().className).toContain("lg:hidden");
  });

  it("says «Nessuna azione in questo periodo.» when there is none", async () => {
    setup(page([]));
    mount();
    expect(await screen.findByText("Nessuna azione in questo periodo.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Carica altri" })).toBeNull();
  });

  it("has no edit, delete or hide control", async () => {
    setup();
    mount();
    await table();
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    for (const name of names) expect(name).not.toMatch(/modific|elimin|cancell|nascond|annull/i);
  });

  it("holds no e-mail address, and the row targets are 44 px", async () => {
    setup();
    const { container } = mount();
    const t = await table();
    expect(container.innerHTML).not.toContain("@");
    for (const b of within(t).getAllByRole("button")) expect(b.className).toContain("min-h-tap");
  });
});

describe("Registro: the detail panel", () => {
  it("a row opens the panel with the action code, the ids and the detail entries only", async () => {
    setup();
    mount();
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    fireEvent.click(within(rows[0]!).getByRole("button"));
    const panel = screen.getByTestId("audit-detail");
    expect(within(panel).getByRole("heading", { level: 2, name: "Dettaglio" })).toBeTruthy();
    const text = panel.textContent!;
    expect(text).toContain("console.tenant_opened");
    // the Locale row: the name and the short id, never the whole UUID
    expect(within(panel).getByText("Locale").nextElementSibling!.textContent).toBe(
      `Osteria Demo A · ${DEMO_TENANT_ID.slice(0, 8)}`,
    );
    expect(text).not.toContain(DEMO_TENANT_ID);
    expect(text).toContain("14 nov 2026, 09:40");
    // detail entries sorted by key; null is a dash
    expect(within(panel).getByText("changed").nextElementSibling!.textContent).toBe("true");
    expect(within(panel).getByText("mode").nextElementSibling!.textContent).toBe("console");
    expect(within(panel).getByText("note").nextElementSibling!.textContent).toBe("—");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("an erased venue's panel shows «Locale cancellato» and the 8-character prefix", async () => {
    setup(page([auditRow({ tenantId: "12345678-0000-4000-8000-000000000012", tenantName: null })]));
    mount();
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    fireEvent.click(within(rows[0]!).getByRole("button"));
    const panel = screen.getByTestId("audit-detail");
    expect(within(panel).getByText("Locale").nextElementSibling!.textContent).toBe(
      "Locale cancellato 12345678",
    );
    expect(panel.textContent).not.toContain("12345678-0000");
  });

  it("a platform-wide row's panel shows a dash for the Locale", async () => {
    setup(page([auditRow({ tenantId: null, tenantName: null })]));
    mount();
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    fireEvent.click(within(rows[0]!).getByRole("button"));
    expect(
      within(screen.getByTestId("audit-detail")).getByText("Locale").nextElementSibling!
        .textContent,
    ).toBe("—");
  });

  it("«Chiudi» closes it", async () => {
    setup();
    mount();
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    fireEvent.click(within(rows[1]!).getByRole("button"));
    expect(screen.getByTestId("audit-detail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }));
    expect(screen.queryByTestId("audit-detail")).toBeNull();
  });

  it("on the phone the panel replaces the list; on a laptop the table stays", async () => {
    setup();
    mount();
    const t = await table();
    expect(list().className).not.toMatch(/(^| )hidden( |$)/);
    fireEvent.click(within(list()).getAllByRole("button")[0]!);
    expect(list().className).toMatch(/(^| )hidden( |$)/);
    expect(t.className).toContain("lg:block");
    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }));
    expect(list().className).not.toMatch(/(^| )hidden( |$)/);
  });

  it("closes when a filter reloads the list", async () => {
    setup();
    replies.audit!.push(page([ROWS[1]!]));
    mount();
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    fireEvent.click(within(rows[0]!).getByRole("button"));
    fireEvent.change(screen.getByLabelText("Azione"), { target: { value: "console.entered" } });
    await waitFor(() => expect(auditCalls()).toHaveLength(2));
    expect(screen.queryByTestId("audit-detail")).toBeNull();
  });
});

describe("Registro: Carica altri", () => {
  it("sends prima=<nextBefore>, appends the rows, and goes away when nextBefore is null", async () => {
    setup(page([ROWS[0]!, ROWS[1]!], 9));
    replies.audit!.push(page([ROWS[2]!], null));
    mount();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "Carica altri" }));
    await waitFor(() =>
      expect(within(screen.getByTestId("audit-table")).getAllByRole("row")).toHaveLength(4),
    );
    expect(auditCalls()[1]).toBe(`${FIRST}&prima=9`);
    expect(screen.queryByRole("button", { name: "Carica altri" })).toBeNull();
    expect(within(list()).getAllByRole("listitem")).toHaveLength(3);
  });

  it("keeps the button for a further page and sends the new cursor", async () => {
    setup(page([ROWS[0]!], 9));
    replies.audit!.push(page([ROWS[1]!], 8), page([ROWS[2]!], null));
    mount();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "Carica altri" }));
    await waitFor(() => expect(auditCalls()).toHaveLength(2));
    await waitFor(() =>
      expect(within(screen.getByTestId("audit-table")).getAllByRole("row")).toHaveLength(3),
    );
    fireEvent.click(screen.getByRole("button", { name: "Carica altri" }));
    await waitFor(() => expect(auditCalls()).toHaveLength(3));
    expect(auditCalls()[2]).toBe(`${FIRST}&prima=8`);
  });

  it("a failed page shows an error with «Riprova» that sends the same cursor again", async () => {
    setup(page([ROWS[0]!], 9));
    replies.audit!.push(fail(500, "internal"), page([ROWS[1]!], null));
    mount();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "Carica altri" }));
    expect(await screen.findByText("La console non risponde. Riprova tra poco.")).toBeTruthy();
    expect(within(screen.getByTestId("audit-table")).getAllByRole("row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await waitFor(() =>
      expect(within(screen.getByTestId("audit-table")).getAllByRole("row")).toHaveLength(3),
    );
    expect(auditCalls().slice(1)).toEqual([`${FIRST}&prima=9`, `${FIRST}&prima=9`]);
  });

  it("«Riprova» on a failed page keeps focus through a retry that fails again, then through one that succeeds", async () => {
    setup(page([ROWS[0]!], 9));
    replies.audit!.push(fail(500, "internal"));
    mount();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "Carica altri" }));
    await screen.findByText("La console non risponde. Riprova tra poco.");
    const first = pressRetryHolding(apiJson);
    expect(screen.getByText("La console non risponde. Riprova tra poco.")).toBeTruthy();
    await first.answer(fail(500, "internal"));
    expectSameFocusedButton(first.button);
    const second = pressRetryHolding(apiJson);
    await second.answer(page([ROWS[1]!], null));
    expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
    expect(within(screen.getByTestId("audit-table")).getAllByRole("row")).toHaveLength(3);
  });

  it("drops a page that arrives after the filters changed", async () => {
    let release!: (reply: Reply) => void;
    setup(page([ROWS[0]!], 9));
    replies.audit!.push(
      () => new Promise<Reply>((resolve) => (release = resolve)),
      page([ROWS[2]!]),
    );
    mount();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "Carica altri" }));
    fireEvent.change(screen.getByLabelText("Azione"), {
      target: { value: "script.create_tenant" },
    });
    await waitFor(() => expect(auditCalls()).toHaveLength(3));
    await act(async () => release(page([ROWS[1]!])));
    expect(
      within(screen.getByTestId("audit-table")).queryByText("Accesso alla console"),
    ).toBeNull();
  });
});

describe("Registro: states", () => {
  it("shows «Caricamento…» while the first page is open", () => {
    replies[ME] = [ok(meReply())];
    replies[TENANTS] = [ok({ tenants: TENANT_LIST })];
    replies.audit = ["pending"];
    mount();
    expect(screen.getByText("Caricamento…")).toBeTruthy();
  });

  it("a failed read shows «Non riesco a leggere il registro.» and «Riprova» reads again", async () => {
    setup(fail(400, "invalid_request"));
    replies.audit!.push(page());
    mount();
    expect(await screen.findByText("Non riesco a leggere il registro.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await table();
    expect(auditCalls()).toEqual([FIRST, FIRST]);
  });

  it("«Riprova» keeps focus through a retry that fails again, and through one that succeeds", async () => {
    setup(fail(400, "invalid_request"));
    mount();
    await screen.findByText("Non riesco a leggere il registro.");
    const first = pressRetryHolding(apiJson);
    expect(screen.getByText("Non riesco a leggere il registro.")).toBeTruthy();
    await first.answer(fail(400, "invalid_request"));
    expectSameFocusedButton(first.button);
    const second = pressRetryHolding(apiJson);
    await second.answer(page());
    expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
    await table();
  });

  it("«Riprova» after console_unavailable posts /api/platform/console again", async () => {
    sessionStorage.setItem("costi.console.switching", "1");
    replies[ME] = [fail(409, "console_selection_required")];
    replies[TENANTS] = [fail(409, "console_selection_required")];
    replies.audit = [fail(409, "console_selection_required")];
    mount();
    expect(await screen.findByText("La console non risponde. Riprova tra poco.")).toBeTruthy();
    expect(calls.filter((c) => c.path === MODE)).toHaveLength(0);
    replies.audit = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await waitFor(() => expect(calls.filter((c) => c.path === MODE)).toHaveLength(1));
  });

  it("keeps «Caricamento…» and no error while the page is being left", async () => {
    replies[ME] = [fail(409, "console_selection_required")];
    replies[TENANTS] = [fail(409, "console_selection_required")];
    replies.audit = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    mount();
    await waitFor(() => expect(calls.filter((c) => c.path === MODE)).toHaveLength(1));
    expect(screen.getByText("Caricamento…")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
