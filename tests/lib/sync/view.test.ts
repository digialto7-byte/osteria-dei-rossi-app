import { describe, expect, it } from "vitest";
import { deriveView, EMPTY_VIEW } from "@/lib/sync/view";
import type { ReplayState } from "@/lib/sync/replay";
import type { OutcomeRecord } from "@/lib/sync/types";
import { addDraft, DEMO, DUE, fireDraft, opId, queued, SYNC_IDS } from "../../helpers/sync-data";

const IDLE: ReplayState = {
  state: "idle",
  failures: 0,
  nextAttemptAt: null,
  stuck: false,
  skewMs: null,
  held: [],
  mismatched: [],
};
const outcome = (n: number, extra: Partial<OutcomeRecord> = {}): OutcomeRecord => ({
  opId: opId(n),
  seq: n,
  kind: "add_line",
  userId: DEMO.id,
  scope: { sessionId: SYNC_IDS.s1 },
  label: {},
  clientTs: "2026-11-02T19:30:00.000Z",
  status: "conflict",
  settledAt: 1,
  seen: false,
  ...extra,
});

describe("deriveView", () => {
  it("counts every waiting op and the signed-in user's own, and passes the engine's state through", () => {
    const ops = [
      queued(addDraft(1, "s1", DEMO), 1),
      queued(addDraft(2, "s2", DUE), 2),
      queued(fireDraft(3, [1], "s1", DEMO), 3),
    ];
    const view = deriveView({
      ops,
      outcomes: [],
      replay: {
        ...IDLE,
        state: "offline",
        failures: 2,
        nextAttemptAt: 9_000,
        held: [{ user: DUE, count: 1 }],
      },
      memoryOnly: false,
      me: DEMO.id,
    });
    expect(view).toMatchObject({
      ready: true,
      pending: 3,
      mine: 2,
      state: "offline",
      nextAttemptAt: 9_000,
      memoryOnly: false,
      stuck: false,
      held: [{ user: DUE, count: 1 }],
    });
    expect(view.ops).toBe(ops);
  });

  describe("held ops are read from the outbox, not only from the engine (review: AT8 on WebKit)", () => {
    // The engine fills its `held` only while it runs. A run does not happen while another page still holds the lease (a page closed in
    // the middle of a run leaves it for up to 12 s) or while it backs off, and the banner must not wait for that.
    const ops = [queued(addDraft(1, "s1", DEMO), 1), queued(addDraft(2, "s1", DEMO), 2)];

    it("names the person whose ops wait when someone else is signed in, with the engine's held empty", () => {
      const view = deriveView({ ops, outcomes: [], replay: IDLE, memoryOnly: false, me: DUE.id });
      expect(view.held).toEqual([{ user: DEMO, count: 2 }]);
      expect(view.visible).toBe(true);
    });

    it("holds nothing of my own ops, and nothing at all when nobody is signed in", () => {
      expect(
        deriveView({ ops, outcomes: [], replay: IDLE, memoryOnly: false, me: DEMO.id }).held,
      ).toEqual([]);
      expect(
        deriveView({ ops, outcomes: [], replay: IDLE, memoryOnly: false, me: null }).held,
      ).toEqual([]);
    });

    it("adds the people the server refused (user_mismatch) from the outbox, without counting a person twice", () => {
      const both = deriveView({
        ops,
        outcomes: [],
        replay: { ...IDLE, mismatched: [DEMO.id] },
        memoryOnly: false,
        me: DEMO.id,
      });
      expect(both.held).toEqual([{ user: DEMO, count: 2 }]); // my own ops, held because the server said user_mismatch
      const twice = deriveView({
        ops,
        outcomes: [],
        replay: { ...IDLE, mismatched: [DEMO.id] },
        memoryOnly: false,
        me: DUE.id,
      });
      expect(twice.held).toEqual([{ user: DEMO, count: 2 }]);
    });

    it("ignores the engine's own held list: after a user change while the engine is busy, only the outbox for the new me counts", () => {
      // The engine computed this for Demo, on its last run; another tab holds the lease, so it has not run since Due signed in.
      const stale: ReplayState = { ...IDLE, held: [{ user: DUE, count: 4 }] };
      const view = deriveView({ ops, outcomes: [], replay: stale, memoryOnly: false, me: DUE.id });
      expect(view.held).toEqual([{ user: DEMO, count: 2 }]);
      const gone = deriveView({
        ops: [],
        outcomes: [],
        replay: stale,
        memoryOnly: false,
        me: DUE.id,
      });
      expect(gone.held).toEqual([]);
      expect(gone.visible).toBe(false);
    });
  });

  it("unseen notices: conflicts, refusals and dropped ops count; applied and seen ones do not", () => {
    const view = deriveView({
      ops: [],
      outcomes: [
        outcome(1),
        outcome(2, { status: "rejected" }),
        outcome(3, { status: "dropped" }),
        outcome(4, { status: "applied" }),
        outcome(5, { seen: true }),
      ],
      replay: IDLE,
      memoryOnly: true,
      me: null,
    });
    expect(view.unseen).toBe(3);
    expect(view.memoryOnly).toBe(true);
  });

  it("is hidden (visible false) when nothing is pending or held and no notice is unseen", () => {
    expect(
      deriveView({ ops: [], outcomes: [], replay: IDLE, memoryOnly: false, me: DEMO.id }).visible,
    ).toBe(false);
    expect(
      deriveView({
        ops: [queued(addDraft(1), 1)],
        outcomes: [],
        replay: IDLE,
        memoryOnly: false,
        me: DEMO.id,
      }).visible,
    ).toBe(true);
    expect(
      deriveView({ ops: [], outcomes: [outcome(1)], replay: IDLE, memoryOnly: false, me: DEMO.id })
        .visible,
    ).toBe(true);
    // An entry only the engine remembers (its last run was for someone else, or the op is gone) does not keep the badge up.
    expect(
      deriveView({
        ops: [],
        outcomes: [],
        replay: { ...IDLE, held: [{ user: DUE, count: 1 }] },
        memoryOnly: false,
        me: DEMO.id,
      }).visible,
    ).toBe(false);
  });

  it("the empty view says it is not ready and shows nothing", () => {
    expect(EMPTY_VIEW).toMatchObject({
      ready: false,
      pending: 0,
      visible: false,
      ops: [],
      outcomes: [],
    });
  });
});
