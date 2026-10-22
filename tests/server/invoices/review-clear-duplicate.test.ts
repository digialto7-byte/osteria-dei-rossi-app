import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { clearDuplicate } from "@/server/invoices/review-actions";
import {
  INVOICE_ID,
  PARTNER_ID,
  dbError,
  ok,
  procedureCalls,
  reviewClient,
} from "../../helpers/review-data";

const run = (client: ReturnType<typeof reviewClient>) =>
  clearDuplicate(client as unknown as SupabaseClient, INVOICE_ID, PARTNER_ID);

describe("clearDuplicate", () => {
  it("passes the invoice and the partner to the procedure, then reloads the review", async () => {
    const client = reviewClient("owner");
    const review = await run(client);
    expect(procedureCalls(client)).toEqual([
      ["review_clear_duplicate", { p_invoice: INVOICE_ID, p_partner: PARTNER_ID }],
    ]);
    expect(review.invoice.id).toBe(INVOICE_ID);
    // The procedure runs before the reload reads the invoice.
    const order = client.rpc.mock.calls.map(([name]) => name);
    expect(order).toEqual(["review_clear_duplicate", "invoice_approval_preview"]);
  });

  it("is idempotent from here: a database no-op (nothing returned) gives the current review", async () => {
    const client = reviewClient("owner", { rpc: { review_clear_duplicate: [ok(null)] } });
    await expect(run(client)).resolves.toMatchObject({ invoice: { id: INVOICE_ID } });
  });

  it("maps a refused partner (not_flagged) to a 409 without reloading", async () => {
    const client = reviewClient("owner", {
      rpc: { review_clear_duplicate: [dbError("P0001", "not_flagged")] },
    });
    await expect(run(client)).rejects.toMatchObject({ status: 409, code: "not_flagged" });
    await expect(run(client)).rejects.toBeInstanceOf(ApiError);
    expect(client.rpc.mock.calls.map(([name]) => name)).not.toContain("invoice_approval_preview");
  });

  it("maps a role refusal to 403", async () => {
    const client = reviewClient("owner", {
      rpc: { review_clear_duplicate: [dbError("42501", "insufficient_privilege")] },
    });
    await expect(run(client)).rejects.toMatchObject({ status: 403 });
  });
});
