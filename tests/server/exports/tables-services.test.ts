import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsvRecords } from "@/lib/csv/parse";
import type { TenantSession } from "@/lib/api/with-api";
import { periodQuery } from "@/server/reports/schemas";
import { EXPORT_SLUGS } from "@/server/exports/types";
import { SERVICES_REPORT } from "../../helpers/services-data";

const getServicesReport = vi.fn();
vi.mock("@/server/services/report", () => ({
  getServicesReport: (...a: unknown[]) => getServicesReport(...a),
}));

const { registry } = await import("@/server/exports/registry");
const { renderCsv } = await import("@/server/exports/render");

const supabase = { tag: "client" } as unknown as SupabaseClient;
const session = (role: "owner" | "admin"): TenantSession => ({
  authId: "a0000000-0000-4000-8000-00000000000a",
  tenantId: "11111111-1111-4111-8111-111111111111",
  role,
});
const url = (q: string) => new URL(`http://localhost:3000/api/exports/services.csv${q}`);
const records = (csv: string) => parseCsvRecords(csv).map((r) => r.cells);

beforeEach(() => vi.clearAllMocks());

describe("services.csv: same parser, same service (ADR-027)", () => {
  it("is one of the 12 slugs", () => {
    expect(EXPORT_SLUGS).toHaveLength(12);
    expect(EXPORT_SLUGS).toContain("services");
    expect(registry.services.slug).toBe("services");
  });

  it("uses periodQuery (identity) and calls getServicesReport once with the parsed query", async () => {
    expect(registry.services.schema).toBe(periodQuery);
    getServicesReport.mockResolvedValue(SERVICES_REPORT);
    const query = registry.services.parse(url("?period=day&date=2026-11-04"));
    expect(query).toEqual({ period: "day", date: "2026-11-04" });
    const output = await registry.services.load(supabase, session("owner"), query);
    expect(output).toBe(SERVICES_REPORT);
    expect(getServicesReport).toHaveBeenCalledTimes(1);
    expect(getServicesReport).toHaveBeenCalledWith(supabase, query);
  });

  it("refuses what the JSON route refuses (a strict query)", () => {
    expect(() => registry.services.parse(url("?period=year"))).toThrow();
    expect(() => registry.services.parse(url("?foo=1"))).toThrow();
  });
});

describe("services.csv: the table", () => {
  const render = (output: unknown = SERVICES_REPORT, role: "owner" | "admin" = "owner") =>
    renderCsv(registry.services, output, role);

  it("has the header of the plan, the same for owner and admin", () => {
    const header = records(render(SERVICES_REPORT, "owner"))[0];
    expect(header).toEqual([
      "chiave",
      "servizio",
      "coperti",
      "tavoli",
      "incasso_lordo_eur",
      "incasso_netto_eur",
      "spesa_media_coperto_eur",
      "scontrino_medio_eur",
      "piatti",
      "food_cost_eur",
      "food_cost_pct",
      "quota_incasso_pct",
    ]);
    expect(records(render(SERVICES_REPORT, "admin"))[0]).toEqual(header);
  });

  it("writes the services in the reply's order, then a Totale row with an empty key (3 rows for the fixture)", () => {
    const rows = records(render()).slice(1);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r[0], r[1]])).toEqual([
      ["pranzo", "Pranzo"],
      ["cena", "Cena"],
      ["", "Totale"],
    ]);
  });

  it("writes the shares and amounts with a decimal comma", () => {
    const [pranzo, cena, total] = records(render()).slice(1);
    expect(pranzo![11]).toBe("12,08");
    expect(cena![11]).toBe("87,92");
    expect(total![11]).toBe("100");
    expect(pranzo![5]).toBe("16,3637");
    expect(total![2]).toBe("7");
  });

  it("an unknown ratio is an empty cell, never 0", () => {
    const data = structuredClone(SERVICES_REPORT);
    Object.assign(data.services[0]!, {
      covers: 0,
      tables: 0,
      avgSpendPerCoverEur: null,
      avgTicketEur: null,
      foodCostPct: null,
      revenueSharePct: null,
    });
    const pranzo = records(render(data))[1]!;
    expect(pranzo[6]).toBe("");
    expect(pranzo[7]).toBe("");
    expect(pranzo[10]).toBe("");
    expect(pranzo[11]).toBe("");
    expect(pranzo[2]).toBe("0");
  });

  it('a service named "=Brunch (demo)" is written with a leading apostrophe', () => {
    const data = structuredClone(SERVICES_REPORT);
    data.services[0]!.name = "=Brunch (demo)";
    const csv = render(data);
    expect(csv).toContain(`"'=Brunch (demo)"`);
    expect(records(csv)[1]![1]).toBe("'=Brunch (demo)");
  });

  it("a name with the separator and a quote survives", () => {
    const data = structuredClone(SERVICES_REPORT);
    data.services[1]!.name = 'Cena; "tarda"';
    expect(records(render(data))[2]![1]).toBe('Cena; "tarda"');
  });

  it("the file name is report-services-<date> for a day and <from>_<to> for a longer period", () => {
    expect(registry.services.range(SERVICES_REPORT)).toBe("2026-11-04");
    expect(
      registry.services.range({ ...SERVICES_REPORT, from: "2026-11-02", to: "2026-11-08" }),
    ).toBe("2026-11-02_2026-11-08");
  });

  it("matches its snapshot", () => {
    expect(render()).toMatchSnapshot();
  });

  it("names no person", () => {
    const body = render();
    expect(body.split("\r\n")[0]).not.toMatch(/utente|display|staff|cameriere|chiuso_da/);
  });
});
