import { describe, expect, it } from "vitest";
import { overlayOrder } from "@/lib/sync/overlay";
import type { OutboxOp } from "@/lib/sync/types";
import { LINE_SOUP, LINE_STEW, OIDS, ORDER_VIEW } from "../../helpers/orders-data";
import {
  addDraft,
  DEMO,
  DUE,
  editDraft,
  fireDraft,
  lineId,
  openDraft,
  queued,
  SYNC_IDS,
} from "../../helpers/sync-data";

// The server view with that session's queued ops applied on top (M20 plan §3.1.12, step 15). Pure data shaping.
const S1 = SYNC_IDS.s1; // = OIDS.session
const editOf = (n: number, line: string, payload: object, who = DEMO): OutboxOp =>
  queued(
    {
      ...editDraft(n, 1, "s1", who),
      payload: { lineId: line, ...payload },
      scope: { sessionId: S1, lineId: line },
      clientTs: `2026-11-02T19:40:0${n}.000Z`,
    },
    n,
  );
const removeOf = (n: number, line: string): OutboxOp =>
  queued(
    {
      ...editDraft(n, 1),
      kind: "remove_line",
      payload: { lineId: line },
      scope: { sessionId: S1, lineId: line },
    },
    n,
  );
const voidOf = (n: number, line: string): OutboxOp =>
  queued(
    {
      ...editDraft(n, 1),
      kind: "void_line",
      payload: { lineId: line, reason: "comp" },
      scope: { sessionId: S1, lineId: line },
    },
    n,
  );
const fireOf = (n: number, ids: string[], session: "s1" | "s2" = "s1"): OutboxOp => ({
  ...queued(fireDraft(n, [], session), n),
  payload: { sessionId: SYNC_IDS[session], lineIds: ids },
});
const byId = <T extends { id: string }>(lines: T[], id: string): T | undefined =>
  lines.find((l) => l.id === id);

describe("overlayOrder with a server view", () => {
  it("no ops: the view as it is", () => {
    const result = overlayOrder(ORDER_VIEW, [], S1);
    expect(result?.session).toEqual(ORDER_VIEW.session);
    expect(result?.lines).toEqual(ORDER_VIEW.lines);
    expect(result?.lines.every((l) => l.queue === undefined)).toBe(true);
  });

  it("a queued add is a pending draft line with the dish, the price of the label and the queuer", () => {
    const add = queued(
      {
        ...addDraft(9),
        label: { tableName: "Tavolo 1 (demo)", dishName: "Acqua (demo)", unitPrice: 3, qty: 2 },
        payload: {
          sessionId: S1,
          lineId: lineId(9),
          menuItemId: SYNC_IDS.acqua,
          course: "dolci",
          qty: 2,
        },
      },
      9,
    );
    const line = byId(overlayOrder(ORDER_VIEW, [add], S1)!.lines, lineId(9))!;
    expect(line).toMatchObject({
      name: "Acqua (demo)",
      menuItemId: SYNC_IDS.acqua,
      course: "dolci",
      qty: 2,
      unitPrice: 3,
      state: "draft",
      queue: "add",
      updatedBy: { id: DEMO.id, displayName: "Cameriere Demo" },
    });
    expect(line.clientUpdatedAt).toBe(add.clientTs);
  });

  it("a queued add names its op, so the screen can offer 'Scarta'; a line from the server does not", () => {
    const result = overlayOrder(ORDER_VIEW, [queued(addDraft(9), 9)], S1)!;
    expect(byId(result.lines, lineId(9))?.queuedAddOpId).toBe(queued(addDraft(9), 9).opId);
    expect(byId(result.lines, LINE_STEW.id)?.queuedAddOpId).toBeUndefined();
  });

  it("a queued add keeps its place after the server's lines", () => {
    const result = overlayOrder(ORDER_VIEW, [queued(addDraft(9), 9)], S1)!;
    expect(result.lines.map((l) => l.id)).toEqual([LINE_SOUP.id, LINE_STEW.id, lineId(9)]);
  });

  it("a queued edit patches the fields and the stamp, and marks the line queued", () => {
    const op = editOf(2, LINE_STEW.id, { qty: 5, note: "ben cotto", segue: true });
    const line = byId(overlayOrder(ORDER_VIEW, [op], S1)!.lines, LINE_STEW.id)!;
    expect(line).toMatchObject({
      qty: 5,
      note: "ben cotto",
      segue: true,
      queue: "edit",
      state: "draft",
    });
    expect(line.clientUpdatedAt).toBe(op.clientTs);
    expect(line.updatedBy.id).toBe(DEMO.id);
    expect(line.isShared).toBe(LINE_STEW.isShared);
  });

  it("two queued edits apply in seq order whatever the array order, and the last stamp stays", () => {
    const first = editOf(2, LINE_STEW.id, { qty: 3 });
    const second = editOf(3, LINE_STEW.id, { qty: 4 });
    const line = byId(overlayOrder(ORDER_VIEW, [second, first], S1)!.lines, LINE_STEW.id)!;
    expect(line.qty).toBe(4);
    expect(line.clientUpdatedAt).toBe(second.clientTs);
  });

  it("a queued removal hides the line", () => {
    const result = overlayOrder(ORDER_VIEW, [removeOf(2, LINE_SOUP.id)], S1)!;
    expect(byId(result.lines, LINE_SOUP.id)).toBeUndefined();
    expect(result.lines.map((l) => l.id)).toEqual([LINE_STEW.id]);
  });

  it("a queued fire flags its lines 'fire' and leaves them DRAFT (the kitchen does not have them yet)", () => {
    const result = overlayOrder(ORDER_VIEW, [fireOf(2, [LINE_STEW.id])], S1)!;
    expect(byId(result.lines, LINE_STEW.id)).toMatchObject({ queue: "fire", state: "draft" });
    expect(byId(result.lines, LINE_SOUP.id)?.queue).toBeUndefined();
    expect(result.lines.some((l) => l.state === "fired")).toBe(false);
  });

  it("a queued void flags the line 'void'; a void beats a fire on the same line", () => {
    const result = overlayOrder(
      ORDER_VIEW,
      [fireOf(2, [LINE_STEW.id]), voidOf(3, LINE_STEW.id)],
      S1,
    )!;
    expect(byId(result.lines, LINE_STEW.id)?.queue).toBe("void");
  });

  it("a queued edit then a queued fire of a NEW line: patched, then flagged fire", () => {
    const add = queued(addDraft(9), 9);
    const edit = editOf(10, lineId(9), { qty: 3 });
    const fire = fireOf(11, [lineId(9)]);
    const line = byId(overlayOrder(ORDER_VIEW, [fire, edit, add], S1)!.lines, lineId(9))!;
    expect(line).toMatchObject({ qty: 3, queue: "fire", state: "draft" });
  });

  it("ops of another session are ignored", () => {
    const other = {
      ...removeOf(2, LINE_SOUP.id),
      scope: { sessionId: SYNC_IDS.s2, lineId: LINE_SOUP.id },
    };
    const result = overlayOrder(ORDER_VIEW, [other, queued(addDraft(9, "s2"), 9)], S1)!;
    expect(result.lines).toEqual(ORDER_VIEW.lines);
  });

  it("a line the server already holds fired or voided is not patched (the server will answer conflict)", () => {
    const fired = { ...ORDER_VIEW, lines: [{ ...LINE_STEW, state: "fired" as const }] };
    const result = overlayOrder(fired, [editOf(2, LINE_STEW.id, { qty: 9 })], S1)!;
    expect(result.lines[0]).toMatchObject({ qty: LINE_STEW.qty, state: "fired" });
    expect(result.lines[0]!.queue).toBeUndefined();
  });

  it("a queued add whose line the server already holds shows the server's line, once", () => {
    const add = queued({ ...addDraft(1), scope: { sessionId: S1, lineId: LINE_STEW.id } }, 1);
    const result = overlayOrder(
      ORDER_VIEW,
      [{ ...add, payload: { ...add.payload, lineId: LINE_STEW.id } }],
      S1,
    )!;
    expect(result.lines.filter((l) => l.id === LINE_STEW.id)).toHaveLength(1);
    expect(byId(result.lines, LINE_STEW.id)).toMatchObject({ qty: LINE_STEW.qty });
  });

  it("does not change its inputs", () => {
    const before = JSON.stringify(ORDER_VIEW);
    overlayOrder(ORDER_VIEW, [removeOf(2, LINE_SOUP.id), editOf(3, LINE_STEW.id, { qty: 7 })], S1);
    expect(JSON.stringify(ORDER_VIEW)).toBe(before);
  });

  it("an add by another waiter on the same session shows their name", () => {
    const line = byId(
      overlayOrder(ORDER_VIEW, [queued(addDraft(9, "s1", DUE), 9)], S1)!.lines,
      lineId(9),
    )!;
    expect(line.updatedBy.displayName).toBe("Cameriere Due Demo");
  });
});

describe("overlayOrder without a server view", () => {
  it("a queued open_table gives a session stub with the table name and covers, and the queued lines", () => {
    const ops = [queued(openDraft(1), 1), queued(addDraft(2), 2)];
    const result = overlayOrder(null, ops, S1)!;
    expect(result.session).toEqual({
      id: S1,
      tableId: SYNC_IDS.table1,
      tableName: "Tavolo 1 (demo)",
      covers: 2,
      status: "open",
      billRequested: false,
      closed: false,
    });
    expect(result.lines.map((l) => l.id)).toEqual([lineId(2)]);
  });

  it("no view and no open_table: nothing to show", () => {
    expect(overlayOrder(null, [queued(addDraft(2), 2)], S1)).toBeNull();
    expect(overlayOrder(null, [], S1)).toBeNull();
  });

  it("the open_table of another session does not make a stub", () => {
    expect(overlayOrder(null, [queued(openDraft(1, "s2"), 1)], S1)).toBeNull();
  });
});

describe("overlayOrder keeps ids straight", () => {
  it("OIDS.session is the session the fixtures use", () => {
    expect(OIDS.session).toBe(S1);
  });
});
