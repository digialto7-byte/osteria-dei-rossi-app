import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsvRecords } from "@/lib/csv/parse";
import type { TenantSession } from "@/lib/api/with-api";
import { discardsQuery, forecastQuery, pushListQuery } from "@/server/push/schemas";
import { DISCARDS, FORECAST_EDGE, PUSH_LIST_EDGE } from "../../fixtures/exports";
import { PUSH_LIST_CHEF } from "../../helpers/push-data";

const getPushList = vi.fn();
const getForecast = vi.fn();
const getDiscardsVsPush = vi.fn();
vi.mock("@/server/push/list", () => ({ getPushList: (...a: unknown[]) => getPushList(...a) }));
vi.mock("@/server/push/forecast", () => ({ getForecast: (...a: unknown[]) => getForecast(...a) }));
vi.mock("@/server/push/discards", () => ({
  getDiscardsVsPush: (...a: unknown[]) => getDiscardsVsPush(...a),
}));

const { registry } = await import("@/server/exports/registry");
const { renderCsv } = await import("@/server/exports/render");

const supabase = { tag: "client" } as unknown as SupabaseClient;
const session = (role: "owner" | "admin"): TenantSession => ({
  authId: "a0000000-0000-4000-8000-00000000000a",
  tenantId: "11111111-1111-4111-8111-111111111111",
  role,
});
const url = (q: string) => new URL(`http://localhost:3000/api/exports/x.csv${q}`);
const records = (csv: string) => parseCsvRecords(csv).map((r) => r.cells);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("same parser, same service (ADR-027)", () => {
  it("push-list calls getPushList(supabase, role) and takes no query", async () => {
    expect(registry["push-list"].schema).toBe(pushListQuery);
    getPushList.mockResolvedValue(PUSH_LIST_EDGE);
    const query = registry["push-list"].parse(url(""));
    await registry["push-list"].load(supabase, session("admin"), query);
    expect(getPushList).toHaveBeenCalledTimes(1);
    expect(getPushList).toHaveBeenCalledWith(supabase, "admin");
    expect(() => registry["push-list"].parse(url("?x=1"))).toThrow();
  });

  it("forecast and forecast-plates use forecastQuery and one getForecast call each", async () => {
    expect(registry.forecast.schema).toBe(forecastQuery);
    expect(registry["forecast-plates"].schema).toBe(forecastQuery);
    getForecast.mockResolvedValue(FORECAST_EDGE);
    for (const table of [registry.forecast, registry["forecast-plates"]]) {
      getForecast.mockClear();
      const query = table.parse(url("?date=2026-11-05"));
      expect(query).toEqual({ date: "2026-11-05" });
      await table.load(supabase, session("owner"), query);
      expect(getForecast).toHaveBeenCalledTimes(1);
      expect(getForecast).toHaveBeenCalledWith(supabase, "owner", query);
    }
    expect(() => registry.forecast.parse(url("?date=2026-13-01"))).toThrow();
  });

  it("discards-vs-push uses discardsQuery and getDiscardsVsPush", async () => {
    expect(registry["discards-vs-push"].schema).toBe(discardsQuery);
    getDiscardsVsPush.mockResolvedValue(DISCARDS);
    const query = registry["discards-vs-push"].parse(url("?week=2026-11-04"));
    await registry["discards-vs-push"].load(supabase, session("owner"), query);
    expect(getDiscardsVsPush).toHaveBeenCalledWith(supabase, query);
  });
});

describe("push-list", () => {
  const csv = records(renderCsv(registry["push-list"], PUSH_LIST_EDGE, "owner"));

  it("snapshots the header", () => {
    expect(registry["push-list"].columns("owner").map((c) => c.header)).toMatchSnapshot();
  });

  it("rows keep the API order", () => {
    expect(csv.slice(1).map((r) => r[1])).toEqual(PUSH_LIST_EDGE.rows.map((r) => r.id));
    expect(registry["push-list"].rows(PUSH_LIST_EDGE)).toEqual(PUSH_LIST_EDGE.rows);
  });

  it("consumare_entro is in Rome time: winter and summer fixtures", () => {
    expect(csv[1]![5]).toBe("04/11/2026 20:00");
    expect(csv[2]![5]).toBe("25/10/2026 00:00");
  });

  it("ore_rimaste, quantita and the made-on date are formatted", () => {
    expect(csv[1]![7]).toBe("10");
    expect(csv[1]![8]).toBe("14");
    expect(csv[1]![4]).toBe("02/11/2026");
    expect(csv[2]![8]).toBe("3,2");
  });

  it("piatti lists the names in API order; piatti_in_evidenza only the pushed ones", () => {
    expect(csv[1]![11]).toBe("Spezzatino con polenta (demo) | Tagliatelle al ragù (demo)");
    expect(csv[1]![12]).toBe("Spezzatino con polenta (demo)");
    expect(csv[2]![11]).toBe("");
    expect(csv[2]![12]).toBe("");
  });

  it("preparazioni lists the batch recipes of a lot", () => {
    expect(csv[2]![13]).toBe("Spezzatino (demo) | Ragù (demo)");
    expect(csv[1]![13]).toBe("");
  });

  it("a null cost at risk is an empty cell; a 4-decimal one is kept", () => {
    expect(csv[1]![10]).toBe("38,0002");
    expect(csv[2]![10]).toBe("");
  });

  it("scadenza is empty for a batch and a date for a lot; a null lot code is empty", () => {
    expect(csv[1]![6]).toBe("");
    expect(csv[2]![6]).toBe("25/10/2026");
    expect(csv[2]![3]).toBe("");
  });

  it("refuses the chef's shape: exports are owner and admin only", () => {
    expect(() => registry["push-list"].rows(PUSH_LIST_CHEF as never)).toThrow();
  });

  it("the range is the business date", () => {
    expect(registry["push-list"].range(PUSH_LIST_EDGE)).toBe("2026-11-04");
  });
});

describe("forecast", () => {
  const csv = records(renderCsv(registry.forecast, FORECAST_EDGE, "owner"));

  it("snapshots the header", () => {
    expect(registry.forecast.columns("owner").map((c) => c.header)).toMatchSnapshot();
  });

  it("one row per batch with the reply's date; a null expectation and gap are empty", () => {
    expect(csv).toHaveLength(3);
    expect(csv[1]).toEqual([
      "ec000000-0000-4000-8000-0000000000e1",
      "Spezzatino",
      "05/11/2026",
      "22",
      "14",
      "8",
    ]);
    expect(csv[2]!.slice(3)).toEqual(["", "6", ""]);
  });

  it("carries no covers (a KPI), whatever the reply holds", () => {
    expect(csv.flat().join("|")).not.toMatch(/31/);
    expect(
      registry.forecast
        .columns("owner")
        .map((c) => c.header)
        .join(),
    ).not.toMatch(/coperti|covers/);
  });

  it("the range is the date", () => {
    expect(registry.forecast.range(FORECAST_EDGE)).toBe("2026-11-05");
  });
});

describe("forecast-plates", () => {
  const csv = records(renderCsv(registry["forecast-plates"], FORECAST_EDGE, "owner"));

  it("snapshots the header", () => {
    expect(registry["forecast-plates"].columns("owner").map((c) => c.header)).toMatchSnapshot();
  });

  it("one row per plate; a '=' name is escaped; a fraction is kept", () => {
    expect(csv).toHaveLength(3);
    expect(csv[1]).toEqual([
      "11000000-0000-4000-8000-000000000001",
      "Spezzatino con polenta",
      "05/11/2026",
      "22",
    ]);
    expect(csv[2]![1]).toBe("'=Tagliatelle (demo)");
    expect(csv[2]![3]).toBe("11,5");
  });

  it("the range is the date", () => {
    expect(registry["forecast-plates"].range(FORECAST_EDGE)).toBe("2026-11-05");
  });
});

describe("discards-vs-push", () => {
  it("snapshots the header and writes one row per recipe; the totals are not a row", () => {
    expect(registry["discards-vs-push"].columns("owner").map((c) => c.header)).toMatchSnapshot();
    const csv = records(renderCsv(registry["discards-vs-push"], DISCARDS, "owner"));
    expect(csv).toHaveLength(1 + DISCARDS.rows.length);
    expect(csv[1]).toEqual([
      "ec000000-0000-4000-8000-0000000000e3",
      "Ragù (demo)",
      "72",
      "1",
      "0",
      "5",
      "0",
      "7,5",
      "0",
    ]);
    expect(csv[2]![7]).toBe("8,1429");
    expect(csv.flat()).not.toContain("15,6429");
  });

  it("the range is the ISO week", () => {
    expect(registry["discards-vs-push"].range(DISCARDS)).toBe("2026-11-02_2026-11-08");
  });
});
