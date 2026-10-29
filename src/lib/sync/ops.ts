import { clientStamp, patchFor, removeBody } from "@/lib/orders/line-form";
import { chunkFireIds } from "@/lib/orders/fire-view";
import type { Course, VoidReason } from "@/server/orders/constants";
import type { OrderLine } from "@/server/orders/output";
import type { OpDraft, QueuedBy } from "./types";

// The six op builders (M20 plan §3.1.2, §3.6.2): pure, they turn what the waiter did into a draft for the outbox. The stamp of a line
// write is `clientTs` and follows ADR-017's `clientStamp(now, line)`: the phone's clock, but at least one millisecond after the
// stamp of the line AS THE PHONE SHOWS IT (the server copy with the queued ops applied, so a queued earlier edit counts). It is
// computed when the op is queued, not when it is sent. The payload never carries a stamp.

type Editable = Parameters<typeof patchFor>[1];

export function openTableDraft(input: {
  me: QueuedBy;
  tableId: string;
  tableName: string;
  sessionId: string;
  covers: number;
  now: Date;
}): OpDraft {
  return {
    kind: "open_table",
    clientTs: input.now.toISOString(),
    userId: input.me.id,
    payload: { tableId: input.tableId, sessionId: input.sessionId, covers: input.covers },
    scope: { sessionId: input.sessionId },
    label: { tableName: input.tableName },
    queuedBy: input.me,
  };
}

export function addLineDraft(input: {
  me: QueuedBy;
  sessionId: string;
  tableName: string;
  lineId: string;
  item: { id: string; name: string };
  course?: Course;
  qty?: number;
  now: Date;
}): OpDraft {
  return {
    kind: "add_line",
    clientTs: clientStamp(input.now),
    userId: input.me.id,
    payload: {
      sessionId: input.sessionId,
      lineId: input.lineId,
      menuItemId: input.item.id,
      ...(input.course !== undefined ? { course: input.course } : {}),
      ...(input.qty !== undefined ? { qty: input.qty } : {}),
    },
    scope: { sessionId: input.sessionId, lineId: input.lineId },
    label: { tableName: input.tableName, dishName: input.item.name, qty: input.qty ?? 1 },
    queuedBy: input.me,
  };
}

/** Null when nothing differs from what the phone shows (no op is queued). */
export function editLineDraft(input: {
  me: QueuedBy;
  line: OrderLine;
  tableName: string;
  changes: Editable;
  sessionId: string;
  now: Date;
}): OpDraft | null {
  const patch = patchFor(input.line, input.changes, input.now);
  if (!patch) return null;
  const { clientUpdatedAt, ...fields } = patch;
  return lineDraft(input, "edit_line", { lineId: input.line.id, ...fields }, clientUpdatedAt);
}

export function removeLineDraft(input: {
  me: QueuedBy;
  line: OrderLine;
  tableName: string;
  sessionId: string;
  now: Date;
}): OpDraft {
  return lineDraft(
    input,
    "remove_line",
    { lineId: input.line.id },
    removeBody(input.line, input.now).clientUpdatedAt,
  );
}

export function voidLineDraft(input: {
  me: QueuedBy;
  line: OrderLine;
  tableName: string;
  reason: VoidReason;
  sessionId: string;
  now: Date;
}): OpDraft {
  return lineDraft(
    input,
    "void_line",
    { lineId: input.line.id, reason: input.reason },
    clientStamp(input.now, input.line),
  );
}

/** One fire op per 50 ids (the server takes 1 to 50 per fire), in order, none lost. */
export function fireDrafts(input: {
  me: QueuedBy;
  sessionId: string;
  tableName: string;
  lineIds: readonly string[];
  now: Date;
}): OpDraft[] {
  return chunkFireIds(input.lineIds).map((lineIds) => ({
    kind: "fire",
    clientTs: input.now.toISOString(),
    userId: input.me.id,
    payload: { sessionId: input.sessionId, lineIds },
    scope: { sessionId: input.sessionId },
    label: { tableName: input.tableName },
    queuedBy: input.me,
  }));
}

function lineDraft(
  input: { me: QueuedBy; line: OrderLine; tableName: string; sessionId: string },
  kind: "edit_line" | "remove_line" | "void_line",
  payload: Record<string, unknown>,
  clientTs: string,
): OpDraft {
  return {
    kind,
    clientTs,
    userId: input.me.id,
    payload,
    scope: { sessionId: input.sessionId, lineId: input.line.id },
    label: { tableName: input.tableName, dishName: input.line.name, qty: input.line.qty },
    queuedBy: input.me,
  };
}
