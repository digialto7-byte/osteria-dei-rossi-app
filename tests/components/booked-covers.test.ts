// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });

let reply: Result;
const calls: string[] = [];
const apiJson = vi.fn((path: string): Promise<Result> => {
  calls.push(path);
  return Promise.resolve(reply);
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import { BookedCovers } from "@/app/(owner)/produzione/booked-covers";

// Demo day in 1998. The reply has exactly the five keys of the covers read: no name, phone or e-mail.
const COVERS = {
  businessDate: "1998-11-13",
  services: [
    { key: "pranzo", name: "Pranzo", reservations: 4, covers: 12 },
    { key: "cena", name: "Cena", reservations: 9, covers: 30 },
  ],
};

beforeEach(() => {
  reply = ok(COVERS);
  calls.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const show = async (date = "1998-11-13") => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(createElement(BookedCovers, { date }));
  });
  return view;
};

describe("BookedCovers", () => {
  it("reads the covers of the day it is given, and writes one row per service", async () => {
    const view = await show();
    expect(calls).toEqual(["/api/reservations/covers?date=1998-11-13"]);
    const body = view.container.textContent ?? "";
    expect(body).toContain("Prenotati (confermati)");
    expect(body).toContain("Pranzo 12 coperti · 4 prenotazioni");
    expect(body).toContain("Cena 30 coperti · 9 prenotazioni");
    expect(view.container.querySelectorAll("li.num")).toHaveLength(2);
  });

  it("uses the singular for one cover and one booking", async () => {
    reply = ok({
      ...COVERS,
      services: [{ key: "pranzo", name: "Pranzo", reservations: 1, covers: 1 }],
    });
    const view = await show();
    expect(view.container.textContent).toContain("Pranzo 1 coperto · 1 prenotazione");
  });

  it("says there is no confirmed booking when every service is at zero, or there is none", async () => {
    reply = ok({
      ...COVERS,
      services: [
        { key: "pranzo", name: "Pranzo", reservations: 0, covers: 0 },
        { key: "cena", name: "Cena", reservations: 0, covers: 0 },
      ],
    });
    const view = await show();
    expect(view.container.textContent).toContain("Nessuna prenotazione confermata");
    expect(view.container.querySelector("li")).toBeNull();
    cleanup();
    reply = ok({ ...COVERS, services: [] });
    const none = await show();
    expect(none.container.textContent).toContain("Nessuna prenotazione confermata");
  });

  it("reads again for another day, and never shows one day's counts under another", async () => {
    const view = render(createElement(BookedCovers, { date: "1998-11-13" }));
    await screen.findByText(/Pranzo/);
    reply = ok({
      businessDate: "1998-11-14",
      services: [{ key: "cena", name: "Cena", reservations: 2, covers: 7 }],
    });
    await act(async () => {
      view.rerender(createElement(BookedCovers, { date: "1998-11-14" }));
    });
    expect(calls).toEqual([
      "/api/reservations/covers?date=1998-11-13",
      "/api/reservations/covers?date=1998-11-14",
    ]);
    expect(view.container.textContent).toContain("Cena 7 coperti · 2 prenotazioni");
    expect(view.container.textContent).not.toContain("Pranzo");
  });

  it("shows a one-line alert for a failed read, and nothing for a refused one", async () => {
    reply = {
      ok: false,
      status: 500,
      error: { code: "report_unavailable", message: "I dati non sono disponibili." },
    };
    const view = await show();
    expect(screen.getByRole("alert").textContent).toBe("I dati non sono disponibili.");
    expect(view.container.textContent).not.toContain("Prenotati");
    cleanup();
    reply = { ok: false, status: 403, error: { code: "forbidden", message: "x" } };
    const refused = await show();
    expect(refused.container.textContent).toBe("");
  });

  it("holds no guest data: no name, phone or e-mail reaches the page", async () => {
    const view = await show();
    expect(view.container.innerHTML).not.toMatch(/@|\+39|phone|email|telefono/i);
  });
});
