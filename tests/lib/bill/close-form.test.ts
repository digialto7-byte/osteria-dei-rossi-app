import { describe, expect, it } from "vitest";
import {
  canSubmitClose,
  closeBlock,
  closeBlockText,
  closeBodyFrom,
  closeButtonLabel,
  EMPTY_CLOSE_FORM,
} from "@/lib/bill/close-form";
import type { OutboxOp } from "@/lib/sync/types";
import { BIDS, TOKEN } from "../../helpers/bill-data";

const op = (sessionId: string): OutboxOp => ({ scope: { sessionId } }) as OutboxOp;
const view = (state: string, ops: OutboxOp[] = []) =>
  ({ state, ops }) as Parameters<typeof closeBlock>[0];

describe("closeBlock", () => {
  it.each(["offline", "backoff", "signedOut"])("is offline when the queue state is %s", (state) => {
    expect(closeBlock(view(state), BIDS.session)).toBe("offline");
  });

  it.each(["idle", "sending"])(
    "is free when the queue state is %s and nothing is queued",
    (state) => {
      expect(closeBlock(view(state), BIDS.session)).toBeNull();
    },
  );

  it("is offline when the last bill read failed by network", () => {
    expect(closeBlock(view("idle"), BIDS.session, true)).toBe("offline");
  });

  it("is queued when the phone holds three ops of this session (pending, waiting or held)", () => {
    const ops = [op(BIDS.session), op(BIDS.session), op(BIDS.session)];
    expect(closeBlock(view("idle", ops), BIDS.session)).toBe("queued");
    expect(closeBlockText("queued", 3)).toBe(
      "Ci sono 3 operazioni di questo tavolo ancora in coda su questo telefono: attendi l'invio.",
    );
  });

  it("is free when only ops of another session are queued", () => {
    expect(closeBlock(view("idle", [op(BIDS.other), op(BIDS.other)]), BIDS.session)).toBeNull();
  });

  it("offline wins over queued", () => {
    expect(closeBlock(view("offline", [op(BIDS.session)]), BIDS.session)).toBe("offline");
  });

  it("words both blocks and none", () => {
    expect(closeBlockText("offline", 0)).toBe("Serve la connessione per chiudere il tavolo.");
    expect(closeBlockText("queued", 1)).toBe(
      "C'è 1 operazione di questo tavolo ancora in coda su questo telefono: attendi l'invio.",
    );
    expect(closeBlockText(null, 0)).toBeNull();
  });
});

describe("close form", () => {
  const filled = {
    receiptType: "scontrino",
    receiptNumber: "0012-0034",
    paymentType: "card",
  } as const;

  it("starts with no document and no payment chosen", () => {
    expect(EMPTY_CLOSE_FORM).toEqual({ receiptType: null, receiptNumber: "", paymentType: null });
  });

  it("the button says 'Chiudi senza numero' when the number is empty or blank, 'Chiudi tavolo' otherwise", () => {
    expect(closeButtonLabel(filled)).toBe("Chiudi tavolo");
    expect(closeButtonLabel({ ...filled, receiptNumber: "" })).toBe("Chiudi senza numero");
    expect(closeButtonLabel({ ...filled, receiptNumber: "   " })).toBe("Chiudi senza numero");
    expect(closeButtonLabel({ ...filled, receiptNumber: "" }, "en")).toBe("Close without a number");
  });

  it("is disabled until a document and a payment are chosen, and while blocked", () => {
    expect(canSubmitClose(EMPTY_CLOSE_FORM, null)).toBe(false);
    expect(canSubmitClose({ ...EMPTY_CLOSE_FORM, receiptType: "scontrino" }, null)).toBe(false);
    expect(canSubmitClose({ ...EMPTY_CLOSE_FORM, paymentType: "card" }, null)).toBe(false);
    expect(canSubmitClose(filled, null)).toBe(true);
    expect(canSubmitClose({ ...filled, receiptNumber: "" }, null)).toBe(true);
    expect(canSubmitClose(filled, "offline")).toBe(false);
    expect(canSubmitClose(filled, "queued")).toBe(false);
  });

  it("builds the body with the token of the last read", () => {
    expect(closeBodyFrom(filled, TOKEN)).toEqual({
      receiptType: "scontrino",
      receiptNumber: "0012-0034",
      paymentType: "card",
      billToken: TOKEN,
    });
  });

  it("sends a blank number as null and trims a typed one", () => {
    expect(closeBodyFrom({ ...filled, receiptNumber: "  " }, TOKEN)?.receiptNumber).toBeNull();
    expect(closeBodyFrom({ ...filled, receiptNumber: " 12/34 " }, TOKEN)?.receiptNumber).toBe(
      "12/34",
    );
  });

  it("builds no body while the form is incomplete", () => {
    expect(closeBodyFrom(EMPTY_CLOSE_FORM, TOKEN)).toBeNull();
    expect(closeBodyFrom({ ...filled, paymentType: null }, TOKEN)).toBeNull();
  });
});
