import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsvRecords } from "@/lib/csv/parse";
import type { TenantSession } from "@/lib/api/with-api";
import { parseReconciliationQuery, parseVarianceQuery } from "@/server/counts/schemas";
import { EXPORT_SLUGS } from "@/server/exports/types";
import { parseWasteCostsQuery } from "@/server/stock/schemas";
import {
  RECONCILIATION_EDGE,
  VARIANCE_COSTS_EDGE,
  VARIANCE_EDGE,
  WASTE_EDGE,
} from "../../fixtures/exports";

const getWasteCosts = vi.fn();
const getVariance = vi.fn();
const getVarianceCosts = vi.fn();
const getReconciliation = vi.fn();
vi.mock("@/server/stock/waste-costs", () => ({
  getWasteCosts: (...a: unknown[]) => getWasteCosts(...a),
}));
vi.mock("@/server/counts/variance", () => ({
  getVariance: (...a: unknown[]) => getVariance(...a),
}));
vi.mock("@/server/counts/variance-costs", () => ({
  getVarianceCosts: (...a: unknown[]) => getVarianceCosts(...a),
}));
vi.mock("@/server/counts/reconciliation", () => ({
  getReconciliation: (...a: unknown[]) => getReconciliation(...a),
}));

const { registry } = await import("@/server/exports/registry");
const { renderCsv } = await import("@/server/exports/render");

const supabase = { tag: "client" } as unknown as SupabaseClient;
const session: TenantSession = {
  authId: "a0000000-0000-4000-8000-00000000000a",
  tenantId: "11111111-1111-4111-8111-111111111111",
  role: "owner",
};
const url = (q: string) => new URL(`http://localhost:3000/api/exports/x.csv${q}`);
const records = (csv: string) => parseCsvRecords(csv).map((r) => r.cells);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the registry", () => {
  it("has exactly the 11 slugs of the plan, each table naming its own slug", () => {
    expect(Object.keys(registry).sort()).toEqual([...EXPORT_SLUGS].sort());
    for (const [key, table] of Object.entries(registry)) expect(table.slug).toBe(key);
  });
});

describe("waste-costs", () => {
  it("reuses the route's parser and service; the defaults stay the service's", async () => {
    expect(registry["waste-costs"].parse).toBe(parseWasteCostsQuery);
    getWasteCosts.mockResolvedValue(WASTE_EDGE);
    const query = registry["waste-costs"].parse(url(""));
    expect(query).toEqual({ from: null, to: null });
    await registry["waste-costs"].load(supabase, session, query);
    expect(getWasteCosts).toHaveBeenCalledTimes(1);
    expect(getWasteCosts).toHaveBeenCalledWith(supabase, query);
    expect(() => registry["waste-costs"].parse(url("?from=2026-13-01"))).toThrow();
  });

  const csv = records(renderCsv(registry["waste-costs"], WASTE_EDGE, "owner"));

  it("snapshots the header", () => {
    expect(registry["waste-costs"].columns("owner").map((c) => c.header)).toMatchSnapshot();
  });

  it("writes 4 rows: expired raw, expired raw, expired batch, spoilage raw", () => {
    expect(csv).toHaveLength(5);
    expect(csv.slice(1).map((r) => [r[0], r[1], r[3]])).toEqual([
      ["expired", "ingrediente", "'-Burro (demo)"],
      ["expired", "ingrediente", "Manzo (demo)"],
      ["expired", "preparazione", "Spezzatino (demo)"],
      ["spoilage", "ingrediente", "Parmigiano (demo)"],
    ]);
  });

  it("a batch line has the unit 'porz' and its portions as quantity", () => {
    expect(csv[3]).toEqual([
      "expired",
      "preparazione",
      "ec000000-0000-4000-8000-0000000000e1",
      "Spezzatino (demo)",
      "porz",
      "3",
      "12",
      "1",
    ]);
  });

  it("senza_costo comes from unvaluedCount for a batch and from a null value for a raw line", () => {
    expect(csv.slice(1).map((r) => r[7])).toEqual(["0", "1", "1", "0"]);
  });

  it("a null value is an empty cell; a 4-decimal value is kept", () => {
    expect(csv[2]![6]).toBe("");
    expect(csv[4]![6]).toBe("38,0002");
    expect(csv[4]![5]).toBe("0,0001");
  });

  it("the range is the reply's from_to", () => {
    expect(registry["waste-costs"].range(WASTE_EDGE)).toBe("2026-10-01_2026-10-31");
  });

  it("a reply with no reasons is a header only", () => {
    const empty = { ...WASTE_EDGE, reasons: [] };
    expect(records(renderCsv(registry["waste-costs"], empty, "owner"))).toHaveLength(1);
  });
});

describe("count-variance", () => {
  const SESSION = VARIANCE_EDGE.session.id;

  it("reuses the route's parser and calls both services once with the same session", async () => {
    expect(registry["count-variance"].parse).toBe(parseVarianceQuery);
    getVariance.mockResolvedValue(VARIANCE_EDGE);
    getVarianceCosts.mockResolvedValue(VARIANCE_COSTS_EDGE);
    const query = registry["count-variance"].parse(url(`?session=${SESSION}`));
    expect(query).toEqual({ session: SESSION });
    const output = await registry["count-variance"].load(supabase, session, query);
    expect(getVariance).toHaveBeenCalledTimes(1);
    expect(getVariance).toHaveBeenCalledWith(supabase, SESSION);
    expect(getVarianceCosts).toHaveBeenCalledTimes(1);
    expect(getVarianceCosts).toHaveBeenCalledWith(supabase, SESSION);
    expect(output).toEqual({ variance: VARIANCE_EDGE, costs: VARIANCE_COSTS_EDGE });
  });

  it("requires the session, as the JSON route does", () => {
    expect(() => registry["count-variance"].parse(url(""))).toThrow();
    expect(() => registry["count-variance"].parse(url("?session=nope"))).toThrow();
  });

  const output = { variance: VARIANCE_EDGE, costs: VARIANCE_COSTS_EDGE };
  const csv = records(renderCsv(registry["count-variance"], output, "owner"));

  it("snapshots the header", () => {
    expect(registry["count-variance"].columns("owner").map((c) => c.header)).toMatchSnapshot();
  });

  it("joins the cost line of the same ingredient whatever the order", () => {
    expect(csv).toHaveLength(4);
    expect(csv[1]).toEqual([
      "1e000000-0000-4000-8000-0000000000b1",
      "'-Burro (demo)",
      "kg",
      "5",
      "4,5",
      "-0,5",
      "-0,5",
      "-3,8",
    ]);
    expect(csv[2]![7]).toBe("0,2502");
  });

  it("the third line has no cost line: an empty valore_eur, not 0", () => {
    expect(csv[3]![7]).toBe("");
    expect(csv[3]![1]).toBe('Il "Rosso" (demo); riserva');
  });

  it("a cost line whose ingredient is not among the variance lines is an Error, never a silent row", () => {
    const stray = {
      variance: VARIANCE_EDGE,
      costs: {
        ...VARIANCE_COSTS_EDGE,
        lines: [
          ...VARIANCE_COSTS_EDGE.lines,
          { ingredientId: "1e000000-0000-4000-8000-0000000000ff", valueEur: 1 },
        ],
      },
    };
    expect(() => registry["count-variance"].rows(stray)).toThrow(Error);
  });

  it("carries no staff name from the session", () => {
    expect(csv.flat().join("|")).not.toContain("Titolare");
    expect(
      registry["count-variance"]
        .columns("owner")
        .map((c) => c.header)
        .join(),
    ).not.toMatch(/utente|chiuso_da|iniziato_da|staff/);
  });

  it("the range is the Rome date the count was closed", () => {
    expect(registry["count-variance"].range(output)).toBe("2026-10-31");
    const after = {
      ...output,
      variance: {
        ...VARIANCE_EDGE,
        session: { ...VARIANCE_EDGE.session, closedAt: "2026-10-31T23:30:00+00:00" },
      },
    };
    expect(registry["count-variance"].range(after)).toBe("2026-11-01");
  });
});

describe("reconciliation", () => {
  it("reuses the route's parser and service", async () => {
    expect(registry.reconciliation.parse).toBe(parseReconciliationQuery);
    getReconciliation.mockResolvedValue(RECONCILIATION_EDGE);
    const query = registry.reconciliation.parse(url("?from=2026-10-01&to=2026-10-31"));
    await registry.reconciliation.load(supabase, session, query);
    expect(getReconciliation).toHaveBeenCalledTimes(1);
    expect(getReconciliation).toHaveBeenCalledWith(supabase, query);
  });

  const csv = records(renderCsv(registry.reconciliation, RECONCILIATION_EDGE, "owner"));

  it("snapshots the header", () => {
    expect(registry.reconciliation.columns("owner").map((c) => c.header)).toMatchSnapshot();
  });

  it("writes booleans as sì/no and the count time as an instant in Rome time", () => {
    expect(csv[1]).toEqual([
      "1e000000-0000-4000-8000-0000000000b1",
      "'-Burro (demo)",
      "kg",
      "2",
      "10",
      "-6,5",
      "-1,2",
      "0",
      "0",
      "-0,5",
      "0",
      "3,8",
      "sì",
      "4,5",
      "31/10/2026 22:30",
      "c5000000-0000-4000-8000-0000000000c1",
      "0",
      "sì",
    ]);
    expect(csv[2]![12]).toBe("no");
  });

  it("nulls are empty cells: no count, no match", () => {
    expect(csv[2]!.slice(13)).toEqual(["", "", "", "", ""]);
    expect(csv[2]![5]).toBe("0");
  });

  it("the range is the reply's from_to", () => {
    expect(registry.reconciliation.range(RECONCILIATION_EDGE)).toBe("2026-10-01_2026-10-31");
  });
});
