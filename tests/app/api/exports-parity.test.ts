import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsvRecords } from "@/lib/csv/parse";
import { registry } from "@/server/exports/registry";
import { EXPORT_SLUGS, type AnyExportTable, type ExportRole } from "@/server/exports/types";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { EXPORT_QUERIES, exportRpcReplies } from "../../fixtures/exports";

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

const pick = (json: unknown, ...path: string[]): unknown =>
  path.reduce((o, k) => (o as Record<string, unknown>)[k], json);
const len = (json: unknown, ...path: string[]) => (pick(json, ...path) as unknown[]).length;

/** The JSON row count each export must have, independent of the registry's own `rows`. */
function expectedCount(slug: string, json: unknown): number {
  switch (slug) {
    case "kpis":
      return 54;
    case "forecast":
      return len(json, "batches");
    case "forecast-plates":
      return len(json, "plates");
    case "waste-costs":
      return (pick(json, "reasons") as { lines: unknown[]; batchLines: unknown[] }[]).reduce(
        (n, r) => n + r.lines.length + r.batchLines.length,
        0,
      );
    case "count-variance":
      return len(json, "variance", "lines");
    case "reconciliation":
      return len(json, "items");
    default:
      return len(json, "rows");
  }
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
    const table = registry[slug] as AnyExportTable;
    const csv = await csvOf(slug, query);

    const columns = table.columns(role);
    expect(csv[0]).toEqual(columns.map((c) => c.header));
    const rows = table.rows(json);
    expect(csv.length - 1).toBe(rows.length);
    expect(rows.length).toBe(expectedCount(slug, json));

    rows.forEach((row, r) => {
      columns.forEach((column, c) => {
        const typed = column.cell(row);
        const written = csv[r + 1]![c]!;
        const where = `${slug} row ${r} ${column.header}`;
        if (typed.value === null) return expect(written, where).toBe("");
        switch (typed.kind) {
          case "number":
            expect(Number(written.replace(",", ".")), where).toBe(typed.value);
            break;
          case "date": {
            const [d, m, y] = written.split("/");
            expect(`${y}-${m}-${d}`, where).toBe(typed.value);
            break;
          }
          case "bool":
            expect(written, where).toBe(typed.value ? "sì" : "no");
            break;
          case "instant":
            expect(written, where).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
            break;
          case "text":
            expect(written, where).toBe(
              /^[=+\-@\t\r]/.test(typed.value) ? `'${typed.value}` : typed.value,
            );
            break;
        }
      });
    });
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
