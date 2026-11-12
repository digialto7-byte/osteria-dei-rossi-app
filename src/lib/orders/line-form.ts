import { newSessionId } from "@/lib/tables/session-id";
import {
  MAX_QTY,
  WEIGHT_CONFIRM_FACTOR,
  WEIGHT_MIN_G,
  WEIGHT_STEP_G,
} from "@/server/orders/constants";
import type { Course } from "@/server/orders/constants";
import type { OrderLine } from "@/server/orders/output";
import type { AddLineBody, RemoveLineBody, UpdateLineBody } from "@/server/orders/schemas";

// The order screen's form logic, pure. The client makes the line id (ADR-017: a retry or an offline replay of one id
// is one line, never two) and the stamp (`clientUpdatedAt`, the last-write-wins instant). Nothing here prices a line or
// decides availability: the database does, and the reply is what the screen shows.

/** A new line id. Same fallback as the session ids: `crypto.randomUUID` needs a secure context, a plain http page does not have it. */
export const newLineId = newSessionId;

/** One millisecond: the smallest step of an ISO instant with `toISOString`. */
const MS = 1;

/**
 * The instant to send as `clientUpdatedAt`. It is `now`, but never at or before the line's own stamp: a phone whose
 * clock is behind the one that last wrote the line would otherwise lose to a line it is looking at. A stale copy still
 * carries the old stamp, so a real overlap with a colleague is still answered with `conflict`.
 */
export function clientStamp(now: Date, line?: Pick<OrderLine, "clientUpdatedAt">): string {
  let at = now.getTime();
  if (line) {
    const last = Date.parse(line.clientUpdatedAt);
    if (Number.isFinite(last) && last >= at) at = last + MS;
  }
  return new Date(at).toISOString();
}

/** The quantity after a tap on "−" or "+": whole portions, from 1 to 99. */
export function nextQty(current: number, step: 1 | -1): number {
  const next = step > 0 ? Math.floor(current) + 1 : Math.ceil(current) - 1;
  return Math.min(MAX_QTY, Math.max(1, next));
}

/** "Mezza porzione": a half becomes one portion again, anything else becomes a half. */
export const toggleHalf = (current: number): number => (current === 0.5 ? 1 : 0.5);
export const halfPressed = (qty: number): boolean => qty === 0.5;

/** The grams typed in the weight sheet: whole grams, digits only; null for anything else (also for 0). */
export function parseWeightText(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const grams = Number(trimmed);
  return grams > 0 ? grams : null;
}

/**
 * Whether the sheet may send this weight: the minimum, the step and the menu's maximum (`weightMaxG`). A check before a
 * request only: the database parses the same rules and stays the authority (`weight_invalid`).
 */
export const weightAllowed = (grams: number, maxG: number): boolean =>
  Number.isInteger(grams) && grams >= WEIGHT_MIN_G && grams <= maxG && grams % WEIGHT_STEP_G === 0;

/** From 3 times the dish's reference portion the sheet asks "Confermi?": 1 500 g typed for 150 g is caught. */
export const weightNeedsConfirm = (grams: number, portionWeightG: number | null): boolean =>
  portionWeightG !== null && grams >= WEIGHT_CONFIRM_FACTOR * portionWeightG;

/** The body of a tap on a dish: the selected course, nothing else (the price is the database's); a weighted dish adds its grams and no qty. */
export function addBody(
  input: { lineId: string; menuItemId: string; course: Course; weightG?: number },
  now: Date,
): AddLineBody {
  return { ...input, clientUpdatedAt: clientStamp(now) };
}

type Changes = Partial<Pick<OrderLine, "qty" | "course" | "segue" | "isShared">> & {
  note?: string | null;
  /** The new weight of a weighted draft line, in grams (the line price follows it, in the database). */
  weightG?: number;
};

// The database trims a note and stores a blank one as null; compare and send it that way.
const cleanNote = (note: string | null): string | null => {
  const trimmed = note === null ? "" : note.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * The PATCH body for the edits the waiter made to `line`: only the fields that differ from what the screen holds,
 * plus the stamp. Null when nothing differs (no request is sent).
 */
export function patchFor(line: OrderLine, changes: Changes, now: Date): UpdateLineBody | null {
  const patch: Omit<UpdateLineBody, "clientUpdatedAt"> = {};
  if (changes.qty !== undefined && changes.qty !== line.qty) patch.qty = changes.qty;
  if (changes.course !== undefined && changes.course !== line.course) patch.course = changes.course;
  if (changes.segue !== undefined && changes.segue !== line.segue) patch.segue = changes.segue;
  if (changes.isShared !== undefined && changes.isShared !== line.isShared) {
    patch.isShared = changes.isShared;
  }
  if (changes.weightG !== undefined && changes.weightG !== line.weightG) {
    patch.weightG = changes.weightG;
  }
  if (changes.note !== undefined) {
    const note = cleanNote(changes.note);
    if (note !== line.note) patch.note = note;
  }
  if (Object.keys(patch).length === 0) return null;
  return { ...patch, clientUpdatedAt: clientStamp(now, line) };
}

/** The body of "Rimuovi". */
export function removeBody(line: OrderLine, now: Date): RemoveLineBody {
  return { clientUpdatedAt: clientStamp(now, line) };
}

/** "−" works above one portion (a half portion is set with its own toggle); "+" works below 99. */
export const canDecrease = (qty: number): boolean => qty > 1;
export const canIncrease = (qty: number): boolean => qty < MAX_QTY;
