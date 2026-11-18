import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { todaySummary } from "@/server/today/summary";
import { todaySchema } from "@/server/today/types";
import { fakeSupabase, type FakeResult } from "../../helpers/fake-supabase";
import { COUNTS } from "../../fixtures/dashboard-sql";

// Opening stock step 17 (plan 2026-11-18 §5, lead ruling 2026-11-18 on the step): the owner's and admin's set-up list gains
// `openingStock`, read from opening_stock_summary. The chef makes no such call; a failed read fails the summary (never `done: false`).
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string): FakeResult => ({ data: null, error: { code, message: "x" } });

function client(role: "owner" | "admin" | "chef", summary: FakeResult[]) {
  return fakeSupabase({
    results: { alert: [ok([])] },
    rpc: {
      today_counts: [ok(role === "chef" ? { batchesUseBy: 1, countOpen: false } : COUNTS)],
      opening_stock_summary: summary,
    },
  });
}

beforeEach(() => reportError.mockClear());

describe("todaySummary and the openingStock step", () => {
  it("for the owner, setup includes {key: 'openingStock', done: true, href: '/magazzino/avvio'} when opening_stock_summary says booked", async () => {
    const c = client("owner", [ok({ booked: true, draftLines: 0 })]);
    const summary = await todaySummary(c as never, "owner");
    expect(todaySchema.safeParse(summary).success).toBe(true);
    expect(summary.setup).toContainEqual({
      key: "openingStock",
      done: true,
      href: "/magazzino/avvio",
    });
    expect(c.rpc).toHaveBeenCalledWith("opening_stock_summary", {});
  });

  it("done is false when not booked, for the owner and the admin; the step follows ingredients", async () => {
    for (const role of ["owner", "admin"] as const) {
      const summary = await todaySummary(
        client(role, [ok({ booked: false, draftLines: 3 })]) as never,
        role,
      );
      const keys = summary.setup!.map((s) => s.key);
      expect(keys.indexOf("openingStock")).toBe(keys.indexOf("ingredients") + 1);
      expect(summary.setup!.find((s) => s.key === "openingStock")?.done).toBe(false);
    }
  });

  it("the chef's setup stays null and opening_stock_summary is not called for the chef", async () => {
    const c = client("chef", [ok({ booked: true, draftLines: 0 })]);
    const summary = await todaySummary(c as never, "chef");
    expect(summary.setup).toBeNull();
    expect(c.rpc).not.toHaveBeenCalledWith("opening_stock_summary", expect.anything());
    expect(c.rpc.mock.calls.map((call) => call[0])).not.toContain("opening_stock_summary");
  });

  it("a failed opening_stock_summary fails the summary like today_counts does: 500 today_unavailable, logged by code; 42501 is a 403", async () => {
    const failed = todaySummary(client("owner", [failure("XX000")]) as never, "owner");
    await expect(failed).rejects.toMatchObject({ status: 500, code: "today_unavailable" });
    expect(String((reportError.mock.calls[0]?.[0] as Error).message)).toContain("XX000");
    const denied = todaySummary(client("admin", [failure("42501")]) as never, "admin");
    await expect(denied).rejects.toBeInstanceOf(ApiError);
    await expect(denied).rejects.toMatchObject({ status: 403 });
  });

  it("a malformed summary document is a 500 too, never a default", async () => {
    const failed = todaySummary(client("owner", [ok({ booked: "yes" })]) as never, "owner");
    await expect(failed).rejects.toMatchObject({ status: 500, code: "today_unavailable" });
  });
});
