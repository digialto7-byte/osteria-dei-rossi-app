import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsvRecords } from "@/lib/csv/parse";
import type { TenantSession } from "@/lib/api/with-api";
import { avtQuery, periodQuery, unmappedQuery } from "@/server/reports/schemas";
import {
  AVT_EDGE,
  ITEMS_ADMIN_EDGE,
  ITEMS_OWNER_EDGE,
  KPI_REPORT,
  UNMAPPED_EDGE,
} from "../../fixtures/exports";

const getKpiReport = vi.fn();
const getKpiItems = vi.fn();
const getAvtReport = vi.fn();
const getUnmappedItems = vi.fn();
vi.mock("@/server/reports/kpis", () => ({ getKpiReport: (...a: unknown[]) => getKpiReport(...a) }));
vi.mock("@/server/reports/items", () => ({ getKpiItems: (...a: unknown[]) => getKpiItems(...a) }));
vi.mock("@/server/reports/avt", () => ({ getAvtReport: (...a: unknown[]) => getAvtReport(...a) }));
vi.mock("@/server/reports/unmapped", () => ({
  getUnmappedItems: (...a: unknown[]) => getUnmappedItems(...a),
}));

const { registry } = await import("@/server/exports/registry");
const { KPI_CSV_ROWS } = await import("@/server/exports/tables/kpis");
const { renderCsv } = await import("@/server/exports/render");

const supabase = { tag: "client" } as unknown as SupabaseClient;
const session = (role: "owner" | "admin"): TenantSession => ({
  authId: "a0000000-0000-4000-8000-00000000000a",
  tenantId: "11111111-1111-4111-8111-111111111111",
  role,
});
const url = (q: string) => new URL(`http://localhost:3000/api/exports/x.csv${q}`);

/** The parsed CSV records (header first) of a table's output. */
function records(csv: string) {
  return parseCsvRecords(csv).map((r) => r.cells);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("same parser, same service (ADR-027)", () => {
  it("kpis uses periodQuery (identity) and calls getKpiReport once with the parsed query", async () => {
    expect(registry.kpis.schema).toBe(periodQuery);
    getKpiReport.mockResolvedValue(KPI_REPORT);
    const query = registry.kpis.parse(url("?period=month&date=2026-10-15"));
    expect(query).toEqual({ period: "month", date: "2026-10-15" });
    const output = await registry.kpis.load(supabase, session("owner"), query);
    expect(output).toBe(KPI_REPORT);
    expect(getKpiReport).toHaveBeenCalledTimes(1);
    expect(getKpiReport).toHaveBeenCalledWith(supabase, query);
  });

  it("items uses periodQuery and calls getKpiItems with the caller's role", async () => {
    expect(registry.items.schema).toBe(periodQuery);
    getKpiItems.mockResolvedValue(ITEMS_ADMIN_EDGE);
    const query = registry.items.parse(url("?period=week"));
    await registry.items.load(supabase, session("admin"), query);
    expect(getKpiItems).toHaveBeenCalledTimes(1);
    expect(getKpiItems).toHaveBeenCalledWith(supabase, "admin", query);
    await registry.items.load(supabase, session("owner"), query);
    expect(getKpiItems).toHaveBeenLastCalledWith(supabase, "owner", query);
  });

  it("avt uses avtQuery and getAvtReport", async () => {
    expect(registry.avt.schema).toBe(avtQuery);
    getAvtReport.mockResolvedValue(AVT_EDGE);
    const query = registry.avt.parse(url("?count=c5000000-0000-4000-8000-000000000002"));
    await registry.avt.load(supabase, session("owner"), query);
    expect(getAvtReport).toHaveBeenCalledWith(supabase, query);
  });

  it("unmapped-items uses unmappedQuery and getUnmappedItems", async () => {
    expect(registry["unmapped-items"].schema).toBe(unmappedQuery);
    getUnmappedItems.mockResolvedValue(UNMAPPED_EDGE);
    const query = registry["unmapped-items"].parse(url("?week=2026-11-04"));
    await registry["unmapped-items"].load(supabase, session("owner"), query);
    expect(getUnmappedItems).toHaveBeenCalledWith(supabase, query);
  });

  it("the parsers keep the JSON route's strictness (unknown key, repeated key, bad value)", () => {
    expect(() => registry.kpis.parse(url("?foo=1"))).toThrow();
    expect(() => registry.kpis.parse(url("?period=day&period=week"))).toThrow();
    expect(() => registry.kpis.parse(url("?period=year"))).toThrow();
    expect(() => registry.avt.parse(url("?count=nope"))).toThrow();
  });
});

describe("kpis", () => {
  const rows = registry.kpis.rows(KPI_REPORT);
  const byKey = (key: string) => rows.find((r) => r.key === key)!;

  it("has 54 fixed rows in KPI_CSV_ROWS order: 23 figures, 24 hours, 7 weekdays", () => {
    expect(KPI_CSV_ROWS).toHaveLength(54);
    expect(rows.map((r) => r.key)).toEqual(KPI_CSV_ROWS.map((r) => r.key));
    expect(rows.slice(23, 47).map((r) => r.key)).toEqual(
      Array.from({ length: 24 }, (_, h) => `coversByHour.${String(h).padStart(2, "0")}`),
    );
    expect(rows.slice(47).map((r) => r.key)).toEqual(
      [1, 2, 3, 4, 5, 6, 7].map((d) => `coversByWeekday.${d}`),
    );
    expect(new Set(rows.map((r) => r.key)).size).toBe(54);
  });

  it("the revenueNetEur row carries the current value, the previous one and the delta", () => {
    const row = byKey("revenueNetEur");
    expect(row.current).toBe(KPI_REPORT.current.revenueNetEur);
    expect(row.previous).toBe(KPI_REPORT.previous.revenueNetEur);
    expect(row.delta).toEqual(KPI_REPORT.delta.revenueNetEur);
    const csv = records(renderCsv(registry.kpis, KPI_REPORT, "owner"));
    const line = csv.find((c) => c[0] === "revenueNetEur")!;
    expect(line[2]).toBe("119,1281");
    expect(line[3]).toBe("45,4545");
    expect(line[4]).toBe("73,6736");
    expect(line[5]).toBe("162,1");
  });

  it("copertoNetEur has empty delta cells (it is not one of the 12 delta keys)", () => {
    const csv = records(renderCsv(registry.kpis, KPI_REPORT, "owner"));
    const line = csv.find((c) => c[0] === "copertoNetEur")!;
    expect(line.slice(4)).toEqual(["", ""]);
    expect(line[2]).toBe("9,0909");
  });

  it("only the 12 delta keys fill the delta columns", () => {
    const csv = records(renderCsv(registry.kpis, KPI_REPORT, "owner")).slice(1);
    expect(csv.filter((c) => c[4] !== "")).toHaveLength(12);
  });

  it("the covers-by-hour row 20 is current.coversByHour[20]; weekday 1 is index 0 (Monday)", () => {
    expect(byKey("coversByHour.20").current).toBe(KPI_REPORT.current.coversByHour[20]);
    expect(byKey("coversByHour.20").previous).toBe(KPI_REPORT.previous.coversByHour[20]);
    expect(byKey("coversByWeekday.1").current).toBe(KPI_REPORT.current.coversByWeekday[0]);
    expect(byKey("coversByWeekday.3").current).toBe(KPI_REPORT.current.coversByWeekday[2]);
    expect(byKey("coversByWeekday.7").current).toBe(KPI_REPORT.current.coversByWeekday[6]);
  });

  it("a null avgTicketEur gives an empty cell, never 0", () => {
    const output = {
      ...KPI_REPORT,
      current: { ...KPI_REPORT.current, avgTicketEur: null },
    };
    const csv = records(renderCsv(registry.kpis, output, "owner"));
    expect(csv.find((c) => c[0] === "avgTicketEur")![2]).toBe("");
  });

  it("a null register total and difference are empty cells", () => {
    const csv = records(renderCsv(registry.kpis, KPI_REPORT, "owner"));
    const register = csv.find((c) => c[0] === "registerTotalEur")!;
    expect(register[3]).toBe("");
    expect(csv.find((c) => c[0] === "appVsRegisterDiffEur")![3]).toBe("");
  });

  it("has the header and range of the plan", () => {
    expect(registry.kpis.columns("owner").map((c) => c.header)).toMatchSnapshot();
    expect(registry.kpis.range(KPI_REPORT)).toBe("2026-11-04_2026-11-04");
    const october = {
      ...KPI_REPORT,
      current: { ...KPI_REPORT.current, from: "2026-10-01", to: "2026-10-31" },
    };
    expect(registry.kpis.range(october)).toBe("2026-10-01_2026-10-31");
  });

  it("the admin gets the same columns", () => {
    expect(registry.kpis.columns("admin").map((c) => c.header)).toEqual(
      registry.kpis.columns("owner").map((c) => c.header),
    );
  });
});

describe("items", () => {
  it("the owner header ends with the four fixed-cost columns; the admin has none of them", () => {
    const owner = registry.items.columns("owner").map((c) => c.header);
    const admin = registry.items.columns("admin").map((c) => c.header);
    expect(owner.slice(-4)).toEqual([
      "costo_fisso_per_piatto_eur",
      "margine_lordo_per_piatto_eur",
      "contributo_eur",
      "motivo_costo_fisso",
    ]);
    expect(admin).toHaveLength(14);
    expect(admin).toEqual(owner.slice(0, 14));
    expect(admin.join()).not.toMatch(/costo_fisso|margine_lordo|contributo/);
    expect({ owner, admin }).toMatchSnapshot();
  });

  it("the weight columns are the last base columns, before the owner-only ones (P2-0b)", () => {
    const admin = registry.items.columns("admin").map((c) => c.header);
    expect(admin.slice(-3)).toEqual(["stato", "peso_venduto_g", "peso_medio_g"]);
    const owner = registry.items.columns("owner").map((c) => c.header);
    expect(owner.indexOf("peso_medio_g")).toBe(13);
    expect(owner.indexOf("costo_fisso_per_piatto_eur")).toBe(14);
  });

  it("a weighted item has its weight sold and average weight in grams; the others have empty cells", () => {
    const csv = records(renderCsv(registry.items, ITEMS_ADMIN_EDGE, "admin"));
    const quoted = csv.find((c) => c[1] === 'Il "Rosso" (demo); riserva')!;
    expect(quoted.slice(12)).toEqual(["2450", "1225"]);
    const formula = csv.find((c) => c[1] === "'=1+1 (demo)")!;
    expect(formula.slice(12)).toEqual(["", ""]);
  });

  it("no admin row has more than 14 cells, and no fixed cost reaches the admin file", () => {
    const csv = records(renderCsv(registry.items, ITEMS_ADMIN_EDGE, "admin"));
    for (const line of csv) expect(line).toHaveLength(14);
    expect(csv.flat().join("|")).not.toMatch(/fixed/i);
  });

  it("the owner file has 18 cells per row", () => {
    const csv = records(renderCsv(registry.items, ITEMS_OWNER_EDGE, "owner"));
    for (const line of csv) expect(line).toHaveLength(18);
  });

  it("null foodCostEur and margin are empty cells; the status and the reason are the raw values", () => {
    const csv = records(renderCsv(registry.items, ITEMS_OWNER_EDGE, "owner"));
    const formula = csv.find((c) => c[1] === "'=1+1 (demo)")!;
    expect(formula[8]).toBe("");
    expect(formula[9]).toBe("");
    expect(formula[10]).toBe("");
    expect(formula[11]).toBe("unmapped");
    expect(formula[17]).toBe("no_sales");
    expect(formula[5]).toBe("38,0002");
  });

  it("an owner column on an admin reply is a programming error, not a silent blank", () => {
    expect(() => renderCsv(registry.items, ITEMS_ADMIN_EDGE, "owner")).toThrow();
  });

  it("the range is the reply's from_to", () => {
    expect(registry.items.range(ITEMS_ADMIN_EDGE)).toBe("2026-11-04_2026-11-04");
    expect(
      registry.items.range({ ...ITEMS_ADMIN_EDGE, from: "2026-11-02", to: "2026-11-08" }),
    ).toBe("2026-11-02_2026-11-08");
  });
});

describe("avt", () => {
  it("snapshots the header; a negative variance stays a number and a '-' name is escaped", () => {
    expect(registry.avt.columns("owner").map((c) => c.header)).toMatchSnapshot();
    const csv = records(renderCsv(registry.avt, AVT_EDGE, "owner"));
    const burro = csv.find((c) => c[0] === AVT_EDGE.rows[0]!.ingredientId)!;
    expect(burro[1]).toBe("'-Burro (demo)");
    expect(burro[6]).toBe("-0,5");
    expect(burro[8]).toBe("-3,8");
    expect(csv.find((c) => c[8] === "38,0002")).toBeDefined();
  });

  it("a null unit cost and variance are empty cells", () => {
    const csv = records(renderCsv(registry.avt, AVT_EDGE, "owner"));
    const lievito = csv.find((c) => c[1] === "Lievito (demo)")!;
    expect(lievito.slice(7)).toEqual(["", ""]);
  });

  it("the range is the Rome date of the count's close", () => {
    expect(registry.avt.range(AVT_EDGE)).toBe("2026-11-30");
    const late = {
      ...AVT_EDGE,
      count: { ...AVT_EDGE.count, closedAt: "2026-10-31T23:30:00+00:00" },
    };
    expect(registry.avt.range(late)).toBe("2026-11-01");
  });
});

describe("unmapped-items", () => {
  it("snapshots the header; a '=' name is escaped; the last sale is a date", () => {
    expect(registry["unmapped-items"].columns("owner").map((c) => c.header)).toMatchSnapshot();
    const csv = records(renderCsv(registry["unmapped-items"], UNMAPPED_EDGE, "owner"));
    expect(csv[1]).toEqual([
      "11000000-0000-4000-8000-0000000000f1",
      "'=1+1 (demo)",
      "2",
      "6,5",
      "04/11/2026",
    ]);
  });

  it("the range is the ISO week", () => {
    expect(registry["unmapped-items"].range(UNMAPPED_EDGE)).toBe("2026-11-02_2026-11-08");
  });
});
