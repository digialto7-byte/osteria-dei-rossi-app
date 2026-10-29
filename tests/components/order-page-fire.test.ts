// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MENU } from "../helpers/order-components";
import { LINE_SOUP, LINE_STEW, OIDS, ORDER_VIEW } from "../helpers/orders-data";

// The send and void wiring of the Comanda page (M19 plan §3.6, step 17). The page reads /api/*; here apiJson is a fake that
// answers the reads and records the writes.
type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

let viewReply: Result;
let fireReply: Result | (() => Promise<Result>);
let voidReply: Result;
const calls: Array<{ path: string; init: Init }> = [];
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const failure = (status: number, code: string, message: string, details?: unknown): Result => ({
  ok: false,
  status,
  error: { code, message, details },
});
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (path === "/api/menu") return Promise.resolve(ok(MENU));
  if (path === `/api/table-sessions/${OIDS.session}/lines`) return Promise.resolve(viewReply);
  if (path === `/api/table-sessions/${OIDS.session}/fire`) {
    return typeof fireReply === "function" ? fireReply() : Promise.resolve(fireReply);
  }
  if (path.endsWith("/void")) return Promise.resolve(voidReply);
  return Promise.resolve(failure(404, "not_found", "x"));
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(`s=${OIDS.session}`),
}));

import OrderPage from "@/app/(owner)/tavoli/comanda/page";

const FIRED_STEW = { ...LINE_STEW, state: "fired" as const };
const FIRED_SOUP = { ...LINE_SOUP, state: "fired" as const };

beforeEach(() => {
  viewReply = ok(ORDER_VIEW);
  fireReply = ok({ lines: [FIRED_STEW], fired: [LINE_STEW.id], skipped: [] });
  voidReply = ok({ changed: true, line: { ...FIRED_STEW, state: "voided" } });
  calls.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const writes = () => calls.filter((c) => c.init?.method);
const reads = (path: string) => calls.filter((c) => c.path === path && !c.init?.method);
const open = async () => {
  render(createElement(OrderPage));
  await screen.findByRole("heading", { name: "Tavolo 1 (demo)" });
  await waitFor(() => expect(document.querySelector("[data-menu-item-id]")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: /^Comanda/ }));
};
const row = (id: string) => document.querySelector(`[data-line-id="${id}"]`) as HTMLElement;
const sendStew = () =>
  fireEvent.click(screen.getByRole("button", { name: "Invia in cucina: Secondi, 1 piatto" }));

describe("sending a course", () => {
  it("posts exactly the ids of the group's confirmed drafts, and replaces the lines with the reply's", async () => {
    await open();
    sendStew();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.path).toBe(`/api/table-sessions/${OIDS.session}/fire`);
    expect(writes()[0]!.init).toEqual({ method: "POST", body: { lineIds: [LINE_STEW.id] } });
    await waitFor(() => expect(within(row(LINE_STEW.id)).getByText("In cucina")).toBeTruthy());
    expect(within(row(LINE_STEW.id)).getByRole("button", { name: /^Storna/ })).toBeTruthy();
    // The soup is a draft of another course and stays editable.
    expect(within(row(LINE_SOUP.id)).getByRole("button", { name: /^Modifica/ })).toBeTruthy();
  });

  describe("more than 50 confirmed drafts in one course (review fix)", () => {
    const manyIds = Array.from(
      { length: 51 },
      (_, i) => `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const manyView = () =>
      ok({
        ...(ORDER_VIEW as { lines: unknown[] }),
        lines: manyIds.map((id) => ({ ...LINE_STEW, id })),
      });
    const sendMany = () =>
      fireEvent.click(screen.getByRole("button", { name: /^Invia in cucina: Secondi, 51/ }));

    it("sends them in sequential calls of at most 50 ids, in order, and merges every reply", async () => {
      viewReply = manyView();
      fireReply = () => {
        const last = writes().length;
        const ids = (writes()[last - 1]!.init!.body as { lineIds: string[] }).lineIds;
        return Promise.resolve(
          ok({ lines: ids.map((id) => ({ ...FIRED_STEW, id })), fired: ids, skipped: [] }),
        );
      };
      await open();
      sendMany();
      await waitFor(() => expect(writes()).toHaveLength(2));
      const bodies = writes().map((w) => (w.init!.body as { lineIds: string[] }).lineIds);
      expect(bodies.map((b) => b.length)).toEqual([50, 1]);
      expect(bodies.flat()).toEqual(manyIds);
      await waitFor(() => expect(within(row(manyIds[50]!)).getByText("In cucina")).toBeTruthy());
      expect(within(row(manyIds[0]!)).getByText("In cucina")).toBeTruthy();
    });

    it("stops at the first refused call and shows its message; nothing more is sent", async () => {
      viewReply = manyView();
      fireReply = failure(409, "session_closed", "Il tavolo è stato chiuso.");
      await open();
      sendMany();
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("Il tavolo è stato chiuso.");
      expect(writes()).toHaveLength(1);
    });
  });

  it("the segue button sends the segue line alone", async () => {
    fireReply = ok({ lines: [FIRED_SOUP], fired: [LINE_SOUP.id], skipped: [] });
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "Invia in cucina: Primi a seguire, 1 piatto" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.init!.body).toEqual({ lineIds: [LINE_SOUP.id] });
  });

  it("says 'Invio…' until the reply and sends once, however often the button is pressed", async () => {
    let release!: (value: Result) => void;
    fireReply = () => new Promise<Result>((resolve) => (release = resolve));
    await open();
    sendStew();
    expect(await screen.findAllByText("Invio…")).toHaveLength(1);
    for (const button of screen.getAllByRole("button", { name: /^Invia in cucina/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    await act(async () => {
      release(ok({ lines: [FIRED_STEW], fired: [LINE_STEW.id], skipped: [] }));
    });
    await waitFor(() => expect(screen.queryByText("Invio…")).toBeNull());
    expect(writes()).toHaveLength(1);
  });

  it("tells the waiter what the server skipped", async () => {
    fireReply = ok({
      lines: [FIRED_STEW],
      fired: [],
      skipped: [{ lineId: LINE_STEW.id, reason: "already_fired" }],
    });
    await open();
    sendStew();
    const note = await screen.findByRole("status");
    expect(note.textContent).toBe("1 piatto era già in cucina");
  });

  it("session_closed shows the closed-table message", async () => {
    fireReply = failure(409, "session_closed", "Il tavolo è stato chiuso.");
    await open();
    sendStew();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Il tavolo è stato chiuso.");
  });

  it("a line that is no longer on this table reloads the order", async () => {
    fireReply = failure(404, "not_found", "Riga non trovata.");
    await open();
    sendStew();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Una riga non è più su questo tavolo: ricarico la comanda.");
    await waitFor(() => expect(reads(`/api/table-sessions/${OIDS.session}/lines`)).toHaveLength(2));
  });

  it("the markup has no cost, margin or food cost", async () => {
    await open();
    sendStew();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(document.body.textContent).not.toMatch(/Costo|Margine|Food cost/);
  });
});

describe("voiding a sent line", () => {
  const openDialog = async () => {
    viewReply = ok({ ...ORDER_VIEW, lines: [FIRED_STEW, LINE_SOUP] });
    await open();
    fireEvent.click(within(row(LINE_STEW.id)).getByRole("button", { name: /^Storna/ }));
  };
  const choose = (reason: string) =>
    fireEvent.change(screen.getByRole("combobox", { name: /^Motivo/ }), {
      target: { value: reason },
    });

  it("opens the dialog in place and posts {reason, clientUpdatedAt}", async () => {
    await openDialog();
    expect(within(row(LINE_STEW.id)).getByRole("combobox", { name: /^Motivo/ })).toBeTruthy();
    choose("kitchen_error");
    fireEvent.click(screen.getByRole("button", { name: "Storna piatto" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.path).toBe(`/api/order-lines/${LINE_STEW.id}/void`);
    expect(writes()[0]!.init!.body).toEqual({
      reason: "kitchen_error",
      clientUpdatedAt: expect.stringMatching(/Z$/),
    });
    await waitFor(() => expect(within(row(LINE_STEW.id)).getByText("Stornato")).toBeTruthy());
    expect(screen.queryByRole("combobox", { name: /^Motivo/ })).toBeNull();
  });

  it("'Annulla' closes the dialog without a request", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByRole("combobox", { name: /^Motivo/ })).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("a conflict shows M18's note, naming the colleague, with the line as it is", async () => {
    voidReply = failure(409, "conflict", "x", {
      reason: "voided",
      line: {
        ...FIRED_STEW,
        state: "voided",
        updatedBy: { id: OIDS.waiterB, displayName: "Cameriere Due Demo" },
      },
    });
    await openDialog();
    choose("comp");
    fireEvent.click(screen.getByRole("button", { name: "Storna piatto" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Questa riga è stata tolta.");
    expect(within(row(LINE_STEW.id)).getByText("Stornato")).toBeTruthy();
  });

  it("a stale conflict names who changed the line", async () => {
    voidReply = failure(409, "conflict", "x", {
      reason: "stale",
      line: {
        ...FIRED_STEW,
        updatedBy: { id: OIDS.waiterB, displayName: "Cameriere Due Demo" },
      },
    });
    await openDialog();
    choose("comp");
    fireEvent.click(screen.getByRole("button", { name: "Storna piatto" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Cameriere Due Demo");
  });

  it("void_reason_invalid says to choose a valid reason", async () => {
    voidReply = failure(422, "void_reason_invalid", "Scegli un motivo valido.");
    await openDialog();
    choose("comp");
    fireEvent.click(screen.getByRole("button", { name: "Storna piatto" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Scegli un motivo valido.");
  });
});
