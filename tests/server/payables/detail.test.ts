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
    const detail = await getPayableDetail(supabase, ID, new Date("2026-10-23T08:00:00Z"));
    expect(supabase.rpc).toHaveBeenCalledWith("payable_detail", { p_payable: ID });
    expect(detail).toEqual({ ...BODY, today: "2026-10-23" });
  });

  it("today follows Europe/Rome, not UTC (22:30 UTC in October is already tomorrow)", async () => {
    const detail = await getPayableDetail(rpc(BODY), ID, new Date("2026-10-23T22:30:00Z"));
    expect(detail.today).toBe("2026-10-24");
  });

  it("maps a database error", async () => {
    const supabase = rpc(null, { code: "P0002", message: "not_found" });
    await expect(getPayableDetail(supabase, ID)).rejects.toMatchObject({ status: 404 });
  });
});
