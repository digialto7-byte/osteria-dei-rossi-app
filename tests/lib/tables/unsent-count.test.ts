import { describe, expect, it } from "vitest";
import { unsentCountOf } from "@/lib/tables/unsent-count";

// BQ-1 (Q-B3): the count on a tile is advisory. A reply from before the deploy has no unsentCount; the client must treat that as
// "unknown" (null) and show nothing, never as 0 ("nothing to send").
describe("unsentCountOf", () => {
  it("returns the integer of a session that has one", () => {
    expect(unsentCountOf({ id: "s", unsentCount: 3 })).toBe(3);
  });

  it("returns 0 only when the server said 0", () => {
    expect(unsentCountOf({ unsentCount: 0 })).toBe(0);
  });

  it("a session without the field is unknown (null), not 0", () => {
    expect(unsentCountOf({ id: "s", covers: 2 })).toBeNull();
    expect(unsentCountOf({})).toBeNull();
  });

  it.each([
    ["negative", -1],
    ["a fraction", 1.5],
    ["a string", "2"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["null", null],
    ["a boolean", true],
    ["an object", { n: 1 }],
  ])("%s is unknown (null)", (_name, value) => {
    expect(unsentCountOf({ unsentCount: value })).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 3],
    ["a string", "x"],
    ["an array", [1]],
  ])("a session that is %s is unknown (null)", (_name, session) => {
    expect(unsentCountOf(session)).toBeNull();
  });
});
