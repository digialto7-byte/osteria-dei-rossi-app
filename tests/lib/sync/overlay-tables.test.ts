import { describe, expect, it } from "vitest";
import { overlayTables } from "@/lib/sync/overlay-tables";
import type { TablesList } from "@/server/tables/output";
import {
  addDraft,
  DEMO,
  DUE,
  fireDraft,
  openDraft,
  queued,
  SYNC_IDS,
} from "../../helpers/sync-data";

// A table opened with no connection must not look free when the waiter goes back to the list (M20 plan §3.6.4/§3.6.5): a second tap would
// queue a second session id for the same table and meet `table_already_open` at replay.
const tile = (
  id: string,
  name: string,
  session: TablesList["tables"][number]["session"] = null,
) => ({
  id,
  name,
  position: 1,
  status: session ? ("open" as const) : ("free" as const),
  session,
});
const LIST: TablesList = {
  businessDate: "2026-11-02",
  tables: [
    tile(SYNC_IDS.table1, "Tavolo 1 (demo)"),
    tile(SYNC_IDS.table2, "Tavolo 2 (demo)", {
      id: "5e000000-0000-4000-8000-0000000000aa",
      covers: 3,
      openedAt: "2026-11-02T18:00:00.000Z",
      openedToday: true,
      waiter: { id: DUE.id, displayName: DUE.displayName },
      billRequested: false,
      coperto: null,
    }),
  ],
};

describe("overlayTables", () => {
  it("a queued open_table makes the free table open, with the session id, covers and the waiter who queued it", () => {
    const result = overlayTables(LIST, [queued(openDraft(1, "s1"), 1)]);
    const first = result.tables.find((t) => t.id === SYNC_IDS.table1)!;
    expect(first.status).toBe("open");
    expect(first.session).toMatchObject({
      id: SYNC_IDS.s1,
      covers: 2,
      openedToday: true,
      waiter: { id: DEMO.id, displayName: DEMO.displayName },
      billRequested: false,
      coperto: null,
    });
    expect(first.session!.openedAt).toBe(queued(openDraft(1, "s1"), 1).clientTs);
  });

  it("leaves a table that is already open on the server alone (the queued open will meet table_already_open and say so)", () => {
    const result = overlayTables(LIST, [
      queued(
        {
          ...openDraft(1, "s1"),
          payload: { tableId: SYNC_IDS.table2, sessionId: SYNC_IDS.s1, covers: 2 },
        },
        1,
      ),
    ]);
    expect(result.tables.find((t) => t.id === SYNC_IDS.table2)).toEqual(LIST.tables[1]);
  });

  it("a queued fire on the stub session makes it 'courses_sent'", () => {
    const result = overlayTables(LIST, [
      queued(openDraft(1, "s1"), 1),
      queued(fireDraft(2, [1], "s1"), 2),
    ]);
    expect(result.tables.find((t) => t.id === SYNC_IDS.table1)!.status).toBe("courses_sent");
  });

  it("ops that are not an open_table change nothing, and no ops give the same list", () => {
    expect(overlayTables(LIST, [queued(addDraft(1), 1)])).toEqual(LIST);
    expect(overlayTables(LIST, [])).toEqual(LIST);
  });

  it("does not change its input", () => {
    const before = JSON.stringify(LIST);
    overlayTables(LIST, [queued(openDraft(1, "s1"), 1)]);
    expect(JSON.stringify(LIST)).toBe(before);
  });

  it("an open for a table that is not in the list is ignored", () => {
    const op = queued(
      {
        ...openDraft(1, "s1"),
        payload: {
          tableId: "7a000000-0000-4000-8000-0000000000ff",
          sessionId: SYNC_IDS.s1,
          covers: 2,
        },
      },
      1,
    );
    expect(overlayTables(LIST, [op])).toEqual(LIST);
  });
});
