import { newSessionId } from "@/lib/tables/session-id";
import { MAX_QTY } from "@/server/orders/constants";
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

/** The body of a tap on a dish: qty 1, the selected course, nothing else (the price is the database's). */
export function addBody(
  input: { lineId: string; menuItemId: string; course: Course },
  now: Date,
): AddLineBody {
  return { ...input, clientUpdatedAt: clientStamp(now) };
}

type Changes = Partial<Pick<OrderLine, "qty" | "course" | "segue" | "isShared">> & {
  note?: string | null;
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
