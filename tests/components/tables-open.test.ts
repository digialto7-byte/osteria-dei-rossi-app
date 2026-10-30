// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDS, TABLES_LIST } from "../helpers/menu-tables-data";

// UX plan B8 (P1-6, E6, P6): opening a table goes straight to its comanda, and the card that a tap on a tile opens is
// brought into view with focus on its heading.
type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

let listReply: Result;
let writeReply: Result;
const calls: Array<{ path: string; init: Init }> = [];
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (path === "/api/me") {
    return Promise.resolve({ ok: true, status: 200, data: { user: { role: "waiter" } } });
  }
  if (init?.method) return Promise.resolve(writeReply);
  if (path === "/api/tables") return Promise.resolve(listReply);
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push }) }));

vi.mock("@/pwa/use-outbox", async () => (await import("../helpers/sync-runtime")).useOutboxMock());

import TablesPage from "@/app/(owner)/tavoli/page";
import { resetMe } from "@/components/use-me";
import { bridge, startRuntime, stopRuntime } from "../helpers/sync-runtime";

const scrollIntoView = vi.fn();
beforeEach(async () => {
  resetMe();
  await startRuntime();
  listReply = { ok: true, status: 200, data: TABLES_LIST };
  writeReply = { ok: true, status: 201, data: {} };
  calls.length = 0;
  apiJson.mockClear();
  push.mockClear();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  cleanup();
  stopRuntime();
});

const tile = (id: string) => document.querySelector(`[data-table-id="${id}"]`) as HTMLElement;
const reads = () => calls.filter((call) => call.path === "/api/tables" && !call.init);
const writes = () => calls.filter((call) => call.init?.method);

async function openFreeTable() {
  render(createElement(TablesPage));
  await waitFor(() => expect(tile(IDS.table2)).not.toBeNull());
  fireEvent.click(tile(IDS.table2));
  return screen.findByRole("button", { name: "Apri tavolo" });
}

describe("opening a table", () => {
  it("queues the opening and goes to the comanda of the session the dialog made, in one step", async () => {
    const submit = await openFreeTable();
    fireEvent.change(screen.getByLabelText("Coperti"), { target: { value: "4" } });
    fireEvent.click(submit);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const [op] = await bridge.runtime!.outbox.pending();
    const sent = op!.payload as { tableId: string; sessionId: string; covers: number };
    expect(sent).toMatchObject({ tableId: IDS.table2, covers: 4 });
    expect(push).toHaveBeenCalledWith(`/tavoli/comanda?s=${sent.sessionId}`);
    expect(writes()).toHaveLength(0);
  });

  it("does not read the list again: the page is being left", async () => {
    fireEvent.click(await openFreeTable());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(reads()).toHaveLength(1);
  });

  it("offline, the comanda is loaded in full (the client router cannot fetch it) and the client router is not used", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, configurable: true });
    fireEvent.click(await openFreeTable());
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const [op] = await bridge.runtime!.outbox.pending();
    expect(assign).toHaveBeenCalledWith(
      `/tavoli/comanda?s=${(op!.payload as { sessionId: string }).sessionId}`,
    );
    expect(push).not.toHaveBeenCalled();
    online.mockRestore();
  });

  it("a queue that cannot store the opening stays on the dialog with a message and does not navigate", async () => {
    vi.spyOn(bridge.runtime!.queue, "queueOpenTable").mockRejectedValueOnce(
      new Error("storage refused"),
    );
    fireEvent.click(await openFreeTable());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Qualcosa è andato storto. Riprova tra poco.",
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apri tavolo" })).toBeTruthy();
  });
});

describe("the card a tap on a tile opens", () => {
  it("scrolls into view and takes focus on its heading (a free table)", async () => {
    await openFreeTable();
    const heading = screen.getByRole("heading", { name: "Apri Tavolo 2 (demo)" });
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("does the same for an open table's panel", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    fireEvent.click(tile(IDS.table1));
    const heading = await screen.findByRole("heading", { name: "Tavolo 1 (demo)", level: 2 });
    expect(document.activeElement).toBe(heading);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("moves again when another tile is tapped", async () => {
    await openFreeTable();
    scrollIntoView.mockClear();
    fireEvent.click(tile(IDS.table1));
    const heading = await screen.findByRole("heading", { name: "Tavolo 1 (demo)", level: 2 });
    expect(document.activeElement).toBe(heading);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
