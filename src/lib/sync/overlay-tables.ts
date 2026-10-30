import type { TablesList } from "@/server/tables/output";
import type { OutboxOp } from "./types";

/**
 * The table list with the tables opened on this phone and not yet sent (M20 plan §3.6.4). A free table with a queued open_table shows as
 * open, with the session the phone made and the waiter who queued it, so it is not opened a second time; a queued fire on that session
 * makes it "courses_sent". A table the server already shows open is left alone. Pure.
 */
export function overlayTables(list: TablesList, ops: readonly OutboxOp[]): TablesList {
  const opens = ops.filter((op) => op.kind === "open_table").sort((a, b) => a.seq - b.seq);
  if (opens.length === 0) return list;
  const fired = new Set(ops.filter((op) => op.kind === "fire").map((op) => op.scope.sessionId));
  return {
    ...list,
    tables: list.tables.map((table) => {
      if (table.session !== null) return table;
      const open = opens.find((op) => op.payload.tableId === table.id);
      if (!open) return table;
      return {
        ...table,
        status: fired.has(open.scope.sessionId) ? "courses_sent" : "open",
        session: {
          id: open.scope.sessionId,
          covers: Number(open.payload.covers),
          openedAt: open.clientTs,
          openedToday: true,
          waiter: { id: open.queuedBy.id, displayName: open.queuedBy.displayName },
          billRequested: false,
          coperto: null,
        },
      };
    }),
  };
}
