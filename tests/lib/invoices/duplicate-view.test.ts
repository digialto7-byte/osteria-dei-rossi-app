import { describe, expect, it } from "vitest";
import { duplicateGuidance } from "@/lib/invoices/duplicate-view";
import { isMessageKey, messages, t } from "@/lib/i18n";
import type { ApprovalInfo, InvoiceReview } from "@/server/invoices/review-types";

const approval = (...codes: string[]): ApprovalInfo => ({
  canApprove: codes.length === 0,
  blockers: codes.map((code) => ({ code, lineIds: [] })),
  receiptDate: null,
  payable: {
    grossAmount: null,
    creditedAmount: null,
    amount: null,
    dueDate: null,
    dueDateSource: null,
  },
  receipts: 0,
  locations: { required: false, options: [], defaultId: null },
});

type Status = InvoiceReview["invoice"]["status"];
const invoice = (over: {
  status?: Status;
  duplicateOf?: string | null;
  duplicateWarningOf?: string | null;
}) => ({ status: "review" as Status, duplicateOf: null, duplicateWarningOf: null, ...over });

describe("duplicateGuidance", () => {
  it("offers the action for a duplicate that names its original", () => {
    expect(duplicateGuidance(invoice({ status: "duplicate", duplicateOf: "x" }), null)).toEqual({
      canClear: true,
      hint: null,
    });
  });

  it("tells the owner what to do for a duplicate with no known original", () => {
    expect(duplicateGuidance(invoice({ status: "duplicate" }), null)).toEqual({
      canClear: false,
      hint: "review.duplicateNoAction",
    });
  });

  it("offers the action to a review invoice the server blocks as a duplicate, with no stored pointer", () => {
    // M4-cleared invoices, a copy that arrived later, or the original of a look-alike pair.
    expect(duplicateGuidance(invoice({}), approval("duplicate_invoice")).canClear).toBe(true);
    expect(duplicateGuidance(invoice({}), approval("duplicate_warning", "total_mismatch"))).toEqual(
      {
        canClear: true,
        hint: null,
      },
    );
  });

  it("offers it when the blocker names another partner than the stored warning", () => {
    const inv = invoice({ duplicateWarningOf: "stored" });
    expect(duplicateGuidance(inv, approval("duplicate_warning")).canClear).toBe(true);
  });

  it("trusts the preview over a stale stored warning: no blocker, no action", () => {
    const inv = invoice({ duplicateWarningOf: "declared-pair" });
    expect(duplicateGuidance(inv, approval("total_mismatch"))).toEqual({
      canClear: false,
      hint: null,
    });
    expect(duplicateGuidance(inv, approval())).toEqual({ canClear: false, hint: null });
  });

  it("falls back to the stored warning only while there is no preview", () => {
    expect(duplicateGuidance(invoice({ duplicateWarningOf: "w" }), null).canClear).toBe(true);
    expect(duplicateGuidance(invoice({}), null).canClear).toBe(false);
  });

  it("offers nothing once the invoice is decided or not read yet", () => {
    const statuses: Status[] = [
      "approved",
      "rejected",
      "received",
      "extracting",
      "extraction_failed",
    ];
    for (const status of statuses) {
      expect(
        duplicateGuidance(invoice({ status, duplicateOf: "x", duplicateWarningOf: "y" }), null),
      ).toEqual({ canClear: false, hint: null });
    }
  });

  it("has the hint in Italian and English", () => {
    expect(isMessageKey("review.duplicateNoAction")).toBe(true);
    expect(t("review.duplicateNoAction", {}, "it")).toBe(
      "Rifiuta il doppione o controlla numero e data",
    );
    expect(t("review.duplicateNoAction", {}, "en")).not.toBe(
      t("review.duplicateNoAction", {}, "it"),
    );
    expect(Object.keys(messages.en)).toContain("review.duplicateNoAction");
  });
});
