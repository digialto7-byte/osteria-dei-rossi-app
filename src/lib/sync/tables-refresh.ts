import type { SyncKind } from "@/server/sync/constants";

// Which settled operations change the table list (M20 follow-up). The worker keeps a copy of /api/tables; an opened table makes that copy
// stale (it still calls the table free), so a waiter who loses the connection and goes back to the tables would open it a second time. Only
// an open_table that the server took (applied, or a duplicate of one it had already taken) changes the list: edits, adds, fires and voids
// do not, and a conflict or a refusal changed nothing.

export interface SettledEvent {
  kind: SyncKind;
  status: "applied" | "conflict" | "rejected" | "duplicate" | "dropped";
  /** A duplicate carries the first answer's conflict or error here; without either, the first answer was `applied`. */
  conflict?: unknown;
  error?: unknown;
}

/** True when at least one of the settled operations opened a table. */
export function tablesChanged(settled: readonly SettledEvent[]): boolean {
  return settled.some(
    (event) =>
      event.kind === "open_table" &&
      (event.status === "applied" ||
        (event.status === "duplicate" &&
          event.conflict === undefined &&
          event.error === undefined)),
  );
}
