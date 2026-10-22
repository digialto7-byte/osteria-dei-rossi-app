import { describe, expect, it } from "vitest";
import { applyActionResponse, decidedNoticeKey, markDecided } from "@/lib/invoices/action-result";
import { messages } from "@/lib/i18n";
import { makeLine, makeReview } from "../../helpers/review-line";

const inReview = () =>
  makeReview([makeLine()], {
    approval: {
      canApprove: true,
      blockers: [],
      receiptDate: "2026-09-29",
      payable: {
        grossAmount: 11,
        creditedAmount: 0,
        amount: 11,
        dueDate: "2026-10-31",
        dueDateSource: "invoice",
      },
      receipts: 1,
      locations: { required: false, options: [], defaultId: null },
    },
  });

describe("markDecided", () => {
  it("shows the decided status and takes the approval panel's inputs away", () => {
    const decided = markDecided(inReview(), "approved");
    expect(decided.invoice.status).toBe("approved");
    expect(decided.editable).toBe(false);
    expect(decided.approval).toBeNull();
  });

  it("does the same for a rejection and keeps everything else", () => {
    const before = inReview();
    const decided = markDecided(before, "rejected");
    expect(decided.invoice.status).toBe("rejected");
    expect(decided.lines).toEqual(before.lines);
    expect(decided.invoice.id).toBe(before.invoice.id);
  });

  it("leaves its input alone", () => {
    const before = inReview();
    markDecided(before, "approved");
    expect(before.invoice.status).toBe("review");
    expect(before.approval).not.toBeNull();
  });
});

describe("applyActionResponse", () => {
  it("takes the fresh review the server sent, with no reload", () => {
    const fresh = makeReview([makeLine()], { editable: false });
    expect(applyActionResponse(inReview(), { review: fresh, status: "approved" })).toEqual({
      review: fresh,
      decided: null,
      reload: false,
    });
  });

  it("shows the decided state at once when the server could not reload, then asks for a reload", () => {
    const current = inReview();
    const outcome = applyActionResponse(current, {
      review: null,
      status: "approved",
      reload: true,
    });
    expect(outcome.decided).toBe("approved");
    expect(outcome.reload).toBe(true);
    expect(outcome.review?.invoice.status).toBe("approved");
    expect(outcome.review?.approval).toBeNull();
  });

  it("does the same for a rejection", () => {
    const outcome = applyActionResponse(inReview(), {
      review: null,
      status: "rejected",
      reload: true,
    });
    expect(outcome).toMatchObject({ decided: "rejected", reload: true });
    expect(outcome.review?.invoice.status).toBe("rejected");
  });

  it("reloads and keeps the screen as it is when there is no review and no status", () => {
    const current = inReview();
    expect(applyActionResponse(current, { review: null })).toEqual({
      review: current,
      decided: null,
      reload: true,
    });
  });

  it("copes with no review on screen yet", () => {
    expect(applyActionResponse(null, { review: null, status: "approved", reload: true })).toEqual({
      review: null,
      decided: "approved",
      reload: true,
    });
  });
});

describe("decidedNoticeKey", () => {
  it("has an Italian and an English sentence for each decision", () => {
    for (const status of ["approved", "rejected"] as const) {
      const key = decidedNoticeKey(status);
      expect(messages.it[key]).toBeTruthy();
      expect(messages.en[key]).toBeTruthy();
    }
    expect(messages.it[decidedNoticeKey("approved")]).toMatch(/approvata/);
    expect(messages.it[decidedNoticeKey("rejected")]).toMatch(/rifiutata/);
  });
});
