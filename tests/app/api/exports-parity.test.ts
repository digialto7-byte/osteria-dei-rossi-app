import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsvRecords } from "@/lib/csv/parse";
import { EXPORT_SLUGS, type ExportRole } from "@/server/exports/types";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { EXPORT_QUERIES, exportRpcReplies } from "../../fixtures/exports";
import { expectCsvMatchesJson, pick } from "../../helpers/csv-parity";

// AT1 (unit parity): the same fake replies serve the JSON route(s) and the CSV route with the same query string. The CSV is read back with the M1
// reader and compared with the JSON body, cell by cell. AT2: the formula-leading names of the fixtures are escaped.

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: () => undefined }));

const csvRoute = await import("@/app/api/exports/[file]/route");
const jsonRoutes = {
  kpis: [await import("@/app/api/reports/kpis/route")],
  items: [await import("@/app/api/reports/items/route")],
  avt: [await import("@/app/api/reports/avt/route")],
  "unmapped-items": [await import("@/app/api/reports/unmapped-items/route")],
  "discards-vs-push": [await import("@/app/api/reports/discards-vs-push/route")],
  "push-list": [await import("@/app/api/reports/push-list/route")],
  forecast: [await import("@/app/api/reports/forecast/route")],
  "forecast-plates": [await import("@/app/api/reports/forecast/route")],
  "waste-costs": [await import("@/app/api/stock/waste-costs/route")],
  "count-variance": [
    await import("@/app/api/reports/variance/route"),
    await import("@/app/api/reports/variance-costs/route"),
  ],
  reconciliation: [await import("@/app/api/reports/reconciliation/route")],
} as const;

type Handler = (r: Request, c?: unknown) => Promise<Response>;

function as(role: ExportRole) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: exportRpcReplies(role) });
}

/** What the JSON route(s) answer for a slug and query: one body, or {variance, costs} for count-variance. */
async function jsonOf(slug: (typeof EXPORT_SLUGS)[number], query: string): Promise<unknown> {
  const bodies: unknown[] = [];
  for (const mod of jsonRoutes[slug]) {
    const response = await (mod.GET as Handler)(
      new Request(`http://localhost:3000/api/x${query}`),
      routeContext({}),
    );
    expect(response.status, `${slug} JSON`).toBe(200);
    bodies.push(await response.json());
  }
  return slug === "count-variance" ? { variance: bodies[0], costs: bodies[1] } : bodies[0];
}

async function csvOf(slug: string, query: string) {
  const response = await (csvRoute.GET as Handler)(
    new Request(`http://localhost:3000/api/exports/${slug}.csv${query}`),
    routeContext({ file: `${slug}.csv` }),
  );
  expect(response.status, `${slug} CSV`).toBe(200);
  return parseCsvRecords(await response.text()).map((r) => r.cells);
}

const RUNS: Array<[(typeof EXPORT_SLUGS)[number], ExportRole]> = [
  ...EXPORT_SLUGS.map((slug) => [slug, "owner"] as [(typeof EXPORT_SLUGS)[number], ExportRole]),
  ["items", "admin"],
  ["kpis", "admin"],
];

beforeEach(() => as("owner"));

describe("AT1: the CSV equals the JSON of the same query", () => {
  it.each(RUNS)("%s as %s", async (slug, role) => {
    as(role);
    const query = EXPORT_QUERIES[slug]!;
    const json = await jsonOf(slug, query);
    const csv = await csvOf(slug, query);

    expectCsvMatchesJson(csv, slug, role, json);
  });

  it("the plates of a kpi file equal the JSON's current block (covers row)", async () => {
    const json = await jsonOf("kpis", EXPORT_QUERIES.kpis!);
    const csv = await csvOf("kpis", EXPORT_QUERIES.kpis!);
    const covers = csv.find((line) => line[0] === "covers")!;
    expect(Number(covers[2])).toBe(pick(json, "current", "covers"));
    expect(Number(covers[3])).toBe(pick(json, "previous", "covers"));
    expect(Number(covers[4])).toBe(pick(json, "delta", "covers", "abs"));
  });

  it("amounts keep the JSON precision exactly (4 decimals)", async () => {
    const csv = await csvOf("waste-costs", EXPORT_QUERIES["waste-costs"]!);
    expect(csv.some((line) => line[6] === "38,0002")).toBe(true);
    const items = await csvOf("items", EXPORT_QUERIES.items!);
    expect(items.some((line) => line[5] === "38,0002")).toBe(true);
  });
});

describe("AT2: formula-leading names are escaped in the real files", () => {
  async function body(slug: string) {
    const response = await (csvRoute.GET as Handler)(
      new Request(`http://localhost:3000/api/exports/${slug}.csv${EXPORT_QUERIES[slug]}`),
      routeContext({ file: `${slug}.csv` }),
    );
    return response.text();
  }

  it.each(["items", "unmapped-items"])('%s.csv holds "\'=1+1 (demo)"', async (slug) => {
    expect(await body(slug)).toContain(`"'=1+1 (demo)"`);
  });

  it.each(["avt", "waste-costs", "count-variance", "reconciliation"])(
    '%s.csv holds "\'-Burro (demo)"',
    async (slug) => {
      expect(await body(slug)).toContain(`"'-Burro (demo)"`);
    },
  );

  it("a negative quantity stays a bare number in the same file", async () => {
    const text = await body("avt");
    expect(text).toContain(";-0,5;");
    expect(text).not.toContain(`"'-0,5"`);
  });
});
