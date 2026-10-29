import { describe, expect, it } from "vitest";
import {
  addLineDraft,
  editLineDraft,
  fireDrafts,
  openTableDraft,
  removeLineDraft,
  voidLineDraft,
} from "@/lib/sync/ops";
import { clientStamp } from "@/lib/orders/line-form";
import { syncBody } from "@/server/sync/schemas";
import { PAYLOADS } from "@/server/sync/schemas";
import { LINE_STEW } from "../../helpers/orders-data";
import { DEMO, lineId, SYNC_IDS } from "../../helpers/sync-data";

const NOW = new Date("2026-11-02T19:30:10.000Z");
const ME = DEMO;
const line = { ...LINE_STEW, id: lineId(1), clientUpdatedAt: "2026-11-02T19:30:00.000Z" };

describe("openTableDraft", () => {
  it("is an open_table op for the table, with the label and the phone's instant", () => {
    const draft = openTableDraft({
      me: ME,
      tableId: SYNC_IDS.table1,
      tableName: "Tavolo 1 (demo)",
      sessionId: SYNC_IDS.s1,
      covers: 2,
      now: NOW,
    });
    expect(draft).toMatchObject({
      kind: "open_table",
      clientTs: NOW.toISOString(),
      userId: ME.id,
      payload: { tableId: SYNC_IDS.table1, sessionId: SYNC_IDS.s1, covers: 2 },
      scope: { sessionId: SYNC_IDS.s1 },
      label: { tableName: "Tavolo 1 (demo)" },
      queuedBy: ME,
    });
    expect(PAYLOADS.open_table.safeParse(draft.payload).success).toBe(true);
  });
});

describe("addLineDraft", () => {
  it("clientTs is the stamp of a new line (now), the payload has no stamp, the label has the dish", () => {
    const draft = addLineDraft({
      me: ME,
      sessionId: SYNC_IDS.s1,
      tableName: "Tavolo 1 (demo)",
      lineId: lineId(5),
      item: { id: SYNC_IDS.item, name: "Spezzatino con polenta (demo)" },
      course: "secondi",
      now: NOW,
    });
    expect(draft.clientTs).toBe(clientStamp(NOW));
    expect(draft.payload).toEqual({
      sessionId: SYNC_IDS.s1,
      lineId: lineId(5),
      menuItemId: SYNC_IDS.item,
      course: "secondi",
    });
    expect(draft.scope).toEqual({ sessionId: SYNC_IDS.s1, lineId: lineId(5) });
    expect(draft.label).toMatchObject({ dishName: "Spezzatino con polenta (demo)" });
    expect(PAYLOADS.add_line.safeParse(draft.payload).success).toBe(true);
  });
});

describe("editLineDraft: the stamp is clientStamp(now, the line as the phone shows it)", () => {
  it("a line stamped in the past: the stamp is now", () => {
    const draft = editLineDraft({
      me: ME,
      sessionId: SYNC_IDS.s1,
      line,
      tableName: "Tavolo 1 (demo)",
      changes: { qty: 3 },
      now: NOW,
    });
    expect(draft?.clientTs).toBe(NOW.toISOString());
    expect(draft?.payload).toEqual({ lineId: lineId(1), qty: 3 });
  });

  it("a queued earlier edit (the overlay line carries its stamp): later than it, even on the same millisecond", () => {
    const shown = { ...line, clientUpdatedAt: NOW.toISOString() };
    const draft = editLineDraft({
      me: ME,
      sessionId: SYNC_IDS.s1,
      line: shown,
      tableName: "Tavolo 1 (demo)",
      changes: { qty: 3 },
      now: NOW,
    });
    expect(Date.parse(draft!.clientTs)).toBe(NOW.getTime() + 1);
  });

  it("a server stamp ahead of the phone: bumped past it (the phone's clock is behind)", () => {
    const ahead = { ...line, clientUpdatedAt: "2026-11-02T19:35:00.000Z" };
    const draft = editLineDraft({
      me: ME,
      sessionId: SYNC_IDS.s1,
      line: ahead,
      tableName: "Tavolo 1 (demo)",
      changes: { qty: 3 },
      now: NOW,
    });
    expect(Date.parse(draft!.clientTs)).toBe(Date.parse("2026-11-02T19:35:00.000Z") + 1);
  });

  it("is null when nothing differs (no op is queued)", () => {
    expect(
      editLineDraft({
        me: ME,
        sessionId: SYNC_IDS.s1,
        line,
        tableName: "t",
        changes: { qty: line.qty },
        now: NOW,
      }),
    ).toBeNull();
  });

  it("a blank note is sent as null, and the payload passes the strict schema", () => {
    const draft = editLineDraft({
      me: ME,
      sessionId: SYNC_IDS.s1,
      line: { ...line, note: "ben cotto" },
      tableName: "t",
      changes: { note: "  " },
      now: NOW,
    });
    expect(draft?.payload).toEqual({ lineId: lineId(1), note: null });
    expect(PAYLOADS.edit_line.safeParse(draft!.payload).success).toBe(true);
  });
});

describe("removeLineDraft and voidLineDraft", () => {
  it("remove stamps against the line", () => {
    const draft = removeLineDraft({
      me: ME,
      sessionId: SYNC_IDS.s1,
      line: { ...line, clientUpdatedAt: NOW.toISOString() },
      tableName: "t",
      now: NOW,
    });
    expect(draft.kind).toBe("remove_line");
    expect(draft.payload).toEqual({ lineId: lineId(1) });
    expect(Date.parse(draft.clientTs)).toBe(NOW.getTime() + 1);
    expect(draft.label).toMatchObject({ dishName: line.name });
  });

  it("void carries the reason and the same stamp rule", () => {
    const draft = voidLineDraft({
      me: ME,
      sessionId: SYNC_IDS.s1,
      line,
      tableName: "t",
      reason: "kitchen_error",
      now: NOW,
    });
    expect(draft.kind).toBe("void_line");
    expect(draft.payload).toEqual({ lineId: lineId(1), reason: "kitchen_error" });
    expect(draft.clientTs).toBe(NOW.toISOString());
    expect(PAYLOADS.void_line.safeParse(draft.payload).success).toBe(true);
  });
});

describe("fireDrafts", () => {
  const ids = Array.from({ length: 120 }, (_v, i) => lineId(i + 1));

  it("120 ids are three ops of at most 50, in order, none lost", () => {
    const drafts = fireDrafts({
      me: ME,
      sessionId: SYNC_IDS.s1,
      tableName: "t",
      lineIds: ids,
      now: NOW,
    });
    expect(drafts.map((d) => (d.payload.lineIds as string[]).length)).toEqual([50, 50, 20]);
    expect(drafts.flatMap((d) => d.payload.lineIds as string[])).toEqual(ids);
    for (const d of drafts) {
      expect(d.kind).toBe("fire");
      expect(PAYLOADS.fire.safeParse(d.payload).success).toBe(true);
    }
  });

  it("no ids, no ops", () => {
    expect(
      fireDrafts({ me: ME, sessionId: SYNC_IDS.s1, tableName: "t", lineIds: [], now: NOW }),
    ).toEqual([]);
  });

  it("drafts are accepted by the sync envelope once they have an op id and a seq", () => {
    const [draft] = fireDrafts({
      me: ME,
      sessionId: SYNC_IDS.s1,
      tableName: "t",
      lineIds: ids.slice(0, 2),
      now: NOW,
    });
    const op = {
      opId: lineId(900),
      seq: 1,
      kind: draft!.kind,
      clientTs: draft!.clientTs,
      userId: draft!.userId,
      payload: draft!.payload,
    };
    expect(syncBody.safeParse({ ops: [op] }).success).toBe(true);
  });
});
