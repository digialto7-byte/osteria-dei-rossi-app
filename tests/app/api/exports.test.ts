import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPORT_SLUGS } from "@/server/exports/types";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import {
  EXPORT_QUERIES,
  FIXTURE_STAFF_NAMES,
  KPI_REPORT,
  exportRpcReplies,
} from "../../fixtures/exports";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/exports/[file]/route");
const BASE = "http://localhost:3000/api/exports";
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, replies: Record<string, FakeResult[]> = exportRpcReplies("owner")) {
  client = fakeSupabase({ claims: role === "none" ? null : claimsFor(role), rpc: replies });
}
const get = (file: string, query = "") =>
  (route.GET as (r: Request, c: unknown) => Promise<Response>)(
    new Request(`${BASE}/${file}${query}`),
    routeContext({ file }),
  );
/** The first three bytes of the body: `Response.text()` drops a BOM, so the bytes are the only honest check. */
const firstBytes = async (response: Response) => [
  ...new Uint8Array(await response.clone().arrayBuffer()).slice(0, 3),
];
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("AT4: only the owner and the admin export", () => {
  it.each(EXPORT_SLUGS.flatMap((slug) => ["chef", "waiter"].map((role) => [slug, role])))(
    "%s: %s gets 403 and no RPC runs",
    async (slug, role) => {
      as(role!);
      const response = await get(`${slug}.csv`, EXPORT_QUERIES[slug!]);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toBe("forbidden");
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it.each(EXPORT_SLUGS)("%s: no session is a 401 without an RPC", async (slug) => {
    as("none");
    const response = await get(`${slug}.csv`, EXPORT_QUERIES[slug]);
    expect(response.status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a chef asking for an unknown file gets 403, which reveals nothing", async () => {
    as("chef");
    expect((await get("foo.csv")).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("unknown files", () => {
  it.each(["foo.csv", "kpis.json", "KPIS.csv", "kpis", "kpis.csv.csv", "../kpis.csv", ".csv"])(
    "%s is a 404 without an RPC",
    async (file) => {
      const response = await get(file);
      expect(response.status).toBe(404);
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("monthly-pack.csv is not an export (the pack is a static route)", async () => {
    expect((await get("monthly-pack.csv")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("the JSON endpoint's query rules", () => {
  it.each([
    ["kpis.csv", "?period=year"],
    ["kpis.csv", "?foo=1"],
    ["kpis.csv", "?period=day&period=week"],
    ["count-variance.csv", ""],
    ["count-variance.csv", "?session=nope"],
    ["forecast.csv", "?date=2026-13-01"],
    ["forecast-plates.csv", "?date=2026-13-01"],
    ["avt.csv", "?count=nope"],
    ["push-list.csv", "?x=1"],
    ["waste-costs.csv", "?from=2026-10-01&bogus=1"],
    ["reconciliation.csv", "?location=nope"],
  ])("%s%s is a 400 without an RPC", async (file, query) => {
    const response = await get(file, query);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("a successful export", () => {
  it("is a UTF-8 CSV attachment with the plan's headers", async () => {
    const october = {
      ...KPI_REPORT,
      current: { ...KPI_REPORT.current, from: "2026-10-01", to: "2026-10-31" },
    };
    as("owner", { ...exportRpcReplies("owner"), kpi_report: [{ data: october, error: null }] });
    const response = await get("kpis.csv", "?period=month&date=2026-10-15");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="report-kpis-2026-10-01_2026-10-31.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(
      /^auth;dur=[\d.]+, rpc;dur=[\d.]+, total;dur=[\d.]+$/,
    );
    expect(await firstBytes(response)).toEqual([0xef, 0xbb, 0xbf]);
    const body = await response.text();
    expect(body.split("\r\n")[0]).toBe(
      "chiave;voce;valore;valore_precedente;differenza;differenza_pct",
    );
    expect(body.endsWith("\r\n")).toBe(true);
  });

  it("passes the parsed query on to the same RPC as the JSON endpoint", async () => {
    await get("kpis.csv", "?period=month&date=2026-10-15");
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("kpi_report", {
      p_period: "month",
      p_date: "2026-10-15",
      p_from: null,
      p_to: null,
    });
  });

  it.each(EXPORT_SLUGS)(
    "%s: one RPC (two for count-variance) and a BOM-first body",
    async (slug) => {
      const response = await get(`${slug}.csv`, EXPORT_QUERIES[slug]);
      expect(response.status).toBe(200);
      expect(client.rpc).toHaveBeenCalledTimes(slug === "count-variance" ? 2 : 1);
      expect(await firstBytes(response)).toEqual([0xef, 0xbb, 0xbf]);
      expect(response.headers.get("content-disposition")).toMatch(
        new RegExp(`^attachment; filename="report-${slug}-[0-9_-]+\\.csv"$`),
      );
    },
  );

  it("the admin's items file has no fixed-cost column", async () => {
    as("admin", exportRpcReplies("admin"));
    const body = await (await get("items.csv", EXPORT_QUERIES.items)).text();
    expect(body.split("\r\n")[0]).not.toMatch(/costo_fisso|margine_lordo|contributo/);
    as("owner");
    const owner = await (await get("items.csv", EXPORT_QUERIES.items)).text();
    expect(owner.split("\r\n")[0]).toMatch(/costo_fisso_per_piatto_eur/);
  });
});

describe("errors pass through as JSON with the JSON route's status", () => {
  it("kpi_report date_in_future is a 422 JSON", async () => {
    as("owner", { ...exportRpcReplies("owner"), kpi_report: [failure("P0001", "date_in_future")] });
    const response = await get("kpis.csv", "?period=day&date=2030-01-01");
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(await errorOf(response)).toBe("date_in_future");
  });

  it("a reply with an unknown key is a 500 report_unavailable and the key never reaches the body", async () => {
    const poisoned = { ...KPI_REPORT, secretUnitCost: 99 };
    as("owner", { ...exportRpcReplies("owner"), kpi_report: [{ data: poisoned, error: null }] });
    const response = await get("kpis.csv", "?period=day");
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("report_unavailable");
    expect(text).not.toContain("secretUnitCost");
  });

  it("a cost line the variance does not know is a 500, not a silent row", async () => {
    const replies = exportRpcReplies("owner");
    replies.count_variance_costs = [
      {
        data: {
          sessionId: "c5000000-0000-4000-8000-0000000000c1",
          valueEur: 1,
          lossEur: 0,
          gainEur: 1,
          unvaluedCount: 0,
          lines: [{ ingredientId: "1e000000-0000-4000-8000-0000000000ff", valueEur: 1 }],
        },
        error: null,
      },
    ];
    as("owner", replies);
    const response = await get("count-variance.csv", EXPORT_QUERIES["count-variance"]);
    expect(response.status).toBe(500);
  });
});

describe("no personal data in any file", () => {
  it("no header names a person and no fixture staff name appears in any body", async () => {
    for (const slug of EXPORT_SLUGS) {
      const body = await (await get(`${slug}.csv`, EXPORT_QUERIES[slug])).text();
      const header = body.split("\r\n")[0]!;
      expect(header, slug).not.toMatch(/utente|display|staff|cameriere|chiuso_da|inserito_da/);
      for (const name of FIXTURE_STAFF_NAMES) expect(body, slug).not.toContain(name);
    }
  });
});
