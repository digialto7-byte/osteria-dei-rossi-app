import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadInvoiceReview } from "@/server/invoices/review";
import { INVOICE_ID, INVOICE_ROW, LINE_ROW, ok, reviewClient } from "../../helpers/review-data";

const ingredientId = (n: number) => `1d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("loadInvoiceReview id lookups", () => {
  it("asks for related rows in chunks, so the request URL stays short", async () => {
    const count = 250;
    const lines = Array.from({ length: count }, (_, i) => ({
      ...LINE_ROW,
      id: `11000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      position: i + 1,
      ingredient_id: ingredientId(i + 1),
    }));
    const names = (from: number, to: number) =>
      lines.slice(from, to).map((line) => ({
        id: line.ingredient_id,
        name: `Ingrediente ${line.position}`,
        base_unit: "kg",
      }));
    const client = reviewClient("owner", {
      tables: {
        invoice: [ok(INVOICE_ROW)],
        invoice_line: [ok(lines)],
        ingredient: [ok(names(0, 100)), ok(names(100, 200)), ok(names(200, count))],
      },
    });

    const review = await loadInvoiceReview(client as unknown as SupabaseClient, INVOICE_ID);

    const idLookups = client.query.in.mock.calls.filter(([column]) => column === "id");
    const sizes = idLookups.map(([, ids]) => (ids as string[]).length);
    // One supplier, then the ingredients in 100 + 100 + 50.
    expect(sizes).toEqual([1, 100, 100, 50]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    // Every chunk's rows reach the screen.
    expect(review.lines).toHaveLength(count);
    expect(review.lines.every((line) => line.ingredient !== null)).toBe(true);
    expect(review.lines[count - 1]?.ingredient?.name).toBe(`Ingrediente ${count}`);
  });

  it("makes no lookup for an empty id list", async () => {
    const client = reviewClient("owner", {
      tables: { invoice_line: [ok([])], supplier: [ok([])] },
    });
    await loadInvoiceReview(client as unknown as SupabaseClient, INVOICE_ID);
    const tables = client.from.mock.calls.map(([table]) => table);
    expect(tables).not.toContain("ingredient");
    expect(tables).not.toContain("supplier_item");
    expect(tables).not.toContain("cost_centre");
  });
});
