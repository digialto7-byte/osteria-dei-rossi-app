// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceMenu } from "@/server/menu/output";
import type { OrderView } from "@/server/orders/output";
import { MENU, PASTA_ITEM, SOUP_ITEM, STEW_ITEM } from "../helpers/order-components";
import { ADD_REPLY, LINE_STEW, OIDS, ORDER_VIEW, STEW } from "../helpers/orders-data";

type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

let menuReply: Result;
let viewReply: Result;
let postReply: Result | (() => Promise<Result>);
let patchReply: Result;
let removeReply: Result;
const calls: Array<{ path: string; init: Init }> = [];
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (path === "/api/menu") return Promise.resolve(menuReply);
  if (path === `/api/table-sessions/${OIDS.session}/lines`) {
    if (init?.method === "POST") {
      return typeof postReply === "function" ? postReply() : Promise.resolve(postReply);
    }
    return Promise.resolve(viewReply);
  }
  if (path.endsWith("/remove")) return Promise.resolve(removeReply);
  if (path.startsWith("/api/order-lines/")) return Promise.resolve(patchReply);
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(`s=${OIDS.session}`),
}));

import OrderPage from "@/app/(owner)/tavoli/comanda/page";

beforeEach(() => {
  menuReply = ok(MENU);
  viewReply = ok(ORDER_VIEW);
  postReply = ok(ADD_REPLY);
  patchReply = ok({ changed: true, line: LINE_STEW });
  removeReply = ok({ changed: true, line: { ...LINE_STEW, state: "voided" } });
  calls.length = 0;
  apiJson.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const writes = () => calls.filter((c) => c.init?.method);
const reads = (path: string) => calls.filter((c) => c.path === path && !c.init?.method);
const item = (id: string) =>
  document.querySelector(`[data-menu-item-id="${id}"]:not([data-pinned])`) as HTMLElement;
const open = async () => {
  render(createElement(OrderPage));
  await screen.findByRole("heading", { name: "Tavolo 1 (demo)" });
  await waitFor(() => expect(item(SOUP_ITEM.id)).not.toBeNull());
};
const openSheet = () => fireEvent.click(screen.getByRole("button", { name: /^Comanda/ }));

describe("Comanda page", () => {
  it("reads the menu and the order once each and shows the table, the covers and the status", async () => {
    await open();
    expect(reads("/api/menu")).toHaveLength(1);
    expect(reads(`/api/table-sessions/${OIDS.session}/lines`)).toHaveLength(1);
    expect(screen.getByText("4 coperti")).toBeTruthy();
    expect(screen.getByText("Aperto")).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Tavoli" }).getAttribute("href")).toBe("/tavoli");
  });

  it("the waiter's markup has no cost, margin, GP or food cost", async () => {
    await open();
    openSheet();
    expect(document.body.textContent).not.toMatch(/Costo|Margine|Food cost|\bGP\b/);
  });

  it("starts on the first course, with the pinned strip before the menu", async () => {
    await open();
    expect(screen.getByRole("tab", { name: /^Antipasti/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    const first = document.querySelector("[data-menu-item-id]") as HTMLElement;
    expect(first.getAttribute("data-pinned")).toBe("true");
    expect(first.getAttribute("data-menu-item-id")).toBe(OIDS.item3);
  });

  it("counts the order's lines on the tabs and on the bar", async () => {
    await open();
    expect(screen.getByRole("tab", { name: "Primi · 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Secondi · 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Comanda · 2 righe" })).toBeTruthy();
  });

  it("a tap adds one portion to the selected course: one POST with a fresh line id and a stamp", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /^Primi/ }));
    fireEvent.click(item(SOUP_ITEM.id));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const write = writes()[0]!;
    expect(write.path).toBe(`/api/table-sessions/${OIDS.session}/lines`);
    expect(write.init!.method).toBe("POST");
    expect(write.init!.body).toEqual({
      lineId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      menuItemId: SOUP_ITEM.id,
      course: "primi",
      clientUpdatedAt: expect.stringMatching(/Z$/),
    });
  });

  it("shows 'Invio…' until the reply, then the line from the server and the new hint", async () => {
    let release!: (value: Result) => void;
    postReply = () => new Promise<Result>((resolve) => (release = resolve));
    await open();
    openSheet();
    fireEvent.click(screen.getByRole("tab", { name: /^Secondi/ }));
    fireEvent.click(item(STEW_ITEM.id));
    expect(await screen.findAllByText("Invio…")).toHaveLength(1);
    await act(async () => {
      release(
        ok({
          ...ADD_REPLY,
          line: { ...LINE_STEW, id: OIDS.line3, qty: 1 },
          item: { ...ADD_REPLY.item, portionsLeft: 2, lowStock: true },
        }),
      );
    });
    await waitFor(() => expect(screen.queryByText("Invio…")).toBeNull());
    expect(document.querySelector(`[data-line-id="${OIDS.line3}"]`)).not.toBeNull();
    expect(within(item(STEW_ITEM.id)).getByText("Ne restano 2")).toBeTruthy();
  });

  it("an unavailable dish adds nothing", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /^Primi/ }));
    fireEvent.click(item(PASTA_ITEM.id));
    expect(writes()).toHaveLength(0);
  });

  it("item_unavailable says the dish is out, takes the pending line away and reads the menu again", async () => {
    postReply = {
      ok: false,
      status: 409,
      error: {
        code: "item_unavailable",
        message: "Il piatto è esaurito.",
        details: { menuItemId: STEW_ITEM.id, reason: "no_portions", portionsLeft: 0 },
      },
    };
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /^Secondi/ }));
    fireEvent.click(item(STEW_ITEM.id));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(`${STEW} è esaurito.`);
    await waitFor(() => expect(reads("/api/menu")).toHaveLength(2));
    expect(screen.queryByText("Invio…")).toBeNull();
    expect(screen.getByRole("button", { name: "Comanda · 2 righe" })).toBeTruthy();
  });

  it("session_closed says the table was closed", async () => {
    postReply = {
      ok: false,
      status: 409,
      error: { code: "session_closed", message: "Il tavolo è stato chiuso." },
    };
    await open();
    fireEvent.click(item(SOUP_ITEM.id));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Il tavolo è stato chiuso.");
  });

  it("client_time_invalid tells the waiter to check the phone's clock", async () => {
    postReply = {
      ok: false,
      status: 422,
      error: { code: "client_time_invalid", message: "Controlla data e ora del telefono." },
    };
    await open();
    fireEvent.click(item(SOUP_ITEM.id));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Controlla data e ora del telefono.");
  });

  it("a send that fails for want of a connection stays on the sheet and 'Riprova' sends the same line id", async () => {
    postReply = {
      ok: false,
      status: 0,
      error: { code: "network", message: "Connessione assente." },
    };
    await open();
    openSheet();
    fireEvent.click(item(SOUP_ITEM.id));
    await screen.findByText("Non inviata");
    postReply = ok({ ...ADD_REPLY, created: false });
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect((writes()[0]!.init!.body as { lineId: string }).lineId).toBe(
      (writes()[1]!.init!.body as { lineId: string }).lineId,
    );
    expect((writes()[0]!.init!.body as { clientUpdatedAt: string }).clientUpdatedAt).toBe(
      (writes()[1]!.init!.body as { clientUpdatedAt: string }).clientUpdatedAt,
    );
    await waitFor(() => expect(screen.queryByText("Non inviata")).toBeNull());
  });

  describe("'Scarta' on a line whose send failed for want of a connection", () => {
    const NO_NETWORK: Result = {
      ok: false,
      status: 0,
      error: { code: "network", message: "Connessione assente." },
    };
    const sentBody = (n: number) =>
      writes()[n]!.init!.body as { lineId: string; clientUpdatedAt: string };
    // The first POST fails by network; the next ones answer with `then`.
    async function failFirstSend(then: (lineId: string) => Result) {
      let n = 0;
      postReply = () => {
        n += 1;
        return Promise.resolve(
          n === 1 ? NO_NETWORK : then((writes()[0]!.init!.body as { lineId: string }).lineId),
        );
      };
      await open();
      openSheet();
      fireEvent.click(item(SOUP_ITEM.id));
      await screen.findByText("Non inviata");
    }

    it("replays the same POST first, because the insert may have committed", async () => {
      await failFirstSend(() => NO_NETWORK);
      fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
      await waitFor(() => expect(writes()).toHaveLength(2));
      expect(sentBody(1)).toEqual(sentBody(0));
      expect(writes()[1]!.path).toBe(`/api/table-sessions/${OIDS.session}/lines`);
    });

    it("removes the line from the server when the replay finds it there", async () => {
      await failFirstSend((lineId) =>
        ok({
          ...ADD_REPLY,
          created: false,
          line: { ...LINE_STEW, id: lineId, name: SOUP_ITEM.name },
        }),
      );
      const stamp = (writes()[0]!.init!.body as { clientUpdatedAt: string }).clientUpdatedAt;
      removeReply = ok({ changed: true, line: { ...LINE_STEW, state: "voided" } });
      fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
      await waitFor(() => expect(writes()).toHaveLength(3));
      const removal = writes()[2]!;
      expect(removal.path).toBe(`/api/order-lines/${sentBody(0).lineId}/remove`);
      const at = (removal.init!.body as { clientUpdatedAt: string }).clientUpdatedAt;
      expect(Date.parse(at)).toBeGreaterThan(Date.parse(stamp));
      await waitFor(() => expect(screen.queryByText("Non inviata")).toBeNull());
      expect(document.querySelector(`[data-line-id="${sentBody(0).lineId}"]`)).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("keeps the line marked and says it may already have been sent when the replay also fails by network", async () => {
      await failFirstSend(() => NO_NETWORK);
      fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(
        "Non riesco a controllare se la riga è già stata inviata: potrebbe essere sul tavolo. Riprova quando sei online.",
      );
      expect(screen.getByText("Non inviata")).toBeTruthy();
      expect(writes()).toHaveLength(2);
      // A second try is still possible and does the same.
      expect(screen.getByRole("button", { name: "Scarta" })).toBeTruthy();
    });

    it("drops the line without a removal when the server refuses the replay (it was never created)", async () => {
      await failFirstSend(() => ({
        ok: false,
        status: 409,
        error: { code: "session_closed", message: "Il tavolo è stato chiuso." },
      }));
      fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
      await waitFor(() => expect(screen.queryByText("Non inviata")).toBeNull());
      expect(writes()).toHaveLength(2);
      expect(writes().some((w) => w.path.endsWith("/remove"))).toBe(false);
    });

    it("while a discard waits for the replay, 'Riprova' and 'Scarta' are disabled and 'Riprova' sends nothing; the line is not put back", async () => {
      let release!: (value: Result) => void;
      let n = 0;
      postReply = () => {
        n += 1;
        if (n === 1) return Promise.resolve(NO_NETWORK);
        return new Promise<Result>((resolve) => (release = resolve));
      };
      await open();
      openSheet();
      fireEvent.click(item(SOUP_ITEM.id));
      await screen.findByText("Non inviata");
      const lineId = sentBody(0).lineId;
      fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
      await waitFor(() => expect(writes()).toHaveLength(2));
      expect((screen.getByRole("button", { name: "Riprova" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect((screen.getByRole("button", { name: "Scarta" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
      fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
      expect(writes()).toHaveLength(2);
      await act(async () => {
        release(ok({ ...ADD_REPLY, created: false, line: { ...LINE_STEW, id: lineId } }));
      });
      await waitFor(() => expect(screen.queryByText("Non inviata")).toBeNull());
      expect(writes()).toHaveLength(3);
      expect(writes()[2]!.path).toBe(`/api/order-lines/${lineId}/remove`);
      expect(document.querySelector(`[data-line-id="${lineId}"]`)).toBeNull();
    });

    it("when the replay succeeds but the removal fails for another reason, the real line is on the sheet and the error shows", async () => {
      await failFirstSend((lineId) =>
        ok({
          ...ADD_REPLY,
          created: false,
          line: { ...LINE_STEW, id: lineId, name: SOUP_ITEM.name },
        }),
      );
      const lineId = sentBody(0).lineId;
      removeReply = {
        ok: false,
        status: 500,
        error: { code: "internal", message: "Errore del server." },
      };
      fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("Errore del server.");
      await waitFor(() =>
        expect(document.querySelector(`[data-line-id="${lineId}"]`)).not.toBeNull(),
      );
      expect(screen.queryByText("Non inviata")).toBeNull();
      expect(screen.queryByText("Invio…")).toBeNull();
    });

    it("keeps the line and the warning when the removal itself fails by network", async () => {
      await failFirstSend((lineId) =>
        ok({ ...ADD_REPLY, created: false, line: { ...LINE_STEW, id: lineId } }),
      );
      removeReply = NO_NETWORK;
      fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("potrebbe essere sul tavolo");
      expect(screen.getByText("Non inviata")).toBeTruthy();
    });
  });

  describe("editing a line", () => {
    const edit = async () => {
      await open();
      openSheet();
      fireEvent.click(screen.getByRole("button", { name: /^Modifica 2 × Spezzatino/ }));
    };

    it("a change sends one PATCH with only that field and a stamp after the line's own", async () => {
      await edit();
      fireEvent.click(screen.getByRole("button", { name: "Più una porzione" }));
      await waitFor(() => expect(writes()).toHaveLength(1));
      const write = writes()[0]!;
      expect(write.path).toBe(`/api/order-lines/${OIDS.line1}`);
      expect(write.init!.method).toBe("PATCH");
      expect(write.init!.body).toEqual({ qty: 3, clientUpdatedAt: expect.stringMatching(/Z$/) });
    });

    it("moving to another course sends the course", async () => {
      await edit();
      fireEvent.change(screen.getByRole("combobox", { name: /^Portata/ }), {
        target: { value: "dolci" },
      });
      await waitFor(() => expect(writes()).toHaveLength(1));
      expect((writes()[0]!.init!.body as { course: string }).course).toBe("dolci");
    });

    it("the reply's line replaces the screen's copy", async () => {
      patchReply = ok({ changed: true, line: { ...LINE_STEW, qty: 3, course: "dolci" } });
      await edit();
      fireEvent.click(screen.getByRole("button", { name: "Più una porzione" }));
      await waitFor(() => expect(screen.getByRole("tab", { name: "Dolci · 1" })).toBeTruthy());
    });

    it("a note unchanged sends nothing", async () => {
      await edit();
      const note = screen.getByRole("textbox", { name: /^Nota/ });
      fireEvent.blur(note);
      expect(writes()).toHaveLength(0);
    });

    it("a conflict shows who changed the line and when, and the line takes the current values (AT5)", async () => {
      const current = {
        ...LINE_STEW,
        qty: 4,
        note: "ben cotto",
        updatedAt: "2026-11-02T19:31:00+00:00",
        updatedBy: { id: OIDS.waiterB, displayName: "Cameriere Due Demo" },
      };
      patchReply = {
        ok: false,
        status: 409,
        error: {
          code: "conflict",
          message:
            "Questa riga è stata cambiata da Cameriere Due Demo alle 20:31: ecco la versione attuale.",
          details: { reason: "stale", line: current },
        },
      };
      await edit();
      fireEvent.click(screen.getByRole("button", { name: "Più una porzione" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Cameriere Due Demo");
      expect(alert.textContent).toContain("alle 20:31");
      expect(alert.textContent).toContain("Ora: 4 × Spezzatino con polenta (demo) · ben cotto");
      const row = document.querySelector(`[data-line-id="${OIDS.line1}"]`) as HTMLElement;
      expect(within(row).getByText("4 × Spezzatino con polenta (demo)")).toBeTruthy();
    });

    it("a conflict without a usable line still warns and reads the order again", async () => {
      patchReply = {
        ok: false,
        status: 409,
        error: {
          code: "conflict",
          message: "Riga cambiata.",
          details: { reason: "stale", line: { id: 1 } },
        },
      };
      await edit();
      fireEvent.click(screen.getByRole("button", { name: "Più una porzione" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Riga cambiata.");
      await waitFor(() =>
        expect(reads(`/api/table-sessions/${OIDS.session}/lines`).length).toBeGreaterThan(1),
      );
    });

    it("Rimuovi posts the removal and the line leaves the sheet", async () => {
      await edit();
      fireEvent.click(screen.getByRole("button", { name: "Rimuovi" }));
      await waitFor(() => expect(writes()).toHaveLength(1));
      const write = writes()[0]!;
      expect(write.path).toBe(`/api/order-lines/${OIDS.line1}/remove`);
      expect(write.init!.body).toEqual({ clientUpdatedAt: expect.stringMatching(/Z$/) });
      await waitFor(() =>
        expect(document.querySelector(`[data-line-id="${OIDS.line1}"]`)).toBeNull(),
      );
      expect(screen.getByRole("button", { name: "Comanda · 1 riga" })).toBeTruthy();
    });

    it("Fatto closes the editor", async () => {
      await edit();
      fireEvent.click(screen.getByRole("button", { name: "Fatto" }));
      expect(screen.queryByRole("button", { name: "Fatto" })).toBeNull();
    });
  });

  it("the chef (403) sees one message and no menu, and no euro sign in it", async () => {
    const denied: Result = { ok: false, status: 403, error: { code: "forbidden", message: "no" } };
    menuReply = denied;
    viewReply = denied;
    render(createElement(OrderPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("La comanda non è disponibile per il tuo ruolo.");
    expect(alert.textContent).not.toContain("€");
    expect(document.querySelector("[data-menu-item-id]")).toBeNull();
  });

  it("an unknown session says so", async () => {
    viewReply = {
      ok: false,
      status: 404,
      error: { code: "not_found", message: "Sessione non trovata." },
    };
    render(createElement(OrderPage));
    expect((await screen.findByRole("alert")).textContent).toBe("Sessione non trovata.");
  });

  it("a closed table says so and offers no menu", async () => {
    const closed: OrderView = {
      ...ORDER_VIEW,
      session: { ...ORDER_VIEW.session, closed: true, status: "closed" },
    };
    viewReply = ok(closed);
    render(createElement(OrderPage));
    await screen.findByRole("heading", { name: "Tavolo 1 (demo)" });
    expect(await screen.findByText("Il tavolo è stato chiuso.")).toBeTruthy();
    expect(document.querySelector("[data-menu-item-id]")).toBeNull();
  });

  it("reads the menu and the order again when the page becomes visible", async () => {
    await open();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(reads("/api/menu")).toHaveLength(2));
    expect(reads(`/api/table-sessions/${OIDS.session}/lines`)).toHaveLength(2);
  });

  it("a menu that changed shows the dish greyed after the next read", async () => {
    await open();
    const out: ServiceMenu = {
      ...MENU,
      categories: MENU.categories.map((c) => ({
        ...c,
        items: c.items.map((i) =>
          i.id === STEW_ITEM.id
            ? {
                ...i,
                available: false,
                unavailableReason: "no_portions" as const,
                portionsLeft: 0,
                lowStock: false,
              }
            : i,
        ),
      })),
    };
    menuReply = ok(out);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    fireEvent.click(screen.getByRole("tab", { name: /^Secondi/ }));
    await waitFor(() => expect(item(STEW_ITEM.id).getAttribute("aria-disabled")).toBe("true"));
  });
});
