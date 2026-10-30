import { MAX_SYNC_BODY_BYTES, MAX_SYNC_OPS } from "@/server/sync/constants";
import type { OpEnvelope } from "@/server/sync/schemas";
import type { OutboxOp } from "./types";

/** The op as it goes over the wire: the six envelope keys; the label, the queuer and the attempts stay on the phone. */
export function toWire(op: OutboxOp): OpEnvelope {
  return {
    opId: op.opId,
    seq: op.seq,
    kind: op.kind,
    clientTs: op.clientTs,
    userId: op.userId,
    payload: op.payload,
  };
}

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

/**
 * The first up to 20 sendable ops whose request body stays within 64 KiB (M20 plan §3.1.7). Always at least one op when there is
 * one: an op too big for a request is answered 413 and flagged as stuck, never dropped.
 */
export function takeBatch(
  sendableOps: readonly OutboxOp[],
  maxOps: number = MAX_SYNC_OPS,
  maxBytes: number = MAX_SYNC_BODY_BYTES,
): OutboxOp[] {
  const batch: OutboxOp[] = [];
  const wire: OpEnvelope[] = [];
  for (const op of sendableOps) {
    if (batch.length >= maxOps) break;
    wire.push(toWire(op));
    if (batch.length > 0 && bytes(JSON.stringify({ ops: wire })) > maxBytes) break;
    batch.push(op);
  }
  return batch;
}
