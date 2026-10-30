import { describe, expect, it } from "vitest";
import { sendable } from "@/lib/sync/sendable";
import { addDraft, DEMO, DUE, editDraft, queued, SYNC_IDS } from "../../helpers/sync-data";

// Two waiters on one phone and two sessions (lesson 1): the binding and the per-session blocking need a second of each.
const ops = [
  queued(addDraft(1, "s1", DEMO), 1), // Demo, S1
  queued(addDraft(2, "s1", DUE), 2), // Due, S1
  queued(addDraft(3, "s2", DUE), 3), // Due, S2
  queued(editDraft(4, 2, "s1", DUE), 4), // Due, S1
];

describe("sendable", () => {
  it("me = Due: only Due's ops on the session without a held op are sendable; the S1 ops wait; Demo's op is held", () => {
    const chosen = sendable(ops, SYNC_IDS.waiterDue);
    expect(chosen.sendable.map((op) => op.seq)).toEqual([3]);
    expect(chosen.waiting.map((op) => op.seq)).toEqual([2, 4]);
    expect(chosen.held).toEqual([{ user: DEMO, count: 1 }]);
  });

  it("me = Demo: Demo's op goes; Due's ops are held and Due's S2 op does not hold up Demo", () => {
    const chosen = sendable(ops, SYNC_IDS.waiterDemo);
    expect(chosen.sendable.map((op) => op.seq)).toEqual([1]);
    expect(chosen.held).toEqual([{ user: DUE, count: 3 }]);
    expect(chosen.waiting).toEqual([]);
  });

  it("once Demo's op is gone, Due's S1 ops follow in seq order", () => {
    const chosen = sendable(ops.slice(1), SYNC_IDS.waiterDue);
    expect(chosen.sendable.map((op) => op.seq)).toEqual([2, 3, 4]);
    expect(chosen.held).toEqual([]);
  });

  it("a held op blocks only LATER ops of its own session", () => {
    const early = queued(addDraft(1, "s1", DUE), 1);
    const held = queued(addDraft(2, "s1", DEMO), 2);
    const later = queued(addDraft(3, "s1", DUE), 3);
    const chosen = sendable([early, held, later], SYNC_IDS.waiterDue);
    expect(chosen.sendable.map((op) => op.seq)).toEqual([1]);
    expect(chosen.waiting.map((op) => op.seq)).toEqual([3]);
  });

  it("extra held users (the server refused them) are held like another person's ops", () => {
    const chosen = sendable(ops, SYNC_IDS.waiterDue, new Set([SYNC_IDS.waiterDue]));
    expect(chosen.sendable).toEqual([]);
    expect(chosen.held.map((h) => [h.user.id, h.count])).toEqual([
      [SYNC_IDS.waiterDemo, 1],
      [SYNC_IDS.waiterDue, 3],
    ]);
  });

  it("nobody signed in: nothing is sent and nothing is called held", () => {
    const chosen = sendable(ops, null);
    expect(chosen.sendable).toEqual([]);
    expect(chosen.held).toEqual([]);
    expect(chosen.waiting).toHaveLength(4);
  });

  it("an empty outbox is empty", () => {
    expect(sendable([], SYNC_IDS.waiterDue)).toEqual({ sendable: [], waiting: [], held: [] });
  });

  it("counts held ops per person, one entry each, in the order the people first appear", () => {
    const mixed = [
      queued(addDraft(1, "s1", DUE), 1),
      queued(addDraft(2, "s1", DEMO), 2),
      queued(addDraft(3, "s2", DUE), 3),
      queued(addDraft(4, "s2", DEMO), 4),
    ];
    const none = sendable(mixed, "someone-else");
    expect(none.held.map((h) => [h.user.id, h.count])).toEqual([
      [SYNC_IDS.waiterDue, 2],
      [SYNC_IDS.waiterDemo, 2],
    ]);
  });
});
