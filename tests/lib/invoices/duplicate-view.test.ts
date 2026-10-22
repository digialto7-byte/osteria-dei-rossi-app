import { describe, expect, it } from "vitest";
import { duplicateGuidance, duplicatePartnerLabel } from "@/lib/invoices/duplicate-view";
import { isMessageKey, messages, t } from "@/lib/i18n";
import type { DuplicatePartner, InvoiceReview } from "@/server/invoices/review-types";

type Status = InvoiceReview["invoice"]["status"];
const PARTNER: DuplicatePartner = {
  id: "1b000000-0000-4000-8000-0000000000b2",
  number: "FT 40",
  date: "2026-09-01",
};

describe("duplicatePartnerLabel", () => {
  it("is the printed number and the date in the venue's format", () => {
    expect(duplicatePartnerLabel(PARTNER)).toBe("FT 40 del 01/09/2026");
  });

  it("has an English form, with the date in that locale's order", () => {
    expect(duplicatePartnerLabel(PARTNER, "en")).toBe("FT 40 of 01/09/2026");
  });

  it("keeps the number exactly as printed (no markup, no trimming of its characters)", () => {
    expect(duplicatePartnerLabel({ number: "12/B-2026", date: "2026-10-15" })).toBe(
      "12/B-2026 del 15/10/2026",
    );
  });
});

describe("duplicateGuidance", () => {
  it("names the partner on the button, and sends its id, for an invoice in review", () => {
    expect(duplicateGuidance("review", PARTNER)).toEqual({
      action: { partnerId: PARTNER.id, label: "Non è un doppione di FT 40 del 01/09/2026" },
      hint: null,
    });
  });

  it("does the same for a duplicate that has its original", () => {
    expect(duplicateGuidance("duplicate", PARTNER).action).toEqual({
      partnerId: PARTNER.id,
      label: "Non è un doppione di FT 40 del 01/09/2026",
    });
  });

  it("speaks English as the second locale", () => {
    expect(duplicateGuidance("review", PARTNER, "en").action?.label).toBe(
      "Not a duplicate of FT 40 of 01/09/2026",
    );
  });

  it("offers nothing to an invoice in review that nothing blocks", () => {
    expect(duplicateGuidance("review", null)).toEqual({ action: null, hint: null });
  });

  it("tells the owner what to do with a duplicate whose original has left", () => {
    expect(duplicateGuidance("duplicate", null)).toEqual({
      action: null,
      hint: "review.duplicateOriginalGone",
    });
  });

  it("offers nothing once the invoice is decided or not read yet, whatever the partner", () => {
    const statuses: Status[] = [
      "approved",
      "rejected",
      "received",
      "extracting",
      "extraction_failed",
    ];
    for (const status of statuses) {
      expect(duplicateGuidance(status, PARTNER)).toEqual({ action: null, hint: null });
      expect(duplicateGuidance(status, null)).toEqual({ action: null, hint: null });
    }
  });

  it("has every message in both languages, and none of the retired keys", () => {
    for (const key of [
      "review.notDuplicateOf",
      "review.duplicatePartnerLabel",
      "review.duplicateOriginalGone",
    ]) {
      expect(isMessageKey(key)).toBe(true);
      expect(Object.keys(messages.en)).toContain(key);
    }
    expect(t("review.duplicateOriginalGone", {}, "it")).not.toBe(
      t("review.duplicateOriginalGone", {}, "en"),
    );
    expect(isMessageKey("review.duplicateNoAction")).toBe(false);
    expect(isMessageKey("review.notDuplicate")).toBe(false);
  });
});
