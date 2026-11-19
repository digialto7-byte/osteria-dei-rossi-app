import type { TablesList, TableTile } from "@/server/tables/output";
import { unsentLines } from "@/lib/orders/order-view";
import { overlayOrder } from "./overlay";
import type { OutboxOp } from "./types";

type ServerSession = NonNullable<TableTile["session"]>;

/**
 * The session a tile shows. `source: "server"` is the server's session as it is. `source: "queued"` is a table opened on this phone whose
 * open is still in the outbox: it carries only what the phone really knows (the session id, the covers, the waiter who queued it, no bill
 * request, the real unsent count of this phone's queue, and the tap time). The server stamps openedAt, decides openedToday and freezes the
 * coperto when it applies the open, so none of them exists on this variant (a coperto of null would mean "no coperto", not "unknown"): a
 * screen must narrow on `source` before reading them. The server's `TablesList` stays the server's exact reply; this type is the client's.
 */
export type ShownTileSession =
  | (ServerSession & { source: "server" })
  | (Omit<ServerSession, "openedAt" | "openedToday" | "coperto"> & {
      source: "queued";
      /** When the waiter tapped (the op's clientTs), not when the server opened the table. */
      queuedAt: string;
    });

export type ShownTile = Omit<TableTile, "session"> & { session: ShownTileSession | null };
export type ShownTables = Omit<TablesList, "tables"> & { tables: ShownTile[] };

/**
 * The table list with the tables opened on this phone and not yet sent (M20 plan §3.6.4). A free table with a queued open_table shows as
 * open, with the session the phone made and the waiter who queued it, so it is not opened a second time; a queued fire on that session
 * makes it "courses_sent". A table the server already shows open is left alone (its session is tagged `source: "server"`). Pure.
 */
export function overlayTables(list: TablesList, ops: readonly OutboxOp[]): ShownTables {
  const opens = ops.filter((op) => op.kind === "open_table").sort((a, b) => a.seq - b.seq);
  const fired = new Set(ops.filter((op) => op.kind === "fire").map((op) => op.scope.sessionId));
  return {
    ...list,
    tables: list.tables.map((table): ShownTile => {
      const { session } = table;
      if (session !== null) return { ...table, session: { ...session, source: "server" } };
      // A table joined to a seated booking is left alone: the queued open would meet table_joined at replay.
      if (table.status === "joined") return { ...table, session: null };
      const open = opens.find((op) => op.payload.tableId === table.id);
      if (!open) return { ...table, session: null };
      // overlayOrder returns null only when the session has no queued open_table, and `open` is that op: a null here is a bug, not a state.
      const stub = overlayOrder(null, ops, open.scope.sessionId);
      if (stub === null)
        throw new Error(`overlayTables: no stub order for queued session ${open.scope.sessionId}`);
      return {
        ...table,
        status: fired.has(open.scope.sessionId) ? "courses_sent" : "open",
        session: {
          source: "queued",
          id: open.scope.sessionId,
          covers: Number(open.payload.covers),
          waiter: { id: open.queuedBy.id, displayName: open.queuedBy.displayName },
          billRequested: false,
          // The real count of this phone's queue for the new session (BQ-1): the line ops are replayed on the stub order, no placeholder.
          unsentCount: unsentLines(stub.lines).length,
          // Comanda per uscita: the server has nothing of a session it has not seen yet, so no uscita is in its kitchen; the phone's own
          // queued sends are the overlay's to show ("in coda"), not the server's uscite.
          uscite: null,
          queuedAt: open.clientTs,
        },
      };
    }),
  };
}
