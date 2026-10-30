// Fake data for the offline-queue tests (M20). Every name, id and instant is invented.
import type { OpDraft, OutboxOp } from "@/lib/sync/types";
import type { OpResult, SyncOutput } from "@/server/sync/output";
import { LINE_STEW } from "./orders-data";

export const SYNC_IDS = {
  waiterDemo: "a0000000-0000-4000-8000-000000000001",
  waiterDue: "a0000000-0000-4000-8000-000000000002",
  s1: "5e000000-0000-4000-8000-000000000001",
  s2: "5e000000-0000-4000-8000-000000000002",
  table1: "7a000000-0000-4000-8000-000000000001",
  table2: "7a000000-0000-4000-8000-000000000002",
  item: "3e000000-0000-4000-8000-000000000001",
  acqua: "3e000000-0000-4000-8000-000000000003",
};

export const DEMO = { id: SYNC_IDS.waiterDemo, displayName: "Cameriere Demo" };
export const DUE = { id: SYNC_IDS.waiterDue, displayName: "Cameriere Due Demo" };

export const lineId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const opId = (n: number) => `0e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const STEW = "Spezzatino con polenta (demo)";

/** A draft of an add_line on a session (the line id is lineId(n)). */
export function addDraft(
  n: number,
  session: "s1" | "s2" = "s1",
  who: { id: string; displayName: string } = DEMO,
  dish = STEW,
): OpDraft {
  return {
    kind: "add_line",
    clientTs: new Date(Date.UTC(2026, 10, 2, 19, 30, n)).toISOString(),
    userId: who.id,
    payload: { sessionId: SYNC_IDS[session], lineId: lineId(n), menuItemId: SYNC_IDS.item },
    scope: { sessionId: SYNC_IDS[session], lineId: lineId(n) },
    label: { tableName: session === "s1" ? "Tavolo 1 (demo)" : "Tavolo 2 (demo)", dishName: dish },
    queuedBy: who,
  };
}

export function editDraft(
  n: number,
  line: number,
  session: "s1" | "s2" = "s1",
  who: { id: string; displayName: string } = DEMO,
): OpDraft {
  return {
    ...addDraft(n, session, who),
    kind: "edit_line",
    payload: { lineId: lineId(line), qty: 2 },
    scope: { sessionId: SYNC_IDS[session], lineId: lineId(line) },
  };
}

export function fireDraft(
  n: number,
  lines: number[],
  session: "s1" | "s2" = "s1",
  who: { id: string; displayName: string } = DEMO,
): OpDraft {
  return {
    ...addDraft(n, session, who),
    kind: "fire",
    payload: { sessionId: SYNC_IDS[session], lineIds: lines.map(lineId) },
    scope: { sessionId: SYNC_IDS[session] },
    label: { tableName: session === "s1" ? "Tavolo 1 (demo)" : "Tavolo 2 (demo)" },
  };
}

export function openDraft(
  n: number,
  session: "s1" | "s2" = "s1",
  who: { id: string; displayName: string } = DEMO,
): OpDraft {
  return {
    ...addDraft(n, session, who),
    kind: "open_table",
    payload: { tableId: SYNC_IDS.table1, sessionId: SYNC_IDS[session], covers: 2 },
    scope: { sessionId: SYNC_IDS[session] },
    label: { tableName: session === "s1" ? "Tavolo 1 (demo)" : "Tavolo 2 (demo)" },
  };
}

/** An outbox op as the outbox would hold it (seq n, no attempts). */
export const queued = (draft: OpDraft, seq: number): OutboxOp => ({
  ...draft,
  opId: draft.opId ?? opId(seq),
  seq,
  attempts: 0,
  lastAttemptAt: null,
});

const RECEIVED = "2026-11-02T19:31:00.000000+00:00";

/** The server's result for an op, by status (the content is plausible; the engine only reads status, conflict and error). */
export function resultFor(
  op: { opId: string; kind: OpResult["kind"] },
  status: "applied" | "conflict" | "rejected" | "duplicate",
  extra: Record<string, unknown> = {},
): OpResult {
  const head = { opId: op.opId, kind: op.kind };
  switch (status) {
    case "applied":
      return {
        ...head,
        status,
        receivedAt: RECEIVED,
        reply: { changed: true, line: LINE_STEW },
        ...extra,
      } as OpResult;
    case "conflict":
      return {
        ...head,
        status,
        receivedAt: RECEIVED,
        conflict: { reason: "fired", line: { ...LINE_STEW, state: "fired" } },
        ...extra,
      } as OpResult;
    case "rejected":
      return {
        ...head,
        status,
        receivedAt: RECEIVED,
        error: {
          httpStatus: 409,
          code: "item_unavailable",
          message: "Il piatto è esaurito.",
        },
        ...extra,
      } as OpResult;
    case "duplicate":
      return {
        ...head,
        status,
        stored: {
          status: "applied",
          receivedAt: RECEIVED,
          reply: { changed: true, line: LINE_STEW },
        },
        ...extra,
      } as OpResult;
  }
}

export function syncOutputOf(
  results: OpResult[],
  stopped: SyncOutput["stopped"] = null,
  serverTime = "2026-11-02T19:31:00.000Z",
): SyncOutput {
  return { results, stopped, serverTime };
}
