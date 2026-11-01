// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACK_NO_COUNT, PACK_NO_OPENING, PACK_OK, PACK_PROVISIONAL } from "../fixtures/exports";

type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const fail = (status: number, code: string, message: string): Result => ({
  ok: false,
  status,
  error: { code, message },
});

let reply: Result;
let query = "";
const calls: string[] = [];
const apiJson = vi.fn((path: string): Promise<Result> => {
  calls.push(path);
  return Promise.resolve(reply);
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string) => apiJson(path),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import MonthlyPackPage from "@/app/(owner)/report/mese/page";

const print = vi.fn();
beforeEach(() => {
  reply = ok(PACK_OK);
  query = "mese=2026-10";
  calls.length = 0;
  apiJson.mockClear();
  print.mockClear();
  window.print = print;
});
afterEach(cleanup);

const plain = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const open = async () => {
  const view = render(createElement(MonthlyPackPage));
  await screen.findByRole("heading", { level: 1, name: /Pacchetto mensile · / });
  return view;
};
const section = (container: HTMLElement, name: string) => {
  const h2 = [...container.querySelectorAll("h2")].find((h) => h.textContent === name);
  expect(h2, name).toBeDefined();
  return h2!.closest("section")!;
};

describe("AT3: the pack renders its four sections from one API read", () => {
  it("reads GET /api/exports/monthly-pack?month=2026-10 once", async () => {
    await open();
    expect(calls).toEqual(["/api/exports/monthly-pack?month=2026-10"]);
  });

  it("without ?mese= it reads the default month", async () => {
    query = "";
    await open();
    expect(calls).toEqual(["/api/exports/monthly-pack"]);
  });

  it("ignores a malformed ?mese= and reads the default month", async () => {
    query = "mese=2026-13";
    await open();
    expect(calls).toEqual(["/api/exports/monthly-pack"]);
  });

  it("has the h1 and exactly four sections with the four h2s in order", async () => {
    const { container } = await open();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Pacchetto mensile · ottobre 2026",
    );
    expect(container.querySelectorAll("section")).toHaveLength(4);
    expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      "Indicatori",
      "Acquisti",
      "Sprechi",
      "Scostamenti",
    ]);
  });
});

describe("Indicatori", () => {
  it("covers: the value, the previous month and the change", async () => {
    const { container } = await open();
    const line = plain(
      section(container, "Indicatori").querySelector('[data-kpi="covers"]')!.textContent,
    );
    expect(line).toContain("312");
    expect(line).toContain("settembre");
    expect(line).toContain("+22");
    expect(line).toContain("290");
  });

  it("net revenue is written as 1.234,50 €", async () => {
    const { container } = await open();
    const line = section(container, "Indicatori").querySelector(
      '[data-kpi="revenue"]',
    )!.textContent!;
    expect(line).toMatch(/1\.234,50\s+€/);
  });

  it("has a line for covers, tables, revenue, spend, ticket, plates, food cost and the register", async () => {
    const { container } = await open();
    const ids = [...section(container, "Indicatori").querySelectorAll("[data-kpi]")].map((n) =>
      n.getAttribute("data-kpi"),
    );
    expect(ids).toEqual([
      "covers",
      "tables",
      "revenue",
      "spend",
      "ticket",
      "plates",
      "foodCost",
      "register",
    ]);
  });

  it("the register line says what the API says", async () => {
    const { container } = await open();
    const line = plain(
      section(container, "Indicatori").querySelector('[data-kpi="register"]')!.textContent,
    );
    expect(line).toMatch(/App 135,00\s+€ · cassa 130,00\s+€ · differenza \+5,00\s+€/);
  });
});

describe("Acquisti", () => {
  it("shows the month's total, the previous month and the change", async () => {
    const { container } = await open();
    const text = plain(section(container, "Acquisti").textContent);
    expect(text).toMatch(/2\.345,60\s+€/);
    expect(text).toMatch(/settembre 2026 2\.100,00\s+€/);
    expect(text).toMatch(/\+245,60\s+€/);
  });

  it("counts the lines without a cost: 1 riga senza costo", async () => {
    const { container } = await open();
    expect(section(container, "Acquisti").textContent).toContain("1 riga senza costo");
  });

  it("says nothing about costs when every line has one", async () => {
    const kpis = PACK_OK.kpis;
    reply = ok({
      ...PACK_OK,
      kpis: { ...kpis, current: { ...kpis.current, purchasesUnvaluedCount: 0 } },
    });
    const { container } = await open();
    expect(section(container, "Acquisti").textContent).not.toContain("senza costo");
  });
});

describe("Sprechi", () => {
  it("shows the total, a '-' name as text, and 'costo non noto' for a null value", async () => {
    const { container } = await open();
    const waste = section(container, "Sprechi");
    expect(waste.textContent).toMatch(/152,40\s+€/);
    expect(waste.textContent).toContain("-Burro (demo)");
    expect(plain(waste.textContent)).toContain("Manzo (demo)");
    expect(waste.textContent).toContain("costo non noto");
  });

  it("shows the reasons, the raw lines with their quantity and the recipe lines with portions", async () => {
    const { container } = await open();
    const text = plain(section(container, "Sprechi").textContent);
    expect(text).toContain("-Burro (demo) · 1,2 kg · 14,40");
    expect(text).toContain("Spezzatino (demo)");
    expect(text).toMatch(/3 porzioni|3 porz/);
  });

  it("says so when nothing was thrown away", async () => {
    reply = ok({
      ...PACK_OK,
      waste: { ...PACK_OK.waste, reasons: [], valueEur: 0, unvaluedCount: 0 },
    });
    const { container } = await open();
    expect(section(container, "Sprechi").textContent).toContain(
      "Nessuno spreco registrato in ottobre 2026.",
    );
  });
});

describe("Scostamenti", () => {
  it("names the two counts, lists the rows and the totals", async () => {
    const { container } = await open();
    const text = plain(section(container, "Scostamenti").textContent);
    expect(text).toContain("31/10/2026");
    expect(text).toContain("30/09/2026");
    expect(text).toContain("Cella (demo)");
    expect(text).toContain("-Burro (demo)");
    expect(text).toMatch(/Perdita .+ · Guadagno/);
  });

  it("noCount: the sentence with the month", async () => {
    reply = ok(PACK_NO_COUNT);
    const { container } = await open();
    expect(section(container, "Scostamenti").textContent).toContain(
      "Nessun inventario mensile chiuso in ottobre 2026.",
    );
  });

  it("noOpening: its sentence", async () => {
    reply = ok(PACK_NO_OPENING);
    const { container } = await open();
    expect(section(container, "Scostamenti").textContent).toContain(
      "Manca l'inventario mensile precedente: lo scostamento parte dal secondo inventario.",
    );
  });
});

describe("a month that is not final", () => {
  it("shows the Provvisorio badge and no link to the next month", async () => {
    reply = ok(PACK_PROVISIONAL);
    await open();
    expect(screen.getByText("Provvisorio")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /novembre 2026/ })).toBeNull();
  });

  it("a final month has no badge and a link to the next one", async () => {
    await open();
    expect(screen.queryByText("Provvisorio")).toBeNull();
    const next = screen.getByRole("link", { name: /novembre 2026/ });
    expect(next.getAttribute("href")).toBe("/report/mese?mese=2026-11");
  });
});

describe("the screen-only controls (hidden on paper)", () => {
  it("the first link is the BackLink to /report, inside data-print=hide", async () => {
    const { container } = await open();
    const first = container.querySelector("a")!;
    expect(first.getAttribute("href")).toBe("/report");
    expect(first.closest('[data-print="hide"]')).not.toBeNull();
    expect(container.querySelector("h1")!.compareDocumentPosition(first)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  });

  it("'Stampa o salva PDF' calls window.print once and sits inside data-print=hide", async () => {
    await open();
    const button = screen.getByRole("button", { name: "Stampa o salva PDF" });
    expect(button.closest('[data-print="hide"]')).not.toBeNull();
    fireEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("the previous month link goes to ?mese=2026-09, inside data-print=hide", async () => {
    await open();
    const link = screen.getByRole("link", { name: /settembre 2026/ });
    expect(link.getAttribute("href")).toBe("/report/mese?mese=2026-09");
    expect(link.closest('[data-print="hide"]')).not.toBeNull();
  });

  it("nothing inside a section is marked as hidden on paper", async () => {
    const { container } = await open();
    for (const s of container.querySelectorAll("section")) {
      expect(s.querySelector('[data-print="hide"]')).toBeNull();
    }
  });

  it("every button is at least 44 px (min-h-tap) and so is every link", async () => {
    const { container } = await open();
    for (const b of container.querySelectorAll("button")) expect(b.className).toMatch(/min-h-tap/);
    for (const a of container.querySelectorAll("a")) expect(a.className).toMatch(/min-h-tap/);
  });
});

describe("errors", () => {
  it("403 shows the reserved message and no sections", async () => {
    reply = fail(403, "forbidden", "x");
    const { container } = render(createElement(MonthlyPackPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("I report sono riservati al titolare e all'amministratore.");
    expect(container.querySelectorAll("section")).toHaveLength(0);
  });

  it("422 shows the server's message in an alert", async () => {
    reply = fail(422, "date_in_future", "La data è nel futuro.");
    render(createElement(MonthlyPackPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("La data è nel futuro.");
    await waitFor(() => expect(within(alert).queryByText("x")).toBeNull());
  });

  it("shows the loading line before the answer", () => {
    reply = ok(PACK_OK);
    render(createElement(MonthlyPackPage));
    expect(screen.getByText("Caricamento del pacchetto…")).toBeTruthy();
  });
});
