import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import { dbError, ok } from "../../../helpers/review-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

const listRoute = await import("@/app/api/alerts/route");
const ackRoute = await import("@/app/api/alerts/[id]/ack/route");
const testRoute = await import("@/app/api/alerts/test/route");

const BASE = "http://localhost:3000/api/alerts";
const ALERT_ID = "a1000000-0000-4000-8000-000000000001";
const OWNER_APP_USER = "a2000000-0000-4000-8000-000000000001";
const ROW = {
  id: ALERT_ID,
  kind: "test_alert",
  severity: "info",
  entity_type: "tenant",
  entity_id: "11111111-1111-4111-8111-111111111111",
  business_date: "2026-10-25",
  created_at: "2026-10-25T00:30:00.123456+00:00",
  payload: {},
  cost_bearing: false,
  acknowledged_at: null,
  acknowledged_by: null,
  acknowledger: null,
};
const ACKED_ROW = {
  ...ROW,
  acknowledged_at: "2026-10-25T09:12:00+00:00",
  acknowledged_by: OWNER_APP_USER,
  acknowledger: { display_name: "Titolare Demo" },
};

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>;

function as(
  role: string,
  {
    alert = [ok([ROW])],
    rpc = {},
  }: { alert?: FakeResult[]; rpc?: Record<string, FakeResult[]> } = {},
) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    results: { alert },
    rpc,
  });
}
const fetchSpy = vi.fn();
const get = (query = "") => (listRoute.GET as Handler)(new Request(`${BASE}${query}`));
const ack = (id = ALERT_ID, body: unknown = {}, init?: RequestInit) =>
  (ackRoute.POST as Handler)(jsonRequest(`${BASE}/${id}/ack`, body, init), routeContext({ id }));
const raiseTest = (body: unknown = {}, init?: RequestInit) =>
  (testRoute.POST as Handler)(jsonRequest(`${BASE}/test`, body, init));
const noQueries = () => {
  expect(client.from).not.toHaveBeenCalled();
  expect(client.rpc).not.toHaveBeenCalled();
};

beforeEach(() => {
  reportError.mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  as("owner");
});
afterEach(() => {
  // AT3: no alert call ever leaves the system (in-app only).
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("GET /api/alerts", () => {
  it("returns the open alerts rendered for the owner, who may raise the test alert", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.canRaiseTest).toBe(true);
    expect(body.nextCursor).toBeNull();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0]).toMatchObject({
      id: ALERT_ID,
      kind: "test_alert",
      title: "Avviso di prova",
      acknowledged: null,
    });
    expect(client.query.is).toHaveBeenCalledWith("acknowledged_at", null);
  });

  it("the chef gets 200 without the test card, and a cost-bearing row is dropped", async () => {
    as("chef", {
      alert: [
        ok([
          { ...ROW, cost_bearing: true },
          { ...ROW, id: "a1000000-0000-4000-8000-000000000002" },
        ]),
      ],
    });
    const body = await (await get()).json();
    expect(body.canRaiseTest).toBe(false);
    expect(body.alerts.map((a: { id: string }) => a.id)).toEqual([
      "a1000000-0000-4000-8000-000000000002",
    ]);
  });

  it.each(["admin", "waiter"])("%s gets 403 before any query", async (role) => {
    as(role);
    const response = await get();
    expect(response.status).toBe(403);
    noQueries();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await get()).status).toBe(401);
    noQueries();
  });

  it("filter=all, locale=en and a cursor are honoured", async () => {
    const before = encodeURIComponent(`2026-10-25T00:30:00Z_${ALERT_ID}`);
    const body = await (await get(`?filter=all&locale=en&before=${before}`)).json();
    expect(body.alerts[0].title).toBe("Test alert");
    expect(client.query.is).not.toHaveBeenCalled();
    expect(client.query.or).toHaveBeenCalledOnce();
  });

  it.each(["?filter=x", "?locale=fr", "?before=garbage"])("%s is 400", async (query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    noQueries();
  });

  it("never returns the payload or the cost flag", async () => {
    as("owner", { alert: [ok([{ ...ROW, payload: { note: "SEGRETO" } }])] });
    const text = await (await get()).text();
    expect(text).not.toMatch(/SEGRETO|payload|cost_bearing/);
  });

  it("an unexpected database error is a 500 reported by SQLSTATE only", async () => {
    as("owner", { alert: [dbError("57014", "canceling statement for tenant SEGRETO")] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(reportError).toHaveBeenCalledOnce();
    expect(String((reportError.mock.calls[0]![0] as Error).message)).toBe(
      "Unexpected database error 57014",
    );
  });
});

describe("POST /api/alerts/:id/ack", () => {
  const ackRpc = (
    result: FakeResult = ok({
      acknowledgedAt: ACKED_ROW.acknowledged_at,
      acknowledgedBy: OWNER_APP_USER,
    }),
  ) => ({
    acknowledge_alert: [result],
  });

  it("acknowledges once and returns the refreshed item", async () => {
    as("owner", { alert: [ok(ACKED_ROW)], rpc: ackRpc() });
    const response = await ack();
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("acknowledge_alert", { p_alert: ALERT_ID });
    const { alert } = await response.json();
    expect(alert.acknowledged).toEqual({ at: ACKED_ROW.acknowledged_at, byName: "Titolare Demo" });
  });

  it("the chef may acknowledge a kitchen alert, and sees no name for someone else's ack", async () => {
    as("chef", { alert: [ok({ ...ACKED_ROW, acknowledger: null })], rpc: ackRpc() });
    const response = await ack();
    expect(response.status).toBe(200);
    expect((await response.json()).alert.acknowledged.byName).toBeNull();
  });

  it("an alert the caller cannot see is 404", async () => {
    as("chef", { rpc: ackRpc(dbError("P0002", "not_found")) });
    const response = await ack();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("a database refusal (42501) is 403", async () => {
    as("owner", { rpc: ackRpc(dbError("42501", "insufficient_privilege")) });
    expect((await ack()).status).toBe(403);
  });

  it.each(["admin", "waiter"])("%s gets 403 before the procedure runs", async (role) => {
    as(role);
    expect((await ack()).status).toBe(403);
    noQueries();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await ack()).status).toBe(401);
    noQueries();
  });

  it("a malformed id is 404, an unknown body key is 400, text/plain is 415", async () => {
    as("owner", { rpc: ackRpc() });
    expect((await ack("not-a-uuid")).status).toBe(404);
    expect((await ack(ALERT_ID, { force: true })).status).toBe(400);
    const plain = await (ackRoute.POST as Handler)(
      new Request(`${BASE}/${ALERT_ID}/ack`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
      routeContext({ id: ALERT_ID }),
    );
    expect(plain.status).toBe(415);
    noQueries();
  });

  it("an unexpected database error is a 500 reported by SQLSTATE only", async () => {
    as("owner", { rpc: ackRpc(dbError("55000", "something about SEGRETO")) });
    expect((await ack()).status).toBe(500);
    expect((reportError.mock.calls[0]![0] as Error).message).toBe(
      "Unexpected database error 55000",
    );
  });
});

describe("POST /api/alerts/test", () => {
  const raised = (inserted: boolean) => ({
    raise_test_alert: [ok({ alertId: ALERT_ID, inserted })],
  });

  it("creates the test alert: 201 and deduplicated false", async () => {
    as("owner", { alert: [ok(ROW)], rpc: raised(true) });
    const response = await raiseTest();
    expect(response.status).toBe(201);
    expect(client.rpc).toHaveBeenCalledWith("raise_test_alert", { p_include_kitchen: false });
    const body = await response.json();
    expect(body.deduplicated).toBe(false);
    expect(body.alert.title).toBe("Avviso di prova");
  });

  it("the same day again is 200 and deduplicated true", async () => {
    as("owner", { alert: [ok(ROW)], rpc: raised(false) });
    const response = await raiseTest({});
    expect(response.status).toBe(200);
    expect((await response.json()).deduplicated).toBe(true);
  });

  it("includeKitchen raises the kitchen test alert", async () => {
    as("owner", { alert: [ok({ ...ROW, kind: "test_alert_kitchen" })], rpc: raised(true) });
    const response = await raiseTest({ includeKitchen: true });
    expect(client.rpc).toHaveBeenCalledWith("raise_test_alert", { p_include_kitchen: true });
    expect((await response.json()).alert.title).toBe("Avviso di prova per la cucina");
  });

  it.each(["chef", "admin", "waiter"])("%s gets 403 before the procedure runs", async (role) => {
    as(role);
    expect((await raiseTest()).status).toBe(403);
    noQueries();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await raiseTest()).status).toBe(401);
  });

  it("an unknown body key or a wrong type is 400, text/plain is 415", async () => {
    as("owner", { rpc: raised(true) });
    expect((await raiseTest({ sendEmail: true })).status).toBe(400);
    expect((await raiseTest({ includeKitchen: "yes" })).status).toBe(400);
    const plain = await (testRoute.POST as Handler)(
      new Request(`${BASE}/test`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
    );
    expect(plain.status).toBe(415);
    noQueries();
  });

  it("the database refusing the role is 403", async () => {
    as("owner", { rpc: { raise_test_alert: [dbError("42501", "insufficient_privilege")] } });
    expect((await raiseTest()).status).toBe(403);
  });

  it("an unexpected database error is a 500 reported by SQLSTATE only", async () => {
    as("owner", { rpc: { raise_test_alert: [dbError("XX000", "internal SEGRETO")] } });
    expect((await raiseTest()).status).toBe(500);
    expect((reportError.mock.calls[0]![0] as Error).message).toBe(
      "Unexpected database error XX000",
    );
  });
});
