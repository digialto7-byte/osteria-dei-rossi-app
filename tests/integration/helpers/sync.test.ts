import { describe, expect, it } from "vitest";
import { syncBody } from "@/server/sync/schemas";
import { opFor } from "./sync";

const USER = "a1000000-0000-4000-8000-00000000000a";
const LINE = "10000000-0000-4000-8000-000000000001";

describe("opFor", () => {
  it("builds ops the strict envelope accepts, with increasing seq and fresh op ids", () => {
    const one = opFor("remove_line", { lineId: LINE }, USER);
    const two = opFor("remove_line", { lineId: LINE }, USER);
    expect(two.seq).toBeGreaterThan(one.seq);
    expect(two.opId).not.toBe(one.opId);
    expect(syncBody.safeParse({ ops: [one, two] }).success).toBe(true);
  });

  it("puts the stamp where asked, and keeps an explicit op id and seq", () => {
    const now = Date.now();
    const past = opFor("remove_line", { lineId: LINE }, USER, { msFromNow: -60_000 });
    expect(Math.abs(Date.parse(past.clientTs) - (now - 60_000))).toBeLessThan(2_000);
    const fixed = opFor("remove_line", { lineId: LINE }, USER, { opId: LINE, seq: 99 });
    expect([fixed.opId, fixed.seq]).toEqual([LINE, 99]);
  });
});
