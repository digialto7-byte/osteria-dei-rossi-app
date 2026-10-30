import { describe, expect, it } from "vitest";
import { badgeParts } from "@/lib/sync/badge";
import { EMPTY_VIEW, type SyncView } from "@/lib/sync/view";

const view = (extra: Partial<SyncView>): SyncView => ({
  ...EMPTY_VIEW,
  ready: true,
  visible: true,
  ...extra,
});

describe("badgeParts", () => {
  it("is null when the badge is hidden", () => {
    expect(badgeParts(EMPTY_VIEW, 0)).toBeNull();
    expect(badgeParts(view({ visible: false }), 0)).toBeNull();
  });

  it("'In coda · 3' with the accessible name '3 operazioni in attesa di invio'", () => {
    expect(badgeParts(view({ pending: 3 }), 0)).toEqual({
      label: "In coda · 3",
      aria: "3 operazioni in attesa di invio",
      stateWord: null,
    });
  });

  it("one operation reads in the singular", () => {
    expect(badgeParts(view({ pending: 1 }), 0)!.aria).toBe("1 operazione in attesa di invio");
  });

  it("only unseen notices: 'Avvisi · 2'", () => {
    expect(badgeParts(view({ pending: 0, unseen: 2 }), 0)).toEqual({
      label: "Avvisi · 2",
      aria: "2 avvisi da leggere",
      stateWord: null,
    });
  });

  it("held ops only (nothing of mine pending): still shown, as the count on the phone", () => {
    expect(
      badgeParts(
        view({
          pending: 2,
          mine: 0,
          held: [{ user: { id: "x", displayName: "Cameriere Demo" }, count: 2 }],
        }),
        0,
      )!.label,
    ).toBe("In coda · 2");
  });

  it("the state word: Invio…, Offline, and the seconds to the next try (rounded up, at least 1)", () => {
    expect(badgeParts(view({ pending: 1, state: "sending" }), 0)!.stateWord).toBe("Invio…");
    expect(badgeParts(view({ pending: 1, state: "offline" }), 0)!.stateWord).toBe("Offline");
    expect(
      badgeParts(view({ pending: 1, state: "backoff", nextAttemptAt: 15_000 }), 0)!.stateWord,
    ).toBe("Nuovo tentativo tra 15 s");
    expect(
      badgeParts(view({ pending: 1, state: "backoff", nextAttemptAt: 14_001 }), 0)!.stateWord,
    ).toBe("Nuovo tentativo tra 15 s");
    expect(
      badgeParts(view({ pending: 1, state: "backoff", nextAttemptAt: 100 }), 0)!.stateWord,
    ).toBe("Nuovo tentativo tra 1 s");
    expect(
      badgeParts(view({ pending: 1, state: "backoff", nextAttemptAt: 0 }), 5_000)!.stateWord,
    ).toBe("Nuovo tentativo tra 1 s");
  });

  it("idle, signed out and forbidden say no word; backoff with no time says none either", () => {
    for (const state of ["idle", "signedOut", "forbidden"] as const) {
      expect(badgeParts(view({ pending: 1, state }), 0)!.stateWord).toBeNull();
    }
    expect(
      badgeParts(view({ pending: 1, state: "backoff", nextAttemptAt: null }), 0)!.stateWord,
    ).toBeNull();
  });

  it("English", () => {
    expect(badgeParts(view({ pending: 3, state: "offline" }), 0, "en")).toEqual({
      label: "Queued · 3",
      aria: "3 operations waiting to be sent",
      stateWord: "Offline",
    });
  });
});
