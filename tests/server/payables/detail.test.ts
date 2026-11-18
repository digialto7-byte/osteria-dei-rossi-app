import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getPayableDetail } from "@/server/payables/detail";

const ID = "90000000-0000-4000-8000-000000000001";
const rpc = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn(async () => ({ data, error })) }) as unknown as SupabaseClient & {
    rpc: ReturnType<typeof vi.fn>;
  };

describe("getPayableDetail", () => {
  const BODY = { payable: { id: ID }, allowedStatuses: [], canReversePayment: true, history: [] };

  it("returns the database's answer with today at the venue", async () => {
    const supabase = rpc(BODY);
    const detail = await getPayableDetail(
      supabase,
      ID,
      "Europe/Rome",
      new Date("2026-10-23T08:00:00Z"),
    );
    expect(supabase.rpc).toHaveBeenCalledWith("payable_detail", { p_payable: ID });
    expect(detail).toEqual({ ...BODY, today: "2026-10-23" });
  });

  it("today follows the tenant's zone: at 23:30 UTC in December Lisbon is still on the 10th, Rome is on the 11th", async () => {
    const now = new Date("2026-12-10T23:30:00Z");
    expect((await getPayableDetail(rpc(BODY), ID, "Europe/Lisbon", now)).today).toBe("2026-12-10");
    expect((await getPayableDetail(rpc(BODY), ID, "Europe/Rome", now)).today).toBe("2026-12-11");
  });

  it("today follows Europe/Rome, not UTC (22:30 UTC in October is already tomorrow)", async () => {
    const detail = await getPayableDetail(
      rpc(BODY),
      ID,
      "Europe/Rome",
      new Date("2026-10-23T22:30:00Z"),
    );
    expect(detail.today).toBe("2026-10-24");
  });

  it("maps a database error", async () => {
    const supabase = rpc(null, { code: "P0002", message: "not_found" });
    await expect(getPayableDetail(supabase, ID, "Europe/Rome")).rejects.toMatchObject({
      status: 404,
    });
  });
});
