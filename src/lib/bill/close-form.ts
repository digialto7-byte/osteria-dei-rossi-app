import { t, tn } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { SyncView } from "@/lib/sync/view";
import type { PaymentType, ReceiptType } from "@/server/bill/constants";
import type { CloseBody } from "@/server/bill/schemas";

// The close sheet's logic as data (M21 plan §3.1.4, §3.6): when the button is blocked, what it says, and the body it sends. No money.

export interface CloseForm {
  receiptType: ReceiptType | null;
  /** As typed; blank means "no number". */
  receiptNumber: string;
  paymentType: PaymentType | null;
}

export const EMPTY_CLOSE_FORM: CloseForm = {
  receiptType: null,
  receiptNumber: "",
  paymentType: null,
};

export type CloseBlock = "offline" | "queued" | null;

const OFFLINE_STATES = new Set(["offline", "backoff", "signedOut"]);

/**
 * Why the phone cannot close this table now: no connection (the queue is offline, backing off, signed out, or the last bill read failed
 * by network), or it still holds ops of this session, queued, waiting or held (they would not be in the bill). The server checks too:
 * a queued fire of a draft is caught as `unsent_lines`.
 */
export function closeBlock(
  sync: Pick<SyncView, "state" | "ops">,
  sessionId: string,
  billReadFailedByNetwork = false,
): CloseBlock {
  if (OFFLINE_STATES.has(sync.state) || billReadFailedByNetwork) return "offline";
  if (sync.ops.some((op) => op.scope.sessionId === sessionId)) return "queued";
  return null;
}

/** The text under the disabled button; `count` is the number of this table's queued ops. */
export function closeBlockText(
  block: CloseBlock,
  count: number,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (block === "offline") return t("bill.closeBlock.offline", {}, locale);
  if (block === "queued") return tn("bill.closeBlock.queued", count, locale);
  return null;
}

/** How many ops of this session the phone holds (for closeBlockText). */
export function queuedCount(sync: Pick<SyncView, "ops">, sessionId: string): number {
  return sync.ops.filter((op) => op.scope.sessionId === sessionId).length;
}

const hasNumber = (form: CloseForm) => form.receiptNumber.trim() !== "";

export function closeButtonLabel(form: CloseForm, locale: Locale = DEFAULT_LOCALE): string {
  return t(hasNumber(form) ? "bill.close.withNumber" : "bill.close.withoutNumber", {}, locale);
}

/** A document and a payment are chosen (no default), and nothing blocks the close. */
export function canSubmitClose(form: CloseForm, block: CloseBlock): boolean {
  return form.receiptType !== null && form.paymentType !== null && block === null;
}

/** The request body, with the token of the last bill read; null while the form is incomplete. */
export function closeBodyFrom(form: CloseForm, billToken: string): CloseBody | null {
  if (form.receiptType === null || form.paymentType === null) return null;
  const number = form.receiptNumber.trim();
  return {
    receiptType: form.receiptType,
    receiptNumber: number === "" ? null : number,
    paymentType: form.paymentType,
    billToken,
  };
}
