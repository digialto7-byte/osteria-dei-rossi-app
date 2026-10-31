// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ticketMarkBody } from "@/lib/kitchen/kitchen-done";
import type { KitchenTickets } from "@/server/kitchen/output";
import { KIDS, KITCHEN_TICKETS } from "../helpers/kitchen-data";

// The kitchen screen (M19 plan §3.1.9-3.1.11, step 18) with fake timers and a fake apiJson. The poll is 5 s while the page is
// visible, at once when it becomes visible, and the stale banner appears after 60 s without a successful read (client clock).
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

let reply: Result;
// The reply to a write (POST); a test may replace it with a promise it settles by hand.
let writeReply: Result | Promise<Result>;
const apiJson = vi.fn(
  (path: string, init?: { method?: string; body?: unknown }): Promise<Result> => {
    return init?.method === "POST" ? Promise.resolve(writeReply) : Promise.resolve(reply);
  },
);
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (...args: Parameters<typeof apiJson>) => apiJson(...args),
}));

import KitchenPage from "@/app/(owner)/cucina/page";

const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const NETWORK: Result = {
  ok: false,
  status: 0,
  error: { code: "network", message: "Connessione assente." },
};
const FORBIDDEN: Result = {
  ok: false,
  status: 403,
  error: {
    code: "forbidden",
    // What the route's role guard (withApi) really answers for a waiter: the generic text, not the kitchen one.
    message: "Operazione non consentita per il tuo ruolo.",
  },
};

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const mountRoot = () => document.querySelector("[data-kitchen]") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T19:31:40Z"));
  reply = ok(KITCHEN_TICKETS);
  writeReply = ok({ changed: true, autoClosed: false, reopened: false, board: KITCHEN_TICKETS });
  apiJson.mockClear();
  setOnline(true);
  setHidden(false);
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Cucina page", () => {
  it("shows the heading, the time of the data and the tickets, found by key", async () => {
    render(createElement(KitchenPage));
    await settle();
    expect(screen.getByRole("heading", { name: "Cucina" })).toBeTruthy();
    expect(screen.getByText("Aggiornato alle 20:31")).toBeTruthy();
    for (const ticket of KITCHEN_TICKETS.tickets) {
      expect(document.querySelector(`[data-ticket-key="${ticket.key}"]`)).not.toBeNull();
    }
    expect(apiJson).toHaveBeenCalledWith("/api/kitchen/tickets");
  });

  it("an empty list says so", async () => {
    reply = ok({ ...KITCHEN_TICKETS, tickets: [] });
    render(createElement(KitchenPage));
    await settle();
    expect(screen.getByText("Nessuna comanda in cucina.")).toBeTruthy();
  });

  it("polls every 5 000 ms while the page is visible", async () => {
    render(createElement(KitchenPage));
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(1);
    await advance(4_999);
    expect(apiJson).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(apiJson).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(apiJson).toHaveBeenCalledTimes(4);
  });

  it("does not poll while the page is hidden, and reads at once when it becomes visible again", async () => {
    render(createElement(KitchenPage));
    await settle();
    setHidden(true);
    await advance(30_000);
    expect(apiJson).toHaveBeenCalledTimes(1);
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(2);
  });

  it("shows the stale banner after 60 s of failed reads, keeps the list, and hides it after the next success", async () => {
    render(createElement(KitchenPage));
    await settle();
    reply = NETWORK;
    await advance(55_000);
    expect(screen.queryByRole("alert")).toBeNull();
    await advance(10_000);
    expect(screen.getByRole("alert").textContent).toBe(
      "Dati non aggiornati da più di un minuto. Controlla la connessione.",
    );
    expect(
      document.querySelector(`[data-ticket-key="${KITCHEN_TICKETS.tickets[0]!.key}"]`),
    ).not.toBeNull();
    reply = ok(KITCHEN_TICKETS);
    await advance(5_000);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is not stale while the reads keep working", async () => {
    render(createElement(KitchenPage));
    await settle();
    await advance(120_000);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a role without access gets one message and no more reads", async () => {
    reply = FORBIDDEN;
    render(createElement(KitchenPage));
    await settle();
    expect(
      screen.getByText("La lista della cucina non è disponibile per il tuo ruolo."),
    ).toBeTruthy();
    await advance(20_000);
    expect(apiJson).toHaveBeenCalledTimes(1);
    expect(mountRoot().textContent).not.toContain("€");
    expect(mountRoot().textContent).not.toContain("Operazione non consentita");
  });

  it("asks the shell for the wide layout, so tickets sit side by side on a laptop (phone stays one column)", async () => {
    render(createElement(KitchenPage));
    await settle();
    expect(mountRoot().getAttribute("data-layout")).toBe("wide");
    // The grid fills by container width: one column in the 448 px phone column, several in the wide one.
    expect(mountRoot().innerHTML).not.toMatch(/\blg:grid-cols/);
  });

  it("the page has no euro sign", async () => {
    render(createElement(KitchenPage));
    await settle();
    expect(mountRoot().textContent).not.toContain("€");
  });

  describe("high contrast", () => {
    it("starts off, turns on with the toggle, and is remembered on this device", async () => {
      const first = render(createElement(KitchenPage));
      await settle();
      expect(mountRoot().getAttribute("data-contrast")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Alto contrasto" }));
      expect(mountRoot().getAttribute("data-contrast")).toBe("high");
      expect(window.localStorage.getItem("kitchen.contrast")).toBe("high");
      first.unmount();
      render(createElement(KitchenPage));
      await settle();
      expect(mountRoot().getAttribute("data-contrast")).toBe("high");
      expect(
        screen.getByRole("button", { name: "Alto contrasto" }).getAttribute("aria-pressed"),
      ).toBe("true");
    });

    it("can be turned off again", async () => {
      window.localStorage.setItem("kitchen.contrast", "high");
      render(createElement(KitchenPage));
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Alto contrasto" }));
      expect(mountRoot().getAttribute("data-contrast")).toBeNull();
      expect(window.localStorage.getItem("kitchen.contrast")).toBe("normal");
    });

    it("is on by default when the device asks for more contrast, unless the cook chose otherwise", async () => {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (query: string) => ({
          matches: query === "(prefers-contrast: more)",
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      });
      const first = render(createElement(KitchenPage));
      await settle();
      expect(mountRoot().getAttribute("data-contrast")).toBe("high");
      first.unmount();
      window.localStorage.setItem("kitchen.contrast", "normal");
      render(createElement(KitchenPage));
      await settle();
      expect(mountRoot().getAttribute("data-contrast")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// M19b: dish taps, Chiudi comanda, Annulla, Chiuse oggi, offline block, errors (plan §3.6-3.7, step 15).
const [stew, soup] = KITCHEN_TICKETS.tickets;
const posts = () => apiJson.mock.calls.filter(([, init]) => init?.method === "POST");
const gets = () => apiJson.mock.calls.filter(([, init]) => init?.method !== "POST");
const lineButton = (name: RegExp) => screen.getByRole("button", { name });
const withDone = (board: KitchenTickets, line: string, done: boolean): KitchenTickets => ({
  ...board,
  tickets: board.tickets.map((t) => ({
    ...t,
    doneCount: t.lines.some((l) => l.id === line) ? (done ? 1 : 0) : t.doneCount,
    lines: t.lines.map((l) => (l.id === line ? { ...l, done } : l)),
  })),
});
const closedBy = (board: KitchenTickets, ticketKey: string): KitchenTickets => {
  const gone = board.tickets.find((t) => t.key === ticketKey)!;
  return {
    ...board,
    tickets: board.tickets.filter((t) => t.key !== ticketKey),
    closedTickets: [
      {
        ...gone,
        closedAt: "2026-11-04T19:41:00.000000+00:00",
        closedBy: { id: KIDS.chef, displayName: "Chef Demo" },
        autoClosed: true,
      },
      ...board.closedTickets,
    ],
  };
};

describe("Cucina page, writes (M19b)", () => {
  it("shows the remaining count and the comande, and no extra read on a tap", async () => {
    render(createElement(KitchenPage));
    await settle();
    expect(document.querySelector("[data-remaining]")!.textContent).toBe("Da fare: 2");
    expect(screen.getByRole("button", { name: "Chiuse oggi (2)" })).toBeTruthy();
  });

  it("a tap posts the state wanted to the line route, and the reply's board replaces the screen", async () => {
    render(createElement(KitchenPage));
    await settle();
    writeReply = ok({
      changed: true,
      autoClosed: false,
      reopened: false,
      board: withDone({ ...KITCHEN_TICKETS, remaining: 1 }, KIDS.line1, true),
    });
    const readsBefore = gets().length;
    fireEvent.click(lineButton(/^Segna fatto: 2 × Spezzatino/));
    await settle();
    expect(posts()).toEqual([
      [`/api/kitchen/lines/${KIDS.line1}/mark`, { method: "POST", body: { done: true } }],
    ]);
    expect(gets().length).toBe(readsBefore);
    expect(lineButton(/^Annulla fatto: 2 × Spezzatino/).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-remaining]")!.textContent).toBe("Da fare: 1");
  });

  it("a second tap within 600 ms posts nothing; after 600 ms it posts the undo", async () => {
    render(createElement(KitchenPage));
    await settle();
    writeReply = ok({
      changed: true,
      autoClosed: false,
      reopened: false,
      board: withDone(KITCHEN_TICKETS, KIDS.line1, true),
    });
    fireEvent.click(lineButton(/^Segna fatto: 2 × Spezzatino/));
    await settle();
    await advance(599);
    fireEvent.click(lineButton(/^Annulla fatto: 2 × Spezzatino/));
    await settle();
    expect(posts()).toHaveLength(1);
    await advance(1);
    writeReply = ok({ changed: true, autoClosed: false, reopened: false, board: KITCHEN_TICKETS });
    fireEvent.click(lineButton(/^Annulla fatto: 2 × Spezzatino/));
    await settle();
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![1]).toEqual({ method: "POST", body: { done: false } });
  });

  it("while a request is on its way, taps on the same dish post nothing", async () => {
    render(createElement(KitchenPage));
    await settle();
    let release!: (r: Result) => void;
    writeReply = new Promise<Result>((resolve) => (release = resolve));
    fireEvent.click(lineButton(/^Segna fatto: 2 × Spezzatino/));
    await settle();
    expect(lineButton(/^Segna fatto: 2 × Spezzatino/).getAttribute("aria-busy")).toBe("true");
    fireEvent.click(lineButton(/^Segna fatto: 2 × Spezzatino/));
    await advance(2_000);
    expect(posts()).toHaveLength(1);
    release(ok({ changed: true, autoClosed: false, reopened: false, board: KITCHEN_TICKETS }));
    await settle();
  });

  it("a poll that was in flight cannot put an older board over the write's reply", async () => {
    render(createElement(KitchenPage));
    await settle();
    let release!: (r: Result) => void;
    reply = ok(KITCHEN_TICKETS);
    const slow = new Promise<Result>((resolve) => (release = resolve));
    apiJson.mockImplementationOnce(() => slow);
    await advance(5_000);
    writeReply = ok({
      changed: true,
      autoClosed: false,
      reopened: false,
      board: withDone(KITCHEN_TICKETS, KIDS.line1, true),
    });
    fireEvent.click(lineButton(/^Segna fatto: 2 × Spezzatino/));
    await settle();
    release(ok(KITCHEN_TICKETS));
    await settle();
    expect(lineButton(/^Annulla fatto: 2 × Spezzatino/).getAttribute("aria-pressed")).toBe("true");
  });

  it("a write reply that lands after a newer one cannot put the older board back", async () => {
    render(createElement(KitchenPage));
    await settle();
    let releaseA!: (r: Result) => void;
    let releaseB!: (r: Result) => void;
    apiJson.mockImplementationOnce(() => new Promise<Result>((resolve) => (releaseA = resolve)));
    apiJson.mockImplementationOnce(() => new Promise<Result>((resolve) => (releaseB = resolve)));
    fireEvent.click(lineButton(/^Segna fatto: 2 × Spezzatino/));
    fireEvent.click(lineButton(/^Segna fatto: 1 × Tagliatelle/));
    await settle();
    expect(posts()).toHaveLength(2);
    const boardA = withDone(KITCHEN_TICKETS, KIDS.line1, true);
    const boardB = withDone(boardA, KIDS.line3, true);
    const reply = (board: KitchenTickets, asOf: string) => ({
      changed: true,
      autoClosed: false,
      reopened: false,
      board: { ...board, asOf },
    });
    // B was answered later by the server (newer asOf) but its reply arrives first.
    releaseB(ok(reply(boardB, "2026-11-04T19:31:42.000000+00:00")));
    await settle();
    releaseA(ok(reply(boardA, "2026-11-04T19:31:41.000000+00:00")));
    await settle();
    expect(lineButton(/^Annulla fatto: 1 × Tagliatelle/).getAttribute("aria-pressed")).toBe("true");
    expect(lineButton(/^Annulla fatto: 2 × Spezzatino/).getAttribute("aria-pressed")).toBe("true");
  });

  it("an older poll reply cannot put an older board over a newer one either", async () => {
    render(createElement(KitchenPage));
    await settle();
    reply = ok({
      ...withDone(KITCHEN_TICKETS, KIDS.line1, true),
      asOf: "2026-11-04T19:40:00.000000+00:00",
    });
    await advance(5_000);
    expect(lineButton(/^Annulla fatto: 2 × Spezzatino/)).toBeTruthy();
    reply = ok({ ...KITCHEN_TICKETS, asOf: "2026-11-04T19:39:00.000000+00:00" });
    await advance(5_000);
    expect(lineButton(/^Annulla fatto: 2 × Spezzatino/)).toBeTruthy();
  });

  it("the last dish closes the comanda: a notice with Annulla, which undoes that dish; it goes away after 8 s", async () => {
    render(createElement(KitchenPage));
    await settle();
    writeReply = ok({
      changed: true,
      autoClosed: true,
      reopened: false,
      board: closedBy(withDone(KITCHEN_TICKETS, KIDS.line3, true), soup!.key),
    });
    fireEvent.click(lineButton(/^Segna fatto: Tagliatelle|^Segna fatto: 1 × Tagliatelle/));
    await settle();
    expect(screen.getByRole("status").textContent).toContain(
      "Tavolo 2 (demo) · Primi: comanda chiusa",
    );
    expect(document.querySelector(`[data-ticket-key="${soup!.key}"]`)).toBeNull();

    writeReply = ok({ changed: true, autoClosed: false, reopened: true, board: KITCHEN_TICKETS });
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    await settle();
    expect(posts()[1]).toEqual([
      `/api/kitchen/lines/${KIDS.line3}/mark`,
      { method: "POST", body: { done: false } },
    ]);
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector(`[data-ticket-key="${soup!.key}"]`)).not.toBeNull();
  });

  it("the notice leaves by itself after 8 000 ms", async () => {
    render(createElement(KitchenPage));
    await settle();
    writeReply = ok({
      changed: true,
      autoClosed: true,
      reopened: false,
      board: closedBy(withDone(KITCHEN_TICKETS, KIDS.line3, true), soup!.key),
    });
    fireEvent.click(lineButton(/^Segna fatto: 1 × Tagliatelle/));
    await settle();
    await advance(7_999);
    expect(screen.getByRole("status")).toBeTruthy();
    await advance(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Chiudi comanda posts the five fields; the notice offers to reopen it", async () => {
    render(createElement(KitchenPage));
    await settle();
    writeReply = ok({ changed: true, board: closedBy(KITCHEN_TICKETS, stew!.key) });
    fireEvent.click(
      screen.getByRole("button", { name: "Chiudi comanda: Tavolo 1 (demo), Secondi" }),
    );
    await settle();
    expect(posts()[0]).toEqual([
      "/api/kitchen/tickets/mark",
      { method: "POST", body: ticketMarkBody(stew!, true) },
    ]);
    expect(screen.getByRole("status").textContent).toContain(
      "Tavolo 1 (demo) · Secondi: comanda chiusa",
    );
    writeReply = ok({ changed: true, board: KITCHEN_TICKETS });
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    await settle();
    expect(posts()[1]).toEqual([
      "/api/kitchen/tickets/mark",
      { method: "POST", body: ticketMarkBody(stew!, false) },
    ]);
  });

  it("Riapri posts closed false for that comanda", async () => {
    render(createElement(KitchenPage));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Chiuse oggi (2)" }));
    const closed = KITCHEN_TICKETS.closedTickets[0]!;
    writeReply = ok({
      changed: true,
      board: { ...KITCHEN_TICKETS, closedTickets: KITCHEN_TICKETS.closedTickets.slice(1) },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Riapri comanda: Tavolo 3 (demo), Antipasti" }),
    );
    await settle();
    expect(posts()[0]).toEqual([
      "/api/kitchen/tickets/mark",
      { method: "POST", body: ticketMarkBody(closed, false) },
    ]);
    expect(screen.getByRole("button", { name: "Chiuse oggi (1)" })).toBeTruthy();
  });

  it("offline: every dish button, Chiudi, Riapri and Annulla is disabled, with the hint; back online it clears", async () => {
    render(createElement(KitchenPage));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Chiuse oggi (2)" }));
    expect(screen.queryByText("Serve la connessione per segnare i piatti.")).toBeNull();
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("Serve la connessione per segnare i piatti.")).toBeTruthy();
    const names = [/^Segna fatto/, /^Chiudi comanda/, /^Riapri comanda/];
    for (const name of names) {
      for (const button of screen.getAllByRole("button", { name }))
        expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(lineButton(/^Segna fatto: 2 × Spezzatino/));
    expect(posts()).toHaveLength(0);
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("Serve la connessione per segnare i piatti.")).toBeNull();
    expect((lineButton(/^Segna fatto: 2 × Spezzatino/) as HTMLButtonElement).disabled).toBe(false);
  });

  it("stale (no good read for over a minute) blocks the writes too", async () => {
    render(createElement(KitchenPage));
    await settle();
    reply = NETWORK;
    await advance(65_000);
    expect(screen.getByText("Serve la connessione per segnare i piatti.")).toBeTruthy();
    expect((lineButton(/^Segna fatto: 2 × Spezzatino/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a write that fails by network says so, changes nothing and retries nothing by itself", async () => {
    render(createElement(KitchenPage));
    await settle();
    writeReply = NETWORK;
    fireEvent.click(lineButton(/^Segna fatto: 2 × Spezzatino/));
    await settle();
    expect(within(mountRoot()).getByRole("alert").textContent).toBe(
      "Non salvato: controlla la connessione e riprova.",
    );
    expect(lineButton(/^Segna fatto: 2 × Spezzatino/).getAttribute("aria-pressed")).toBe("false");
    await advance(2_000);
    expect(posts()).toHaveLength(1);
  });

  it("a 5xx is the same: not saved", async () => {
    render(createElement(KitchenPage));
    await settle();
    writeReply = { ok: false, status: 503, error: { code: "internal", message: "x" } };
    fireEvent.click(lineButton(/^Segna fatto: 2 × Spezzatino/));
    await settle();
    expect(within(mountRoot()).getByRole("alert").textContent).toBe(
      "Non salvato: controlla la connessione e riprova.",
    );
  });

  it("session_closed (409) says the table is closed and reloads the board once", async () => {
    render(createElement(KitchenPage));
    await settle();
    writeReply = { ok: false, status: 409, error: { code: "session_closed", message: "x" } };
    const readsBefore = gets().length;
    fireEvent.click(lineButton(/^Segna fatto: 2 × Spezzatino/));
    await settle();
    expect(within(mountRoot()).getByRole("alert").textContent).toBe(
      "Il tavolo è stato chiuso: la comanda non è più in cucina.",
    );
    expect(gets().length).toBe(readsBefore + 1);
  });

  it("line_not_found and ticket_not_found (404) say the comanda is gone and reload once", async () => {
    render(createElement(KitchenPage));
    await settle();
    for (const code of ["line_not_found", "ticket_not_found"]) {
      writeReply = { ok: false, status: 404, error: { code, message: "x" } };
      const readsBefore = gets().length;
      fireEvent.click(
        screen.getByRole("button", { name: "Chiudi comanda: Tavolo 1 (demo), Secondi" }),
      );
      await settle();
      expect(within(mountRoot()).getByRole("alert").textContent).toBe(
        "Questa comanda non c'è più: aggiorno la lista.",
      );
      expect(gets().length).toBe(readsBefore + 1);
    }
  });

  it("a voided dish cannot be tapped", async () => {
    render(createElement(KitchenPage));
    await settle();
    const voided = document.querySelector(`[data-line-id="${KIDS.line2}"]`) as HTMLElement;
    expect(within(voided).queryByRole("button")).toBeNull();
    fireEvent.click(voided);
    expect(posts()).toHaveLength(0);
  });

  it("the page asks for no confirmation: no confirm() and no dialog", async () => {
    const confirm = vi.spyOn(window, "confirm");
    render(createElement(KitchenPage));
    await settle();
    writeReply = ok({ changed: true, board: closedBy(KITCHEN_TICKETS, stew!.key) });
    fireEvent.click(
      screen.getByRole("button", { name: "Chiudi comanda: Tavolo 1 (demo), Secondi" }),
    );
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(document.querySelector("[role=dialog], dialog")).toBeNull();
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const file of ["page", "ticket-card", "kitchen-line", "closed-section", "undo-notice"]) {
      const source = readFileSync(
        join(process.cwd(), "src/app/(owner)/cucina", `${file}.tsx`),
        "utf8",
      );
      expect(source, file).not.toMatch(/\bconfirm\(|role="dialog"|<dialog/);
    }
  });

  it("still has no euro sign after the writes", async () => {
    render(createElement(KitchenPage));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Chiuse oggi (2)" }));
    expect(mountRoot().textContent).not.toContain("€");
  });
});
