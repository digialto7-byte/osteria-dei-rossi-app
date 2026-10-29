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

import TablesPage from "@/app/(owner)/tavoli/page";
import { resetMe } from "@/components/use-me";

const scrollIntoView = vi.fn();
beforeEach(() => {
  resetMe();
  listReply = { ok: true, status: 200, data: TABLES_LIST };
  writeReply = { ok: true, status: 201, data: {} };
  calls.length = 0;
  apiJson.mockClear();
  push.mockClear();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(cleanup);

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
  it("goes to the comanda of the session the dialog made, in one step", async () => {
    const submit = await openFreeTable();
    fireEvent.change(screen.getByLabelText("Coperti"), { target: { value: "4" } });
    fireEvent.click(submit);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const sent = writes()[0]!.init!.body as { sessionId: string; covers: number };
    expect(sent.covers).toBe(4);
    expect(push).toHaveBeenCalledWith(`/tavoli/comanda?s=${sent.sessionId}`);
    expect(writes()[0]!.path).toBe(`/api/tables/${IDS.table2}/open`);
  });

  it("does not read the list again: the page is being left", async () => {
    fireEvent.click(await openFreeTable());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(reads()).toHaveLength(1);
  });

  it("table_already_open: stays, shows the server's words, closes the dialog and reads again", async () => {
    writeReply = {
      ok: false,
      status: 409,
      error: {
        code: "table_already_open",
        message: "Il tavolo è già aperto da Cameriere Demo.",
        details: { session: TABLES_LIST.tables[0]!.session },
      },
    };
    fireEvent.click(await openFreeTable());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Il tavolo è già aperto da Cameriere Demo.",
    );
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Apri tavolo" })).toBeNull();
  });

  it("any other refusal: stays on the dialog with the message, no navigation", async () => {
    writeReply = {
      ok: false,
      status: 422,
      error: { code: "covers_invalid", message: "Coperti non validi." },
    };
    fireEvent.click(await openFreeTable());
    expect((await screen.findByRole("alert")).textContent).toBe("Coperti non validi.");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apri tavolo" })).toBeTruthy();
  });

  it("a lost reply keeps the session id, and the retry that succeeds goes to that session", async () => {
    writeReply = {
      ok: false,
      status: 0,
      error: { code: "network", message: "Connessione assente." },
    };
    const submit = await openFreeTable();
    fireEvent.click(submit);
    await screen.findByText("Connessione assente.");
    writeReply = { ok: true, status: 201, data: {} };
    fireEvent.click(screen.getByRole("button", { name: "Apri tavolo" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const ids = writes().map((w) => (w.init!.body as { sessionId: string }).sessionId);
    expect(new Set(ids).size).toBe(1);
    expect(push).toHaveBeenCalledWith(`/tavoli/comanda?s=${ids[0]}`);
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
