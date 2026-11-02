// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCARDS } from "../helpers/push-data";
import { AVT, ITEMS_ADMIN, ITEMS_OWNER, KPI_REPORT, UNMAPPED } from "../helpers/report-data";
import { SERVICES_REPORT } from "../helpers/services-data";

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
  // M25c: Andamento also reads /api/reports/services; that read has its own suite (report-services.test.ts), so it is answered and not counted here.
  if (path.startsWith("/api/reports/services")) return Promise.resolve(ok(SERVICES_REPORT));
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

// M24 step 11: the CSV links read the role from useMe; a mock keeps /api/me out of the calls these tests count.
let meRole: string | null = "owner";
vi.mock("@/components/use-me", () => ({
  useMe: () => ({
    status: meRole === null ? "loading" : "ok",
    me:
      meRole === null
        ? null
        : {
            user: { id: "u", displayName: "Titolare Demo", role: meRole },
            tenant: { id: "t", name: "Osteria Demo A" },
          },
    retry: () => undefined,
  }),
}));

let noCsv = false;
vi.mock("@/lib/exports/export-links", async () => {
  const actual = await vi.importActual<typeof import("@/lib/exports/export-links")>(
    "@/lib/exports/export-links",
  );
  return {
    ...actual,
    csvHrefForEndpoint: (path: string) => (noCsv ? null : actual.csvHrefForEndpoint(path)),
  };
});

import ReportPage from "@/app/(owner)/report/page";

beforeEach(() => {
  meRole = "owner";
  noCsv = false;
  replies = {
    "/api/reports/kpis": ok(KPI_REPORT),
    "/api/reports/items": ok(ITEMS_OWNER),
    "/api/reports/avt": ok(AVT),
    "/api/reports/unmapped-items": ok(UNMAPPED),
    "/api/reports/discards-vs-push": ok(DISCARDS),
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
    ["vista=scarti", "/api/reports/discards-vs-push"],
    ["vista=scarti&data=2026-11-04", "/api/reports/discards-vs-push?week=2026-11-04"],
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

  it("the five views are links (M23 added Scarti e spinte), the current one is marked", async () => {
    query = "vista=piatti";
    await open();
    const links = ["Andamento", "Piatti", "Scostamenti", "Non mappati", "Scarti e spinte"].map(
      (name) => screen.getByRole("link", { name }),
    );
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([
      null,
      "page",
      null,
      null,
      null,
    ]);
    expect(links[4]!.getAttribute("href")).toBe("/report?vista=scarti");
    expect(links[2]!.getAttribute("href")).toBe("/report?vista=scostamenti");
  });

  it("picking another period goes through the address, not through state", async () => {
    await open();
    await screen.findByText("Questo periodo");
    fireEvent.click(screen.getByRole("button", { name: "Settimana" }));
    expect(push).toHaveBeenCalledWith("/report?vista=andamento&periodo=settimana");
  });

  it("Periodo: tapping it shows both date fields and fetches nothing until both dates are set", async () => {
    await open();
    await screen.findByText("Questo periodo");
    calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Periodo" }));
    expect(push).toHaveBeenCalledWith("/report?vista=andamento&periodo=periodo");
    cleanup();

    query = "vista=andamento&periodo=periodo";
    await open();
    expect(screen.getByLabelText("Dal")).toBeTruthy();
    expect(screen.getByLabelText("Al")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Periodo" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(calls).toEqual([]);

    fireEvent.change(screen.getByLabelText("Dal"), { target: { value: "2026-11-01" } });
    expect(push).toHaveBeenLastCalledWith("/report?vista=andamento&periodo=periodo&dal=2026-11-01");
    cleanup();

    query = "vista=andamento&periodo=periodo&dal=2026-11-01";
    await open();
    expect(calls).toEqual([]);
    fireEvent.change(screen.getByLabelText("Al"), { target: { value: "2026-11-07" } });
    expect(push).toHaveBeenLastCalledWith(
      "/report?vista=andamento&periodo=periodo&dal=2026-11-01&al=2026-11-07",
    );
    cleanup();

    query = "vista=andamento&periodo=periodo&dal=2026-11-01&al=2026-11-07";
    await open();
    await screen.findByText("Questo periodo");
    expect(calls).toEqual(["/api/reports/kpis?period=custom&from=2026-11-01&to=2026-11-07"]);
  });

  it("Periodo with the end before the start fetches nothing and says why", async () => {
    query = "vista=piatti&periodo=periodo&dal=2026-11-07&al=2026-11-01";
    await open();
    expect(screen.getByLabelText("Dal")).toBeTruthy();
    expect(calls).toEqual([]);
    expect(
      screen.getByText("Le date non sono valide: la prima deve precedere l'ultima."),
    ).toBeTruthy();
    expect(screen.queryByText("Caricamento del report…")).toBeNull();
  });

  it("an incomplete Periodo shows no error yet", async () => {
    query = "vista=piatti&periodo=periodo&dal=2026-11-07";
    await open();
    expect(calls).toEqual([]);
    expect(screen.queryByText(/Le date non sono valide/)).toBeNull();
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
    expect(
      await screen.findByText("I report sono riservati al titolare e all'amministratore."),
    ).toBeTruthy();
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

describe("the Scarti e spinte view (M23 step 17)", () => {
  it("reads only the discards report and shows its rows", async () => {
    query = "vista=scarti";
    await open();
    await screen.findByText("Settimana dal 02/11 all'08/11");
    expect(calls).toEqual(["/api/reports/discards-vs-push"]);
    expect(
      screen.getByText(/^Spezzatino · durata 48 h · 1 lotto scartato, 1 era in evidenza/),
    ).toBeTruthy();
  });

  it("moving the week goes to ?vista=scarti&data=", async () => {
    query = "vista=scarti";
    await open();
    await screen.findByText("Settimana dal 02/11 all'08/11");
    fireEvent.click(screen.getByRole("button", { name: "Precedente" }));
    expect(push).toHaveBeenCalledWith("/report?vista=scarti&data=2026-10-26");
  });

  it("a 403 shows the reserved notice like the other views", async () => {
    query = "vista=scarti";
    replies["/api/reports/discards-vs-push"] = fail(403, "forbidden", "x");
    render(createElement(ReportPage));
    expect(await screen.findByText(/riservati/)).toBeTruthy();
  });
});

describe("M24: the CSV link and the monthly pack link", () => {
  const csvLink = () => screen.queryByRole("link", { name: "Scarica CSV" });

  it.each([
    [
      "vista=andamento&periodo=mese&data=2026-10-15",
      "/api/reports/kpis?period=month&date=2026-10-15",
      "/api/exports/kpis.csv?period=month&date=2026-10-15",
    ],
    [
      "vista=piatti&periodo=settimana&data=2026-11-04",
      "/api/reports/items?period=week&date=2026-11-04",
      "/api/exports/items.csv?period=week&date=2026-11-04",
    ],
    [
      "vista=piatti&periodo=periodo&dal=2026-10-01&al=2026-10-31",
      "/api/reports/items?period=custom&from=2026-10-01&to=2026-10-31",
      "/api/exports/items.csv?period=custom&from=2026-10-01&to=2026-10-31",
    ],
    ["vista=scostamenti", "/api/reports/avt", "/api/exports/avt.csv"],
    [
      "vista=scostamenti&inventario=c5000000-0000-4000-8000-000000000001",
      "/api/reports/avt?count=c5000000-0000-4000-8000-000000000001",
      "/api/exports/avt.csv?count=c5000000-0000-4000-8000-000000000001",
    ],
    [
      "vista=non-mappati&data=2026-11-04",
      "/api/reports/unmapped-items?week=2026-11-04",
      "/api/exports/unmapped-items.csv?week=2026-11-04",
    ],
    [
      "vista=scarti&data=2026-11-04",
      "/api/reports/discards-vs-push?week=2026-11-04",
      "/api/exports/discards-vs-push.csv?week=2026-11-04",
    ],
  ])("%s: the link has the query of the JSON request", async (search, json, csv) => {
    query = search;
    await open();
    await waitFor(() => expect(csvLink()).not.toBeNull());
    expect(calls).toEqual([json]);
    expect(csvLink()!.getAttribute("href")).toBe(csv);
    expect(new URL(csv, "http://x").search).toBe(new URL(json, "http://x").search);
  });

  it("the default view (Andamento, day) links /api/exports/kpis.csv?period=day", async () => {
    await open();
    await waitFor(() => expect(csvLink()).not.toBeNull());
    expect(csvLink()!.getAttribute("href")).toBe("/api/exports/kpis.csv?period=day");
  });

  it("is a download link and there is exactly one", async () => {
    await open();
    await waitFor(() => expect(csvLink()).not.toBeNull());
    expect(screen.getAllByRole("link", { name: "Scarica CSV" })).toHaveLength(1);
    expect(csvLink()!.hasAttribute("download")).toBe(true);
  });

  it("no link while the report is loading or when there is nothing to export (no monthly count)", async () => {
    replies["/api/reports/avt"] = fail(404, "not_found", "x");
    query = "vista=scostamenti";
    await open();
    await screen.findByText("Serve un inventario mensile chiuso.");
    expect(csvLink()).toBeNull();
  });

  it.each(["chef", "waiter"])("%s sees no CSV link", async (role) => {
    meRole = role;
    await open();
    await screen.findByText("Questo periodo");
    expect(csvLink()).toBeNull();
  });

  it("a view with no CSV renders no link at all, not a link with an empty address", async () => {
    noCsv = true;
    const { container } = render(createElement(ReportPage));
    await screen.findByText("Questo periodo");
    expect(csvLink()).toBeNull();
    expect(container.querySelector("a[download]")).toBeNull();
    expect(container.querySelector('a[href=""]')).toBeNull();
  });

  it("'Pacchetto mensile' links to /report/mese", async () => {
    await open();
    expect(screen.getByRole("link", { name: "Pacchetto mensile" }).getAttribute("href")).toBe(
      "/report/mese",
    );
  });
});
