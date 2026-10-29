import type { SyncKind } from "@/server/sync/constants";
import type { OpError, SyncConflict } from "@/server/sync/output";

// The shapes the phone keeps for the offline queue (M20 plan §3.6.1). Plain data: the pure modules of src/lib/sync work on these,
// and src/pwa/outbox.ts stores them in IndexedDB. Nothing here is a cost; a label holds the dish and table names as shown when
// the op was queued, so a notice can name them without reading the server.

/** What the op is about, so it can be shown and pruned without the server. */
export interface OpScope {
  sessionId: string;
  lineId?: string;
}

export interface OpLabel {
  tableName?: string;
  dishName?: string;
  qty?: number;
}

/** Who queued the op (local only, never sent). */
export interface QueuedBy {
  id: string;
  displayName: string;
}

/** What a screen hands to the outbox. */
export interface OpDraft {
  opId?: string;
  kind: SyncKind;
  /** ISO 8601 with an offset: the line stamp for line writes. */
  clientTs: string;
  userId: string;
  payload: Record<string, unknown>;
  scope: OpScope;
  label: OpLabel;
  queuedBy: QueuedBy;
}

/** An op waiting in the outbox. `seq` is the replay order, monotonic per device. */
export interface OutboxOp extends Omit<OpDraft, "opId"> {
  opId: string;
  seq: number;
  attempts: number;
  lastAttemptAt: number | null;
}

export type OutcomeStatus = "applied" | "conflict" | "rejected" | "duplicate" | "dropped";

/** Why the phone dropped an op it never sent (`dropped` exists only on the phone). */
export type DroppedReason = "session_not_created" | "line_not_created" | "discarded_by_owner";

/** What happened to an op, kept for the notices (and, for applied line writes, the overwritten warning). */
export interface OutcomeRecord {
  opId: string;
  seq: number;
  kind: SyncKind;
  userId: string;
  scope: OpScope;
  label: OpLabel;
  clientTs: string;
  status: OutcomeStatus;
  settledAt: number;
  receivedAt?: string;
  conflict?: SyncConflict;
  error?: OpError;
  droppedReason?: DroppedReason;
  /** The person dismissed the notice. */
  seen: boolean;
}

/** One op leaving the outbox with its outcome. */
export interface Settlement {
  opId: string;
  status: OutcomeStatus;
  settledAt: number;
  receivedAt?: string;
  conflict?: SyncConflict;
  error?: OpError;
  droppedReason?: DroppedReason;
}

export interface LastUser {
  id: string;
  displayName: string;
  role: "owner" | "admin" | "waiter" | "chef";
}
