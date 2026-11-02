// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT } from "../helpers/bill-data";
import { DAY_SERVICES } from "../helpers/services-data";

// The "Per servizio" card of the end-of-day page (M25c step 13): one read of /api/day-close/services after the report, the moves through
// POST /api/table-sessions/:id/service, one re-read after a move. Every figure is the database's.
type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

let reportReply: Result;
let servicesReply: Result;
let moveReply: Result;
const push = vi.fn();
const calls: Array<{ path: string; init: Init }> = [];
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (path.startsWith("/api/reports/app-vs-register")) return Promise.resolve(reportReply);
  if (path.startsWith("/api/day-close/services")) return Promise.resolve(servicesReply);
  if (path.startsWith("/api/table-sessions/")) return Promise.resolve(moveReply);
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push, replace: push }),
}));

import DayClosePage from "@/app/(owner)/chiusura/page";

const T2 = "14000000-0000-4000-8000-000000000002";
const T5 = "14000000-0000-4000-8000-000000000009";
const T4 = "14000000-0000-4000-8000-000000000004";

beforeEach(() => {
  reportReply = ok(REPORT);
  servicesReply = ok(DAY_SERVICES);
  moveReply = ok({
    changed: true,
    session: { sessionId: T2, serviceKey: "pranzo", source: "override" },
  });
  calls.length = 0;
  push.mockClear();
  apiJson.mockClear();
});
afterEach(cleanup);

const serviceReads = () => calls.filter((c) => c.path.startsWith("/api/day-close/services"));
const moves = () => calls.filter((c) => c.init?.method === "POST");
const nb = (s: string) => s.replace(/(\d) (€|%)/g, "$1" + String.fromCharCode(160) + "$2");
const card = () => screen.getByRole("group", { name: "Per servizio" });
const open = async () => {
  render(createElement(DayClosePage));
  await screen.findByRole("heading", { name: "Per servizio" });
};
// Scoped to the card: the missing-receipts list of the same page also carries data-session-id rows.
const rowOf = (id: string) => card().querySelector(`[data-session-id="${id}"]`) as HTMLElement;

describe("the Per servizio card", () => {
  it("reads /api/day-close/services once, for the day of the report, after the report", async () => {
    await open();
    expect(calls.map((c) => c.path)).toEqual([
      "/api/reports/app-vs-register",
      "/api/day-close/services?date=2026-11-04",
    ]);
  });

  it("shows one row per service with tables, covers and the frozen total, and the day total", async () => {
    await open();
    const rows = [...card().querySelectorAll("[data-service-key]")].map((r) => r.textContent);
    expect(rows).toEqual([
      nb("Pranzo · 1 tavolo · 2 coperti · 18,00 €"),
      nb("Cena · 2 tavoli · 5 coperti · 135,00 € · 1 tavolo ancora aperto"),
    ]);
    expect(card().textContent).toContain(nb("Totale giorno 153,00 €"));
  });

  it("says that the register closes once a day, so the difference is on the total", async () => {
    await open();
    expect(
      within(card()).getByText(
        "La cassa si chiude una volta al giorno: la differenza è sul totale.",
      ),
    ).toBeTruthy();
  });

  it("sits between the app card and the register form", async () => {
    await open();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Incassi registrati nell'app")).toBeLessThan(text.indexOf("Per servizio"));
    expect(text.indexOf("Per servizio")).toBeLessThan(
      text.indexOf("Totale del registratore di cassa"),
    );
  });

  it("the sessions list is closed, then opens with aria-expanded and one row per session", async () => {
    await open();
    const toggle = within(card()).getByRole("button", { name: "Tavoli per servizio" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(card().querySelector(`[data-session-id="${T2}"]`)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rowOf(T5).textContent).toContain("Tavolo 5 (demo) · aperto alle 12:30 · Pranzo");
    expect(rowOf(T2).textContent).toContain("Tavolo 2 (demo) · aperto alle 21:30 · Cena");
    expect(rowOf(T4).textContent).toContain("Tavolo 4 (demo) · aperto alle 22:00 · Cena");
  });

  it("a moved table says Spostato; a table whose day is final has no Cambia servizio", async () => {
    const data = structuredClone(DAY_SERVICES);
    data.sessions[0]!.source = "override";
    data.sessions[1]!.canChange = false;
    servicesReply = ok(data);
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Tavoli per servizio" }));
    expect(within(rowOf(T5)).getByText("Spostato")).toBeTruthy();
    expect(within(rowOf(T2)).queryByText("Spostato")).toBeNull();
    expect(within(rowOf(T5)).getByRole("button", { name: /Cambia servizio/ })).toBeTruthy();
    expect(within(rowOf(T2)).queryByRole("button", { name: /Cambia servizio/ })).toBeNull();
  });

  it("the sheet offers the choices of the table and Automatico, with the current one checked", async () => {
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Tavoli per servizio" }));
    fireEvent.click(within(rowOf(T2)).getByRole("button", { name: /Cambia servizio/ }));
    const sheet = screen.getByRole("group", { name: /Cambia servizio/ });
    const radios = within(sheet).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.labels?.[0]?.textContent)).toEqual(["Pranzo", "Cena", "Automatico"]);
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
  });

  it("Conferma posts the chosen key, then reads the day once more", async () => {
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Tavoli per servizio" }));
    fireEvent.click(within(rowOf(T2)).getByRole("button", { name: /Cambia servizio/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Pranzo" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(moves()).toHaveLength(1));
    expect(moves()[0]).toEqual({
      path: `/api/table-sessions/${T2}/service`,
      init: { method: "POST", body: { serviceKey: "pranzo" } },
    });
    await waitFor(() => expect(serviceReads()).toHaveLength(2));
    expect(serviceReads()[1]!.path).toBe("/api/day-close/services?date=2026-11-04");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Conferma" })).toBeNull());
  });

  it("Automatico posts null", async () => {
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Tavoli per servizio" }));
    fireEvent.click(within(rowOf(T2)).getByRole("button", { name: /Cambia servizio/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Automatico" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(moves()).toHaveLength(1));
    expect(moves()[0]!.init).toEqual({ method: "POST", body: { serviceKey: null } });
  });

  it("a 409 shows its message in the sheet's aria-live region and reads nothing again", async () => {
    moveReply = {
      ok: false,
      status: 409,
      error: {
        code: "service_day_final",
        message: "La giornata è già chiusa: il servizio non si può più cambiare.",
      },
    };
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Tavoli per servizio" }));
    fireEvent.click(within(rowOf(T2)).getByRole("button", { name: /Cambia servizio/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Pranzo" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    const sheet = screen.getByRole("group", { name: /Cambia servizio/ });
    expect((await within(sheet).findByRole("alert")).textContent).toBe(
      "La giornata è già chiusa: il servizio non si può più cambiare.",
    );
    expect(sheet.querySelector("[aria-live]")?.textContent).toContain("La giornata è già chiusa");
    expect(serviceReads()).toHaveLength(1);
  });

  it("Annulla closes the sheet and posts nothing", async () => {
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Tavoli per servizio" }));
    fireEvent.click(within(rowOf(T2)).getByRole("button", { name: /Cambia servizio/ }));
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByRole("button", { name: "Conferma" })).toBeNull();
    expect(moves()).toHaveLength(0);
    expect(serviceReads()).toHaveLength(1);
  });

  it("a failed read of the split shows its message in the card place and leaves the register alone", async () => {
    servicesReply = {
      ok: false,
      status: 500,
      error: { code: "internal", message: "Qualcosa non ha funzionato." },
    };
    render(createElement(DayClosePage));
    await screen.findByText(/^Totale app/);
    expect(await screen.findByText("Qualcosa non ha funzionato.")).toBeTruthy();
    expect(screen.getByLabelText("Totale del registratore di cassa")).toBeTruthy();
  });

  it("every button and radio is a 44 px target", async () => {
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Tavoli per servizio" }));
    fireEvent.click(within(rowOf(T2)).getByRole("button", { name: /Cambia servizio/ }));
    const sheet = screen.getByRole("group", { name: /Cambia servizio/ });
    const targets = [
      ...card().querySelectorAll("button"),
      ...sheet.querySelectorAll("button"),
      ...sheet.querySelectorAll("label"),
    ];
    expect(targets.length).toBeGreaterThanOrEqual(8);
    for (const target of targets) expect(target.className).toContain("min-h-tap");
  });

  it("a service or table name is text, never markup", async () => {
    const data = structuredClone(DAY_SERVICES);
    data.services[0]!.name = "<img src=x onerror=alert(1)>";
    data.sessions[0]!.tableName = "<b>x</b>";
    servicesReply = ok(data);
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Tavoli per servizio" }));
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });
});
