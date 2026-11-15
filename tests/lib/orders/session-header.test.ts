import { describe, expect, it } from "vitest";
import { sessionHeaderOf, UNKNOWN } from "@/lib/orders/session-header";

// DS-BQ-2 follow-up: the comanda's header fields came with DS-BQ-2. A reply cached by the service worker before that deploy lacks them, so
// each one is read strictly: missing or invalid is unknown (null, or "unknown" for the coperto), never a made-up value.
const COPERTO = { perPerson: 2.5, vatRate: 10, total: 10 };
const FULL = {
  id: "s1",
  covers: 4,
  openedAt: "2026-11-02T19:14:00.123456+00:00",
  openedToday: true,
  openedBy: { displayName: "Giulia" },
  coperto: COPERTO,
};
const ALL_UNKNOWN = {
  openedBy: null,
  openedAt: null,
  openedToday: null,
  coperto: UNKNOWN,
  queuedAt: null,
  queued: false,
};

describe("sessionHeaderOf", () => {
  it("a full server reply: every field as sent", () => {
    expect(sessionHeaderOf(FULL)).toEqual({
      openedBy: "Giulia",
      openedAt: "2026-11-02T19:14:00.123456+00:00",
      openedToday: true,
      coperto: COPERTO,
      queuedAt: null,
      queued: false,
    });
  });

  it("a reply with source 'server' reads the same", () => {
    expect(sessionHeaderOf({ ...FULL, source: "server" })).toEqual(sessionHeaderOf(FULL));
  });

  it("a reply cached before the deploy (the four keys missing): all unknown", () => {
    expect(sessionHeaderOf({ id: "s1", covers: 4, status: "open" })).toEqual(ALL_UNKNOWN);
  });

  it("openedToday false is a value, not unknown", () => {
    expect(sessionHeaderOf({ ...FULL, openedToday: false }).openedToday).toBe(false);
  });

  describe("each key invalid on its own: that key is unknown, the others stay", () => {
    const intact = sessionHeaderOf(FULL);
    it.each([
      ["openedBy is not an object", { openedBy: "Giulia" }, { openedBy: null }],
      ["openedBy is null", { openedBy: null }, { openedBy: null }],
      ["openedBy has no displayName", { openedBy: {} }, { openedBy: null }],
      ["openedBy.displayName is empty", { openedBy: { displayName: "" } }, { openedBy: null }],
      ["openedBy.displayName is a number", { openedBy: { displayName: 7 } }, { openedBy: null }],
      ["openedAt is not a string", { openedAt: 1762110840000 }, { openedAt: null }],
      ["openedAt is not a date", { openedAt: "yesterday" }, { openedAt: null }],
      ["openedAt is a date with no time", { openedAt: "2026-11-02" }, { openedAt: null }],
      [
        "openedAt is a date that does not exist",
        { openedAt: "2026-13-45T10:00:00Z" },
        { openedAt: null },
      ],
      ["openedToday is a string", { openedToday: "true" }, { openedToday: null }],
      ["openedToday is a number", { openedToday: 1 }, { openedToday: null }],
    ])("%s", (_name, bad, unknown) => {
      expect(sessionHeaderOf({ ...FULL, ...bad })).toEqual({ ...intact, ...unknown });
    });
  });

  describe("the coperto keeps 'none' and 'unknown' apart", () => {
    it("null from the server is none (null)", () => {
      expect(sessionHeaderOf({ ...FULL, coperto: null }).coperto).toBeNull();
    });
    it("a missing key is unknown", () => {
      const { coperto: _omitted, ...without } = FULL;
      expect(sessionHeaderOf(without).coperto).toBe(UNKNOWN);
    });
    it("a malformed coperto (a key missing) is unknown", () => {
      expect(sessionHeaderOf({ ...FULL, coperto: { perPerson: 2.5, total: 10 } }).coperto).toBe(
        UNKNOWN,
      );
    });
    it("a coperto with an extra key is unknown (the schema is strict)", () => {
      expect(sessionHeaderOf({ ...FULL, coperto: { ...COPERTO, cost: 1 } }).coperto).toBe(UNKNOWN);
    });
    it("a coperto of the wrong type is unknown", () => {
      expect(sessionHeaderOf({ ...FULL, coperto: "10,00" }).coperto).toBe(UNKNOWN);
    });
    it("undefined is unknown, not none", () => {
      expect(sessionHeaderOf({ ...FULL, coperto: undefined }).coperto).toBe(UNKNOWN);
    });
  });

  describe("the queued variant (a table opened offline)", () => {
    const QUEUED = {
      source: "queued",
      id: "s1",
      covers: 4,
      openedBy: { displayName: "Giulia" },
      queuedAt: "2026-11-02T19:14:00.000Z",
    };
    it("the opener and the tap time are known; openedAt, openedToday and coperto are unknown", () => {
      expect(sessionHeaderOf(QUEUED)).toEqual({
        openedBy: "Giulia",
        openedAt: null,
        openedToday: null,
        coperto: UNKNOWN,
        queuedAt: "2026-11-02T19:14:00.000Z",
        queued: true,
      });
    });
    it("an invalid queuedAt is an unknown time, and the session stays queued (no silent server branch, Rule B)", () => {
      const header = sessionHeaderOf({ ...QUEUED, queuedAt: "soon" });
      expect(header.queuedAt).toBeNull();
      expect(header.queued).toBe(true);
      expect(header.coperto).toBe(UNKNOWN);
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "session"],
    ["a number", 3],
    ["an array", [FULL]],
  ])("non-object input (%s): all unknown", (_name, input) => {
    expect(sessionHeaderOf(input)).toEqual(ALL_UNKNOWN);
  });
});
