// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KITCHEN_TICKETS } from "../helpers/kitchen-data";

// The kitchen screen (M19 plan §3.1.9-3.1.11, step 18) with fake timers and a fake apiJson. The poll is 5 s while the page is
// visible, at once when it becomes visible, and the stale banner appears after 60 s without a successful read (client clock).
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

let reply: Result;
const apiJson = vi.fn((path: string): Promise<Result> => {
  void path;
  return Promise.resolve(reply);
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string) => apiJson(path),
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
  apiJson.mockClear();
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
