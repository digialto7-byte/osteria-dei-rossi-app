import { describe, expect, it } from "vitest";
import { planPrune } from "@/lib/sync/prune";
import {
  addDraft,
  DEMO,
  DUE,
  editDraft,
  fireDraft,
  lineId,
  opId,
  queued,
  SYNC_IDS,
} from "../../helpers/sync-data";

// Two lines in one fire, one of them dead (lesson 1), and two sessions so a drop never reaches the other one.
const newId = (() => {
  let n = 100;
  return () => opId(n++);
})();
const NOW = 5_000;

describe("planPrune: a dead line (an add_line that was not applied)", () => {
  const pending = [
    queued(editDraft(2, 1), 2), // edit L1
    queued(fireDraft(3, [1, 7]), 3), // fire [L1, L7]
    queued(editDraft(4, 7), 4), // edit L7 (alive)
    queued(fireDraft(5, [1]), 5), // fire [L1]
    queued({ ...editDraft(6, 1), kind: "remove_line", payload: { lineId: lineId(1) } }, 6),
    queued(
      { ...editDraft(7, 1), kind: "void_line", payload: { lineId: lineId(1), reason: "comp" } },
      7,
    ),
  ];
  const plan = planPrune(pending, { lineId: lineId(1) }, newId, NOW);

  it("drops the edit, remove and void of the dead line, with the reason", () => {
    const dropped = plan.drops.map((d) => [d.opId, d.reason]);
    expect(dropped).toContainEqual([opId(2), "line_not_created"]);
    expect(dropped).toContainEqual([opId(6), "line_not_created"]);
    expect(dropped).toContainEqual([opId(7), "line_not_created"]);
    expect(plan.drops.every((d) => d.settledAt === NOW)).toBe(true);
  });

  it("a fire [L1, L7] loses L1: rewritten with a new op id and the same seq", () => {
    expect(plan.rewrites).toHaveLength(1);
    const rewrite = plan.rewrites[0]!;
    expect(rewrite.replaces).toBe(opId(3));
    expect(rewrite.op.opId).not.toBe(opId(3));
    expect(rewrite.op.seq).toBe(3);
    expect(rewrite.op.payload).toEqual({ sessionId: SYNC_IDS.s1, lineIds: [lineId(7)] });
    expect(rewrite.op.attempts).toBe(0);
  });

  it("a fire [L1] with nothing left is dropped", () => {
    expect(plan.drops.map((d) => d.opId)).toContain(opId(5));
  });

  it("leaves the edit of the live line alone", () => {
    expect(plan.drops.map((d) => d.opId)).not.toContain(opId(4));
    expect(plan.rewrites.map((r) => r.replaces)).not.toContain(opId(4));
  });
});

describe("planPrune: a dead session (an open_table that was not applied)", () => {
  const pending = [
    queued(addDraft(2, "s1", DEMO), 2),
    queued(fireDraft(3, [2], "s1", DEMO), 3),
    queued(addDraft(4, "s2", DUE), 4), // another session: untouched
    queued(addDraft(5, "s1", DUE), 5), // another person's op on the dead session: dropped too
  ];
  const plan = planPrune(pending, { sessionId: SYNC_IDS.s1 }, newId, NOW);

  it("drops every op on that session, of any user, as session_not_created", () => {
    expect(plan.drops.map((d) => [d.opId, d.reason])).toEqual([
      [opId(2), "session_not_created"],
      [opId(3), "session_not_created"],
      [opId(5), "session_not_created"],
    ]);
  });

  it("rewrites nothing and leaves the other session alone", () => {
    expect(plan.rewrites).toEqual([]);
    expect(plan.drops.map((d) => d.opId)).not.toContain(opId(4));
  });
});

describe("planPrune: nothing to do", () => {
  it("an empty plan when no op names the dead entity", () => {
    const plan = planPrune([queued(addDraft(2, "s2"), 2)], { lineId: lineId(9) }, newId, NOW);
    expect(plan).toEqual({ rewrites: [], drops: [] });
  });

  it("an add of another line is never dropped for a dead line", () => {
    const plan = planPrune([queued(addDraft(2, "s1"), 2)], { lineId: lineId(1) }, newId, NOW);
    expect(plan.drops).toEqual([]);
  });
});
