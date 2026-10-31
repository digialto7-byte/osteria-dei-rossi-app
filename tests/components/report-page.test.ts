// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVT, ITEMS_ADMIN, ITEMS_OWNER, KPI_REPORT, UNMAPPED } from "../helpers/report-data";

type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const fail = (status: number, code: string, message: string): Result => ({
  ok: false,
  status,
  error: { code, message },
});

let replies: Record<string, Result>;
let query = "";
const push = vi.fn();
const calls: string[] = [];
const apiJson = vi.fn((path: string): Promise<Result> => {
  calls.push(path);
  const key = Object.keys(replies).find((k) => path.startsWith(k));
  return Promise.resolve(key ? replies[key]! : fail(404, "not_found", "x"));
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string) => apiJson(path),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push, replace: push }),
}));

import ReportPage from "@/app/(owner)/report/page";

beforeEach(() => {
  replies = {
    "/api/reports/kpis": ok(KPI_REPORT),
    "/api/reports/items": ok(ITEMS_OWNER),
    "/api/reports/avt": ok(AVT),
    "/api/reports/unmapped-items": ok(UNMAPPED),
  };
  query = "";
  calls.length = 0;
  push.mockClear();
  apiJson.mockClear();
});
afterEach(cleanup);

const open = async () => {
  render(createElement(ReportPage));
  await screen.findByRole("heading", { name: "Report" });
};

describe("the report page: one endpoint per view", () => {
  it("opens on Andamento and reads only the KPI report", async () => {
    await open();
    await screen.findByText("Questo periodo");
    expect(calls).toEqual(["/api/reports/kpis?period=day"]);
  });

  it.each([
    [
      "vista=andamento&periodo=settimana&data=2026-11-04",
      "/api/reports/kpis?period=week&date=2026-11-04",
    ],
    [
      "vista=andamento&periodo=mese&data=2026-11-04",
      "/api/reports/kpis?period=month&date=2026-11-04",
    ],
    [
      "vista=andamento&periodo=periodo&dal=2026-11-01&al=2026-11-07",
      "/api/reports/kpis?period=custom&from=2026-11-01&to=2026-11-07",
    ],
    [
      "vista=piatti&periodo=giorno&data=2026-11-04",
      "/api/reports/items?period=day&date=2026-11-04",
    ],
    ["vista=scostamenti", "/api/reports/avt"],
    [
      "vista=scostamenti&inventario=c5000000-0000-4000-8000-000000000002",
      "/api/reports/avt?count=c5000000-0000-4000-8000-000000000002",
    ],
    ["vista=non-mappati", "/api/reports/unmapped-items"],
    ["vista=non-mappati&data=2026-11-04", "/api/reports/unmapped-items?week=2026-11-04"],
  ])("?%s reads exactly %s", async (search, path) => {
    query = search;
    await open();
    await waitFor(() => expect(calls).toEqual([path]));
  });

  it("an unknown view falls back to Andamento, and a bad date is ignored", async () => {
    query = "vista=altro&data=not-a-date";
    await open();
    await waitFor(() => expect(calls).toEqual(["/api/reports/kpis?period=day"]));
  });

  it("the four views are links, the current one is marked", async () => {
    query = "vista=piatti";
    await open();
    const links = ["Andamento", "Piatti", "Scostamenti", "Non mappati"].map((name) =>
      screen.getByRole("link", { name }),
    );
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([null, "page", null, null]);
    expect(links[2]!.getAttribute("href")).toBe("/report?vista=scostamenti");
  });

  it("picking another period goes through the address, not through state", async () => {
    await open();
    await screen.findByText("Questo periodo");
    fireEvent.click(screen.getByRole("button", { name: "Settimana" }));
    expect(push).toHaveBeenCalledWith("/report?vista=andamento&periodo=settimana");
  });

  it("the Piatti view shows the owner's columns, and an admin's reply has none", async () => {
    query = "vista=piatti";
    await open();
    await screen.findByText(/Costi fissi/);
    cleanup();
    replies["/api/reports/items"] = ok(ITEMS_ADMIN);
    await open();
    await screen.findByText(/Margine per piatto/);
    expect(screen.queryByText(/Costi fissi/)).toBeNull();
  });
});

describe("the report page: errors and roles", () => {
  it("a 403 shows the reserved message and no data", async () => {
    replies["/api/reports/kpis"] = fail(403, "forbidden", "x");
    render(createElement(ReportPage));
    expect(await screen.findByText("I report sono riservati al titolare.")).toBeTruthy();
    expect(screen.queryByText("Questo periodo")).toBeNull();
  });

  it("a 422 shows the server's message once", async () => {
    replies["/api/reports/kpis"] = fail(
      422,
      "range_too_long",
      "Il periodo è troppo lungo: al massimo 366 giorni.",
    );
    await open();
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    expect(screen.getByRole("alert").textContent).toContain("al massimo 366 giorni");
  });

  it("the AVT view with no monthly count (404) is the empty state, not an error", async () => {
    replies["/api/reports/avt"] = fail(404, "not_found", "Inventario non trovato.");
    query = "vista=scostamenti";
    await open();
    expect(await screen.findByText("Serve un inventario mensile chiuso.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the AVT view with only one count (422 avt_no_opening_count) asks for a second", async () => {
    replies["/api/reports/avt"] = fail(422, "avt_no_opening_count", "x");
    query = "vista=scostamenti";
    await open();
    expect(
      await screen.findByText("Serve un secondo inventario mensile per confrontare."),
    ).toBeTruthy();
  });

  it("the page names itself once", async () => {
    await open();
    expect(screen.getAllByRole("heading", { name: "Report" })).toHaveLength(1);
  });
});
