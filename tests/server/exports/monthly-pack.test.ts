import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import {
  PACK_COUNT_NOV,
  PACK_COUNT_OCT,
  PACK_COUNT_OCT_MID,
  PACK_COUNT_SEP,
  PACK_KPI,
  PACK_KPI_PROVISIONAL,
  PACK_WASTE,
  packAvt,
} from "../../fixtures/exports";

vi.mock("@/lib/observability/report", () => ({ reportError: () => undefined }));

const { getMonthlyPack } = await import("@/server/exports/monthly-pack");
const { monthlyPackOutput } = await import("@/server/exports/pack-output");
const { monthlyPackQuery } = await import("@/server/exports/schemas");

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

let client: FakeSupabase;
function setup(replies: Record<string, FakeResult[]>) {
  client = fakeSupabase({
    claims: claimsFor("owner"),
    rpc: { kpi_report: [ok(PACK_KPI)], waste_costs: [ok(PACK_WASTE)], ...replies },
  });
}
const run = (query: { month?: string } = { month: "2026-10" }) =>
  getMonthlyPack(client as unknown as SupabaseClient, query);
const rpcNames = () => client.rpc.mock.calls.map((c) => c[0]);

const person = { name: "Titolare Demo", me: true };
const monthlyCount = (closedAt: string | null) => ({
  id: "c5000000-0000-4000-8000-0000000000c9",
  type: "monthly" as "monthly" | "daily",
  status: "closed" as "closed" | "open",
  location: { id: "10000000-0000-4000-8000-0000000000a1", name: "Cella (demo)" },
  startedAt: "2026-10-31T20:00:00+00:00",
  startedBy: person,
  closedAt,
  closedBy: closedAt ? person : null,
  cancelledAt: null,
  linesTotal: 1,
  linesCounted: 1,
  linesWithDifference: 0,
});
const sessionsReply = (sessions: ReturnType<typeof monthlyCount>[]) => ({
  sessions,
  nextCursor: null,
});

const AVT_OCT = packAvt(PACK_COUNT_OCT, [PACK_COUNT_OCT, PACK_COUNT_SEP]);

beforeEach(() => setup({ avt_report: [ok(AVT_OCT)] }));

describe("the calls, in order", () => {
  it("?month=2026-10: kpi_report first, then waste_costs and avt_report, nothing else", async () => {
    await run();
    expect(client.rpc.mock.calls).toEqual([
      ["kpi_report", { p_period: "month", p_date: "2026-10-01", p_from: null, p_to: null }],
      ["waste_costs", { p_from: "2026-10-01", p_to: "2026-10-31" }],
      ["avt_report", { p_count: null }],
    ]);
  });

  it("takes the waste range from the KPI reply, not from the month name", async () => {
    setup({
      kpi_report: [ok({ ...PACK_KPI, current: { ...PACK_KPI.current, to: "2026-10-30" } })],
      avt_report: [ok(AVT_OCT)],
    });
    await run();
    expect(client.rpc).toHaveBeenCalledWith("waste_costs", {
      p_from: "2026-10-01",
      p_to: "2026-10-30",
    });
  });

  it("no month: the database's default anchor (p_date null) and the month of the reply", async () => {
    const result = await run({});
    expect(client.rpc.mock.calls[0]).toEqual([
      "kpi_report",
      { p_period: "month", p_date: null, p_from: null, p_to: null },
    ]);
    expect(result.month).toBe("2026-10");
  });
});

describe("the reply", () => {
  it("is strict-valid and carries the three services' replies untouched", async () => {
    const result = await run();
    expect(() => monthlyPackOutput.parse(result)).not.toThrow();
    expect(result.kpis).toEqual(PACK_KPI);
    expect(result.waste).toEqual(PACK_WASTE);
    expect(result.from).toBe("2026-10-01");
    expect(result.to).toBe("2026-10-31");
  });

  it("the waste total is the KPI's", async () => {
    const result = await run();
    expect(result.waste.valueEur).toBe(result.kpis.current.waste.valueEur);
  });

  it("previousMonth is the month of previous.from; nextMonth follows a final month", async () => {
    const result = await run();
    expect(result.final).toBe(true);
    expect(result.previousMonth).toBe("2026-09");
    expect(result.nextMonth).toBe("2026-11");
  });

  it("a provisional month has no nextMonth", async () => {
    setup({ kpi_report: [ok(PACK_KPI_PROVISIONAL)], avt_report: [ok(AVT_OCT)] });
    const result = await run();
    expect(result.final).toBe(false);
    expect(result.nextMonth).toBeNull();
    expect(result.previousMonth).toBe("2026-09");
  });

  it("a final month that ends in December points to January of the next year", async () => {
    const december = {
      ...PACK_KPI,
      current: { ...PACK_KPI.current, from: "2026-12-01", to: "2026-12-31" },
      previous: { ...PACK_KPI.previous, from: "2026-11-01", to: "2026-11-30" },
    };
    setup({ kpi_report: [ok(december)], avt_report: [ok(AVT_OCT)] });
    const result = await run({ month: "2026-12" });
    expect(result.nextMonth).toBe("2027-01");
    expect(result.previousMonth).toBe("2026-11");
  });
});

describe("Scostamenti: which count belongs to the month (Q172, Q175)", () => {
  it("the latest count closed in the month is used as it is: state ok, no second call", async () => {
    const result = await run();
    expect(result.variance).toEqual({ state: "ok", avt: AVT_OCT });
    expect(rpcNames()).toEqual(["kpi_report", "waste_costs", "avt_report"]);
  });

  it("a count closed at 22:30 on 31 October (21:30Z) belongs to October", async () => {
    expect(PACK_COUNT_OCT.closedAt).toBe("2026-10-31T21:30:00+00:00");
    expect((await run()).variance.state).toBe("ok");
  });

  it("(a) a latest count closed at 00:30 on 1 November belongs to November: a second call for the October one", async () => {
    const latest = packAvt(PACK_COUNT_NOV, [PACK_COUNT_NOV, PACK_COUNT_OCT_MID, PACK_COUNT_SEP]);
    const october = packAvt(PACK_COUNT_OCT_MID, [
      PACK_COUNT_NOV,
      PACK_COUNT_OCT_MID,
      PACK_COUNT_SEP,
    ]);
    setup({ avt_report: [ok(latest), ok(october)] });
    const result = await run();
    expect(client.rpc.mock.calls.filter((c) => c[0] === "avt_report")).toEqual([
      ["avt_report", { p_count: null }],
      ["avt_report", { p_count: PACK_COUNT_OCT_MID.id }],
    ]);
    expect(result.variance).toEqual({ state: "ok", avt: october });
  });

  it("with two counts in the month, the later one is chosen", async () => {
    const latest = packAvt(PACK_COUNT_NOV, [
      PACK_COUNT_OCT_MID,
      PACK_COUNT_NOV,
      PACK_COUNT_OCT,
      PACK_COUNT_SEP,
    ]);
    const october = packAvt(PACK_COUNT_OCT, latest.availableCounts);
    setup({ avt_report: [ok(latest), ok(october)] });
    await run();
    expect(client.rpc).toHaveBeenCalledWith("avt_report", { p_count: PACK_COUNT_OCT.id });
  });

  it("a count closed at 00:00 Rome time on 1 October (30 September 22:00Z) belongs to October", async () => {
    const edge = { ...PACK_COUNT_OCT_MID, closedAt: "2026-09-30T22:00:00+00:00" };
    const latest = packAvt(PACK_COUNT_NOV, [PACK_COUNT_NOV, edge]);
    setup({ avt_report: [ok(latest), ok(packAvt(edge, latest.availableCounts))] });
    const result = await run();
    expect(client.rpc).toHaveBeenCalledWith("avt_report", { p_count: edge.id });
    expect(result.variance.state).toBe("ok");
  });

  it("a count closed on 30 September in Rome (20:00Z) is September's, not October's", async () => {
    const latest = packAvt(PACK_COUNT_NOV, [PACK_COUNT_NOV, PACK_COUNT_SEP]);
    setup({ avt_report: [ok(latest)] });
    expect((await run()).variance).toEqual({ state: "noCount" });
  });

  it("(b) no count in the month: noCount and no second call", async () => {
    const latest = packAvt(PACK_COUNT_NOV, [PACK_COUNT_NOV, PACK_COUNT_SEP]);
    setup({ avt_report: [ok(latest)] });
    const result = await run();
    expect(result.variance).toEqual({ state: "noCount" });
    expect(rpcNames().filter((n) => n === "avt_report")).toHaveLength(1);
  });

  it("(c) avt_report 404 (no monthly count at all): noCount", async () => {
    setup({ avt_report: [failure("P0002", "count_not_found")] });
    expect((await run()).variance).toEqual({ state: "noCount" });
  });

  it("(d) 422 avt_no_opening_count with the only count closed in the month: noOpening", async () => {
    setup({
      avt_report: [failure("P0001", "avt_no_opening_count")],
      count_sessions: [ok(sessionsReply([monthlyCount("2026-10-31T21:30:00+00:00")]))],
    });
    expect((await run()).variance).toEqual({ state: "noOpening" });
    expect(client.rpc).toHaveBeenCalledWith(
      "count_sessions",
      expect.objectContaining({ p_status: "closed" }),
    );
  });

  it("422 avt_no_opening_count when the only count was closed on 31 October: the September pack says no count in September", async () => {
    const september = {
      ...PACK_KPI,
      current: { ...PACK_KPI.current, from: "2026-09-01", to: "2026-09-30" },
      previous: { ...PACK_KPI.previous, from: "2026-08-01", to: "2026-08-31" },
    };
    setup({
      kpi_report: [ok(september)],
      avt_report: [failure("P0001", "avt_no_opening_count")],
      count_sessions: [ok(sessionsReply([monthlyCount("2026-10-31T21:30:00+00:00")]))],
    });
    expect((await run({ month: "2026-09" })).variance).toEqual({ state: "noCount" });
  });

  it("the no-opening check ignores daily counts and counts that are not closed", async () => {
    setup({
      avt_report: [failure("P0001", "avt_no_opening_count")],
      count_sessions: [
        ok(
          sessionsReply([
            { ...monthlyCount("2026-10-20T20:00:00+00:00"), type: "daily" },
            { ...monthlyCount(null), status: "open" },
          ]),
        ),
      ],
    });
    expect((await run()).variance).toEqual({ state: "noCount" });
  });

  it("the no-opening check follows the next page of counts", async () => {
    setup({
      avt_report: [failure("P0001", "avt_no_opening_count")],
      count_sessions: [
        ok({
          ...sessionsReply([{ ...monthlyCount("2026-10-20T20:00:00+00:00"), type: "daily" }]),
          nextCursor: {
            at: "2026-10-01T00:00:00+00:00",
            id: "c5000000-0000-4000-8000-0000000000aa",
          },
        }),
        ok(sessionsReply([monthlyCount("2026-10-31T21:30:00+00:00")])),
      ],
    });
    expect((await run()).variance).toEqual({ state: "noOpening" });
    expect(client.rpc.mock.calls.filter((c) => c[0] === "count_sessions")).toHaveLength(2);
  });

  it("a count list that fails passes its error through", async () => {
    setup({
      avt_report: [failure("P0001", "avt_no_opening_count")],
      count_sessions: [failure("42501", "permission denied")],
    });
    await expect(run()).rejects.toMatchObject({ status: 403 });
  });

  it("noOpening also when the second call answers it", async () => {
    const latest = packAvt(PACK_COUNT_NOV, [PACK_COUNT_NOV, PACK_COUNT_OCT_MID]);
    setup({ avt_report: [ok(latest), failure("P0001", "avt_no_opening_count")] });
    expect((await run()).variance).toEqual({ state: "noOpening" });
  });

  it("any other AVT error passes through", async () => {
    setup({ avt_report: [failure("42501", "permission denied")] });
    await expect(run()).rejects.toMatchObject({ status: 403, code: "forbidden" });
    setup({ avt_report: [failure("P0001", "avt_count_not_closed")] });
    await expect(run()).rejects.toMatchObject({ status: 422, code: "avt_count_not_closed" });
  });
});

describe("errors and strictness", () => {
  it("a KPI error propagates and nothing else is called", async () => {
    setup({ kpi_report: [failure("P0001", "date_in_future")], avt_report: [ok(AVT_OCT)] });
    const error = await run({ month: "2030-01" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "date_in_future" });
    expect(rpcNames()).toEqual(["kpi_report"]);
  });

  it("a waste_costs key the service does not declare never reaches the pack (the service copies field by field)", async () => {
    setup({ waste_costs: [ok({ ...PACK_WASTE, leakedKey: 1 })], avt_report: [ok(AVT_OCT)] });
    const result = await run();
    expect(JSON.stringify(result)).not.toContain("leakedKey");
    expect(result.waste).toEqual(PACK_WASTE);
  });

  it("a kpi_report reply with an extra key is a 500 report_unavailable (strict parse)", async () => {
    setup({ kpi_report: [ok({ ...PACK_KPI, secretUnitCost: 9 })], avt_report: [ok(AVT_OCT)] });
    await expect(run()).rejects.toMatchObject({ status: 500, code: "report_unavailable" });
    expect(rpcNames()).toEqual(["kpi_report"]);
  });

  it("an avt_report reply with an extra key is a 500 report_unavailable", async () => {
    setup({ avt_report: [ok({ ...AVT_OCT, secretUnitCost: 9 })] });
    await expect(run()).rejects.toMatchObject({ status: 500, code: "report_unavailable" });
  });

  it("the output schema is strict (an extra key is refused)", async () => {
    const result = await run();
    expect(monthlyPackOutput.safeParse({ ...result, extra: 1 }).success).toBe(false);
    expect(monthlyPackOutput.safeParse({ ...result, month: "2026-13" }).success).toBe(false);
  });

  it("JSON schema snapshot of the pack", () => {
    expect(z.toJSONSchema(monthlyPackOutput)).toMatchSnapshot();
  });
});

describe("monthlyPackQuery", () => {
  it.each([["2026-10"], ["2026-01"], ["2026-12"], [undefined]])("accepts %s", (month) => {
    expect(monthlyPackQuery.safeParse(month ? { month } : {}).success).toBe(true);
  });

  it.each([["2026-13"], ["2026-1"], ["2026-00"], ["26-10"], ["2026-10-01"], [""]])(
    "refuses %j",
    (month) => {
      expect(monthlyPackQuery.safeParse({ month }).success).toBe(false);
    },
  );

  it("refuses an unknown key", () => {
    expect(monthlyPackQuery.safeParse({ mese: "2026-10" }).success).toBe(false);
  });
});
