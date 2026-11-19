import type { OrderLine, OrderView } from "@/server/orders/output";
import { type Course, HELD_FROM, uscitaDefault } from "@/server/orders/constants";
import type { OutboxOp } from "./types";

// The comanda as the phone shows it (M20 plan §3.1.12): the server's view of one session with that session's queued ops applied on
// top, in `seq` order. Pure data shaping; React only renders it. A queued fire never turns a line into "fired" (the kitchen does
// not have it yet): the line stays a draft and carries `queue: "fire"`.

export type QueueFlag = "add" | "edit" | "fire" | "void";

export interface QueuedLine extends OrderLine {
  /** What is waiting to be sent for this line (void beats fire beats add beats edit). */
  queue?: QueueFlag;
  /** The queued ops behind the flag, oldest first. */
  queuedOpIds?: string[];
  /** The line was created by an add that is still in the outbox: it can be thrown away ("Scarta"). */
  queuedAddOpId?: string;
}

/**
 * The session the comanda shows. `source: "server"` is the server's view as it is. `source: "queued"` is a table opened offline whose
 * open is still in the outbox: it carries only what the phone really knows (the covers, the opener who queued it, the tap time). The
 * server stamps openedAt when it applies the open and freezes the coperto from the sale settings then, so none of openedAt, openedToday
 * and coperto exists on this variant (no invented value: a screen must narrow on `source` before reading them).
 */
export type OverlaidSession =
  | (OrderView["session"] & { source: "server" })
  | (Omit<OrderView["session"], "openedAt" | "openedToday" | "coperto"> & {
      source: "queued";
      /** When the waiter tapped (the op's clientTs), not when the server opened the table. */
      queuedAt: string;
    });

export interface OverlaidOrder {
  session: OverlaidSession;
  lines: QueuedLine[];
  /** Comanda per uscita: the uscite whose call ("Via la n") is still in the outbox ("in coda"), in queue order. */
  queuedCalls: number[];
}

const RANK: Record<QueueFlag, number> = { edit: 1, add: 2, fire: 3, void: 4 };
const FIELDS = ["qty", "course", "uscita", "segue", "note", "isShared", "weightG"] as const;

function flag(line: QueuedLine, queue: QueueFlag, opId: string): void {
  if (line.queue === undefined || RANK[queue] > RANK[line.queue]) line.queue = queue;
  line.queuedOpIds = [...(line.queuedOpIds ?? []), opId];
}

export function overlayOrder(
  view: OrderView | null,
  ops: readonly OutboxOp[],
  sessionId: string,
): OverlaidOrder | null {
  const mine = ops.filter((op) => op.scope.sessionId === sessionId).sort((a, b) => a.seq - b.seq);

  let session: OverlaidSession;
  if (view) {
    session = { ...view.session, source: "server" };
  } else {
    const open = mine.find((op) => op.kind === "open_table");
    if (!open) return null;
    session = {
      source: "queued",
      id: sessionId,
      tableId: String(open.payload.tableId),
      tableName: open.label.tableName ?? "",
      covers: Number(open.payload.covers),
      status: "open",
      billRequested: false,
      closed: false,
      openedBy: { displayName: open.queuedBy.displayName },
      queuedAt: open.clientTs,
    };
  }

  const lines: QueuedLine[] = (view?.lines ?? []).map((line) => ({ ...line }));
  const find = (id: unknown) => lines.find((line) => line.id === id);
  const queuedCalls: number[] = [];

  for (const op of mine) {
    switch (op.kind) {
      case "add_line": {
        const id = String(op.payload.lineId);
        if (find(id)) break; // the server already holds it: the replay will answer `duplicate`
        const uscita =
          (op.payload.uscita as number | undefined) ??
          (op.payload.segue === true
            ? HELD_FROM
            : uscitaDefault((op.payload.course as Course | undefined) ?? "secondi"));
        const added: QueuedLine = {
          id,
          menuItemId: String(op.payload.menuItemId),
          name: op.label.dishName ?? "",
          course: (op.payload.course as Course | undefined) ?? "secondi",
          qty: (op.payload.qty as number | undefined) ?? 1,
          uscita,
          segue: uscita >= HELD_FROM,
          note: null,
          isShared: false,
          unitPrice: op.label.unitPrice ?? 0,
          weightG: (op.payload.weightG as number | undefined) ?? null,
          pricePer100g: op.label.pricePer100g ?? null,
          state: "draft",
          clientUpdatedAt: op.clientTs,
          updatedAt: op.clientTs,
          updatedBy: { id: op.queuedBy.id, displayName: op.queuedBy.displayName },
        };
        flag(added, "add", op.opId);
        added.queuedAddOpId = op.opId;
        lines.push(added);
        break;
      }
      case "edit_line": {
        const line = find(op.payload.lineId);
        if (!line || line.state !== "draft") break;
        for (const field of FIELDS) {
          if (op.payload[field] !== undefined) Object.assign(line, { [field]: op.payload[field] });
        }
        // uscita and segue mirror each other, as the server writes them (a legacy segue edit lands in the 2nd or the course default).
        if (op.payload.uscita !== undefined) line.segue = Number(op.payload.uscita) >= HELD_FROM;
        else if (op.payload.segue !== undefined) {
          line.uscita = op.payload.segue === true ? HELD_FROM : uscitaDefault(line.course);
        }
        line.clientUpdatedAt = op.clientTs;
        line.updatedBy = { id: op.queuedBy.id, displayName: op.queuedBy.displayName };
        flag(line, "edit", op.opId);
        break;
      }
      case "remove_line": {
        const index = lines.findIndex((line) => line.id === op.payload.lineId);
        if (index >= 0 && lines[index]!.state === "draft") lines.splice(index, 1);
        break;
      }
      case "fire": {
        const ids = Array.isArray(op.payload.lineIds) ? op.payload.lineIds : [];
        for (const id of ids) {
          const line = find(id);
          if (line && line.state === "draft") flag(line, "fire", op.opId);
        }
        break;
      }
      case "void_line": {
        const line = find(op.payload.lineId);
        if (line && line.state !== "voided") flag(line, "void", op.opId);
        break;
      }
      case "call_uscita": {
        const uscita = Number(op.payload.uscita);
        if (!queuedCalls.includes(uscita)) queuedCalls.push(uscita);
        break;
      }
      case "open_table":
        break;
    }
  }
  return { session, lines, queuedCalls };
}
