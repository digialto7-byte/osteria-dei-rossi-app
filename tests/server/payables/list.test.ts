import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { listPayables, parsePayableListQuery } from "@/server/payables/list";

const ID = "90000000-0000-4000-8000-000000000003";
const SUP = "5a000000-0000-4000-8000-00000000005a";
const url = (qs: string) => new URL(`http://localhost:3000/api/payables${qs}`);

describe("parsePayableListQuery", () => {
  it("defaults to the unpaid filter", () => {
    expect(parsePayableListQuery(url(""))).toEqual({
      filter: "unpaid",
      supplier: null,
      cursor: null,
    });
  });

  it("reads filter, supplier and cursor", () => {
    expect(
      parsePayableListQuery(url(`?filter=paid&supplier=${SUP}&before=2026-12-01_${ID}`)),
    ).toEqual({ filter: "paid", supplier: SUP, cursor: { date: "2026-12-01", id: ID } });
  });

  it.each([
    "?foo=1",
    "?filter=overdue",
    "?supplier=nope",
    "?before=2026-12-01",
    `?before=2026-13-01_${ID}`,
    "?before=2026-12-01_nope",
    `?before=${ID}_2026-12-01`,
    "?filter=paid&filter=all",
  ])("%s is a 400", (qs) => {
    expect(() => parsePayableListQuery(url(qs))).toThrow(ApiError);
    try {
      parsePayableListQuery(url(qs));
    } catch (error) {
      expect((error as ApiError).status).toBe(400);
    }
  });
});

describe("listPayables", () => {
  const item = { id: ID, amount: 10 };
  const rpc = (data: unknown, error: unknown = null) =>
    ({ rpc: vi.fn(async () => ({ data, error })) }) as unknown as SupabaseClient & {
      rpc: ReturnType<typeof vi.fn>;
    };

  it("calls payable_list with the page size and shapes the answer", async () => {
    const supabase = rpc({
      items: [item],
      nextCursor: { date: "2026-12-01", id: ID },
      totals: { count: 1, amount: 10 },
      today: "2026-10-23",
    });
    const result = await listPayables(supabase, {
      filter: "unpaid",
      supplier: SUP,
      cursor: { date: "2026-11-01", id: ID },
    });
    expect(supabase.rpc).toHaveBeenCalledWith("payable_list", {
      p_filter: "unpaid",
      p_supplier: SUP,
      p_cursor_date: "2026-11-01",
      p_cursor_id: ID,
      p_limit: 50,
    });
    expect(result).toEqual({
      payables: [item],
      nextCursor: `2026-12-01_${ID}`,
      totals: { count: 1, amount: 10 },
      today: "2026-10-23",
    });
  });

  it("passes nulls for an absent supplier and cursor, and no cursor when there is no next page", async () => {
    const supabase = rpc({ items: [], nextCursor: null, totals: null, today: "2026-10-23" });
    const result = await listPayables(supabase, { filter: "all", supplier: null, cursor: null });
    expect(supabase.rpc).toHaveBeenCalledWith("payable_list", {
      p_filter: "all",
      p_supplier: null,
      p_cursor_date: null,
      p_cursor_id: null,
      p_limit: 50,
    });
    expect(result.nextCursor).toBeNull();
    expect(result.totals).toBeNull();
  });

  it("maps a database error", async () => {
    const supabase = rpc(null, { code: "42501", message: "insufficient_privilege" });
    await expect(
      listPayables(supabase, { filter: "all", supplier: null, cursor: null }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
