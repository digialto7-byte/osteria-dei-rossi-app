// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesPanel } from "@/app/(owner)/report/services-panel";
import { KPI_REPORT } from "../helpers/report-data";
import { SERVICES_REPORT } from "../helpers/services-data";

// The "Per servizio" panel of Report > Andamento (M25c step 14): one extra read with the same query as the KPI read, one panel, one CSV link.
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });

let servicesReply: Result;
let query = "";
const calls: string[] = [];
const apiJson = vi.fn((path: string): Promise<Result> => {
  calls.push(path);
  if (path.startsWith("/api/reports/services")) return Promise.resolve(servicesReply);
  if (path.startsWith("/api/reports/kpis")) return Promise.resolve(ok(KPI_REPORT));
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string) => apiJson(path),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
let meRole: string | null = "owner";
vi.mock("@/components/use-me", () => ({
  useMe: () => ({
    status: "ok",
    me: {
      user: { id: "u", displayName: "Titolare Demo", role: meRole },
      tenant: { id: "t", name: "Osteria Demo A" },
    },
    retry: () => undefined,
  }),
}));

import ReportPage from "@/app/(owner)/report/page";

beforeEach(() => {
  servicesReply = ok(SERVICES_REPORT);
  meRole = "owner";
  query = "vista=andamento&periodo=giorno&data=2026-11-04";
  calls.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const panel = () => screen.findByRole("group", { name: "Per servizio" });
const rowOf = (key: string, root: HTMLElement) =>
  root.querySelector(`[data-service-key="${key}"]`) as HTMLElement;

describe("the Per servizio panel on Andamento", () => {
  it("reads /api/reports/services with the same query as the KPI report", async () => {
    render(createElement(ReportPage));
    await panel();
    expect(calls).toContain("/api/reports/kpis?period=day&date=2026-11-04");
    expect(calls).toContain("/api/reports/services?period=day&date=2026-11-04");
    expect(calls.filter((c) => c.startsWith("/api/reports/services"))).toHaveLength(1);
  });

  it("a custom range passes both ends to both reads", async () => {
    query = "vista=andamento&periodo=periodo&dal=2026-11-01&al=2026-11-07";
    render(createElement(ReportPage));
    await panel();
    expect(calls).toContain("/api/reports/services?period=custom&from=2026-11-01&to=2026-11-07");
  });

  it("the other views do not read it", async () => {
    query = "vista=piatti";
    render(createElement(ReportPage));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.filter((c) => c.startsWith("/api/reports/services"))).toHaveLength(0);
  });

  it("shows covers, net revenue, share, spend per cover and food cost per service", async () => {
    render(createElement(ReportPage));
    const root = await panel();
    const pranzo = text(rowOf("pranzo", root));
    expect(pranzo).toContain("Pranzo");
    expect(pranzo).toContain("Coperti 2");
    expect(pranzo).toContain("Incasso netto 16,36 €");
    expect(pranzo).toContain("Quota 12,08 %");
    expect(pranzo).toContain("Spesa media per coperto 8,18 €");
    expect(pranzo).toContain("Food cost 33,00 %");
    const cena = text(rowOf("cena", root));
    expect(cena).toContain("Quota 87,92 %");
    expect(cena).toContain("Coperti 5");
  });

  it("has a total row", async () => {
    render(createElement(ReportPage));
    const root = await panel();
    const total = text(root.querySelector("[data-services-total]")!);
    expect(total).toContain("Totale");
    expect(total).toContain("Coperti 7");
    expect(total).toContain("Incasso netto 135,49 €");
    expect(total).toContain("Quota 100,00 %");
  });

  it("null ratios are a dash, never 0", async () => {
    const data = structuredClone(SERVICES_REPORT);
    Object.assign(data.services[0]!, {
      covers: 0,
      tables: 0,
      revenueNetEur: 0,
      avgSpendPerCoverEur: null,
      foodCostPct: null,
      revenueSharePct: null,
    });
    servicesReply = ok(data);
    render(createElement(ReportPage));
    const root = await panel();
    const pranzo = text(rowOf("pranzo", root));
    expect(pranzo).toContain("Spesa media per coperto —");
    expect(pranzo).toContain("Food cost —");
    expect(pranzo).toContain("Quota —");
  });

  it("a removed service is listed with its last name", async () => {
    const data = structuredClone(SERVICES_REPORT);
    data.services.push({
      ...data.services[1]!,
      key: "s_0123456789",
      name: "Aperitivo",
      position: null,
    });
    servicesReply = ok(data);
    render(createElement(ReportPage));
    const root = await panel();
    expect(text(rowOf("s_0123456789", root))).toContain("Aperitivo");
  });

  it("Scarica CSV per servizio points to the services export with the same query, for the owner", async () => {
    render(createElement(ReportPage));
    const root = await panel();
    const link = within(root).getByRole("link", { name: "Scarica CSV per servizio" });
    expect(link.getAttribute("href")).toBe("/api/exports/services.csv?period=day&date=2026-11-04");
  });

  it("the chef gets no CSV link", async () => {
    meRole = "chef";
    render(createElement(ReportPage));
    const root = await panel();
    expect(within(root).queryByRole("link", { name: /Scarica CSV/ })).toBeNull();
  });

  it("a failed read says why in the panel place and leaves the KPIs", async () => {
    servicesReply = {
      ok: false,
      status: 422,
      error: { code: "date_in_future", message: "Questa data non è ancora arrivata." },
    };
    render(createElement(ReportPage));
    await screen.findByText("Questo periodo");
    expect(await screen.findByText("Questa data non è ancora arrivata.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Per servizio" })).toBeNull();
  });

  it("a service name is text, never markup", async () => {
    const data = structuredClone(SERVICES_REPORT);
    data.services[0]!.name = "<img src=x onerror=alert(1)>";
    servicesReply = ok(data);
    render(createElement(ReportPage));
    await panel();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("ServicesPanel on its own", () => {
  it("renders the rows in the order of the reply", () => {
    render(createElement(ServicesPanel, { report: SERVICES_REPORT, csvHref: "/x.csv" }));
    const keys = [...document.querySelectorAll("[data-service-key]")].map((e) =>
      e.getAttribute("data-service-key"),
    );
    expect(keys).toEqual(["pranzo", "cena"]);
  });
});
