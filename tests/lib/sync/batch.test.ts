import { describe, expect, it } from "vitest";
import { takeBatch, toWire } from "@/lib/sync/batch";
import { addDraft, fireDraft, queued } from "../../helpers/sync-data";

const many = (count: number) =>
  Array.from({ length: count }, (_v, i) => queued(addDraft(i + 1), i + 1));

describe("toWire", () => {
  it("sends the six envelope keys and nothing local (no label, no queuedBy, no attempts)", () => {
    const wire = toWire(queued(addDraft(1), 1));
    expect(Object.keys(wire).sort()).toEqual([
      "clientTs",
      "kind",
      "opId",
      "payload",
      "seq",
      "userId",
    ]);
  });
});

describe("takeBatch", () => {
  it("cuts at 20 ops, in seq order", () => {
    expect(takeBatch(many(45)).map((op) => op.seq)).toEqual(
      Array.from({ length: 20 }, (_v, i) => i + 1),
    );
  });

  it("takes fewer when there are fewer, and none when there are none", () => {
    expect(takeBatch(many(3))).toHaveLength(3);
    expect(takeBatch([])).toEqual([]);
  });

  it("cuts before the body would pass 64 KiB", () => {
    const big = (n: number) => {
      const op = queued(fireDraft(n, [1]), n);
      return { ...op, payload: { ...op.payload, padding: "x".repeat(20_000) } };
    };
    const batch = takeBatch([big(1), big(2), big(3), big(4)]);
    expect(batch.map((op) => op.seq)).toEqual([1, 2, 3]);
    const bytes = new TextEncoder().encode(JSON.stringify({ ops: batch.map(toWire) })).length;
    expect(bytes).toBeLessThanOrEqual(65_536);
  });

  it("always takes the first op, even if it alone is too big (the server answers 413 and the op is flagged, not dropped)", () => {
    const op = queued(fireDraft(1, [1]), 1);
    const huge = { ...op, payload: { ...op.payload, padding: "x".repeat(70_000) } };
    expect(takeBatch([huge, queued(addDraft(2), 2)]).map((o) => o.seq)).toEqual([1]);
  });

  it("counts bytes, not characters (accents and the euro-like symbols count more)", () => {
    const op = queued(addDraft(1), 1);
    const accented = (n: number) => ({
      ...queued(addDraft(n), n),
      payload: { ...op.payload, note: "è".repeat(14_000) },
    });
    // 14 000 two-byte characters are about 28 kB each: two fit, three do not.
    expect(takeBatch([accented(1), accented(2), accented(3)]).map((o) => o.seq)).toEqual([1, 2]);
  });
});
