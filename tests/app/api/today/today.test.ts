import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import { ALERT_LIST_PAGE_SIZE } from "@/server/alerts/constants";
import { TODAY_ALERT_CAP } from "@/server/today/constants";
import { todaySchema } from "@/server/today/types";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const todayRoute = await import("@/app/api/today/route");
const alertsRoute = await import("@/app/api/alerts/route");

const BASE = "http://localhost:3000/api/today";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

// What public.today_counts() returns (supabase/migrations/20261107100000_today_counts.sql).
const OWNER_COUNTS = {
  invoicesToReview: 2,
  payablesOverdue: 1,
  payablesUnpaid: 4,
  batchesUseBy: 3,
  countOpen: true,
  setup: {
    hasLocations: true,
    hasSuppliers: false,
    hasIngredients: false,
    hasApprovedInvoice: false,
    hasStaff: true,
    hasDevice: false,
    hasTables: true,
    hasMenuItems: false,
  },
};
const CHEF_COUNTS = { batchesUseBy: 3, countOpen: false };

const alertRow = (n: number, costBearing = false) => ({
  id: `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  kind: "test_alert",
  severity: "info",
  entity_type: "tenant",
  entity_id: "11111111-1111-4111-8111-111111111111",
  business_date: "2026-10-25",
  created_at: `2026-10-25T00:${String(n % 60).padStart(2, "0")}:00+00:00`,
  payload: {},
  cost_bearing: costBearing,
  acknowledged_at: null,
  acknowledged_by: null,
  acknowledger: null,
});

function as(
  role: string,
  { counts, alerts = [ok([])] }: { counts?: FakeResult[]; alerts?: FakeResult[] } = {},
) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    results: { alert: alerts },
    rpc: {
      today_counts: counts ?? [ok(role === "chef" ? CHEF_COUNTS : OWNER_COUNTS)],
    },
  });
}
const get = (query = "") =>
  (todayRoute.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));
const noQueries = () => {
  expect(client.from).not.toHaveBeenCalled();
  expect(client.rpc).not.toHaveBeenCalled();
};
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)])
      : [];

beforeEach(() => {
  reportError.mockClear();
});

describe("GET /api/today: who and what", () => {
  it("refuses the waiter with 403 before any query", async () => {
    as("waiter");
    const response = await get();
    expect(response.status).toBe(403);
    noQueries();
  });

  it("refuses a visitor with 401 before any query", async () => {
    as("none");
    expect((await get()).status).toBe(401);
    noQueries();
  });

  it.each(["?x=1", "?filter=open", "?locale=en", "?"])(
    "answers a query string (%s) with 400 and reads nothing",
    async (query) => {
      as("owner");
      const response = await get(query);
      if (query === "?") expect(response.status).toBe(200);
      else {
        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
          "invalid_request",
        );
        noQueries();
      }
    },
  );
});

describe("GET /api/today: shapes", () => {
  it("owner: the six cards in order, then the set-up list, matching the schema", async () => {
    as("owner", { alerts: [ok([alertRow(1), alertRow(2)])] });
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(todaySchema.parse(body)).toEqual(body);
    expect(body.cards).toEqual([
      { key: "alerts", count: 2, more: false, href: "/avvisi" },
      { key: "invoicesToReview", count: 2, more: false, href: "/fatture" },
      { key: "payablesOverdue", count: 1, more: false, href: "/pagamenti" },
      { key: "payablesUnpaid", count: 4, more: false, href: "/pagamenti" },
      { key: "batchesUseBy", count: 3, more: false, href: "/produzione" },
      { key: "countOpen", count: 1, more: false, href: "/magazzino/conteggi" },
    ]);
    expect(body.setup).toEqual([
      { key: "locations", done: true, href: "/anagrafiche/ubicazioni" },
      { key: "suppliers", done: false, href: "/anagrafiche/fornitori" },
      { key: "ingredients", done: false, href: "/anagrafiche/ingredienti" },
      { key: "invoice", done: false, href: "/fatture" },
      { key: "staff", done: true, href: "/personale" },
      { key: "device", done: false, href: "/dispositivi" },
      { key: "tables", done: true, href: "/tavoli/impostazioni" },
      { key: "menu", done: false, href: "/menu" },
    ]);
  });

  it("admin: the same without the alerts card, and the alert table is not read", async () => {
    as("admin");
    const body = await (await get()).json();
    expect(todaySchema.parse(body)).toEqual(body);
    expect(body.cards.map((c: { key: string }) => c.key)).toEqual([
      "invoicesToReview",
      "payablesOverdue",
      "payablesUnpaid",
      "batchesUseBy",
      "countOpen",
    ]);
    expect(body.setup).toHaveLength(8);
    expect(client.from).not.toHaveBeenCalledWith("alert");
  });

  it("chef: alerts, batches and the count; setup is null; no invoice, payable or money key", async () => {
    as("chef", { alerts: [ok([alertRow(1)])] });
    const body = await (await get()).json();
    expect(todaySchema.parse(body)).toEqual(body);
    expect(body).toEqual({
      cards: [
        { key: "alerts", count: 1, more: false, href: "/avvisi" },
        { key: "batchesUseBy", count: 3, more: false, href: "/produzione" },
        { key: "countOpen", count: 0, more: false, href: "/magazzino/conteggi" },
      ],
      setup: null,
    });
    expect(JSON.stringify(body)).not.toMatch(/fatture|pagamenti|costi|€/);
  });

  it.each(["owner", "admin", "chef"])("%s: no key anywhere is about money", async (role) => {
    as(role, { alerts: [ok([alertRow(1)])] });
    const body = await (await get()).json();
    const bad = keysOf(body).filter((k) => /cost|amount|eur|price|margin/i.test(k));
    expect(bad).toEqual([]);
  });

  it("the schema itself refuses a money key", () => {
    expect(() =>
      todaySchema.parse({
        cards: [{ key: "payablesUnpaid", count: 1, more: false, href: "/pagamenti", amount: 10 }],
        setup: null,
      }),
    ).toThrow();
  });
});

describe("GET /api/today: the alert count", () => {
  it("reads open alerts, newest first, at most the cap plus one", async () => {
    as("owner");
    await get();
    expect(client.from).toHaveBeenCalledWith("alert");
    expect(client.query.is).toHaveBeenCalledWith("acknowledged_at", null);
    expect(client.query.limit).toHaveBeenCalledWith(TODAY_ALERT_CAP + 1);
  });

  it("the cap is the size of one page of /avvisi, so the two cannot drift", () => {
    expect(TODAY_ALERT_CAP).toBe(ALERT_LIST_PAGE_SIZE);
  });

  it("over the cap: the count stops at the cap and more is true", async () => {
    const rows = Array.from({ length: TODAY_ALERT_CAP + 1 }, (_, i) => alertRow(i + 1));
    as("owner", { alerts: [ok(rows)] });
    const body = await (await get()).json();
    expect(body.cards[0]).toEqual({
      key: "alerts",
      count: TODAY_ALERT_CAP,
      more: true,
      href: "/avvisi",
    });
  });

  it("exactly the cap: more is false", async () => {
    const rows = Array.from({ length: TODAY_ALERT_CAP }, (_, i) => alertRow(i + 1));
    as("owner", { alerts: [ok(rows)] });
    const body = await (await get()).json();
    expect(body.cards[0]).toMatchObject({ count: TODAY_ALERT_CAP, more: false });
  });

  it("equals the number of open alerts /api/alerts?filter=open shows the same chef, cost-bearing ones left out", async () => {
    const rows = [alertRow(3), alertRow(2, true), alertRow(1), alertRow(4, true)];
    as("chef", { alerts: [ok(rows)] });
    const today = await (await get()).json();
    as("chef", { alerts: [ok(rows)] });
    const list = await (alertsRoute.GET as (r: Request) => Promise<Response>)(
      new Request("http://localhost:3000/api/alerts?filter=open"),
    );
    const listed = (await list.json()) as { alerts: unknown[] };
    expect(listed.alerts).toHaveLength(2);
    expect(today.cards[0].count).toBe(listed.alerts.length);
  });

  it("the owner counts the cost-bearing alerts too", async () => {
    as("owner", { alerts: [ok([alertRow(1), alertRow(2, true)])] });
    expect((await (await get()).json()).cards[0].count).toBe(2);
  });
});

describe("GET /api/today: failures", () => {
  it("a database error is a 500 today_unavailable with no detail", async () => {
    as("owner", { counts: [failure("XX000", "secret table detail")] });
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("today_unavailable");
    expect(text).not.toContain("secret table detail");
  });

  it("an alert read error is the same 500", async () => {
    as("owner", { alerts: [failure("XX000", "boom detail")] });
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("today_unavailable");
    expect(text).not.toContain("boom detail");
  });

  it("a reply that is not the expected shape is the same 500", async () => {
    as("owner", { counts: [ok({ invoicesToReview: "many" })] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("today_unavailable");
  });

  it("a 42501 from the function is a 403", async () => {
    as("owner", { counts: [failure("42501", "insufficient_privilege")] });
    expect((await get()).status).toBe(403);
  });
});
