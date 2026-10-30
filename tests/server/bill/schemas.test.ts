import { describe, expect, it } from "vitest";
import { billQuery, closeBody, splitBody } from "@/server/bill/schemas";
import { BIDS, CLOSE_BODY, TOKEN } from "../../helpers/bill-data";

const close = (over: Record<string, unknown>) => closeBody.safeParse({ ...CLOSE_BODY, ...over });
const uuid = (n: number) => `15000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("closeBody", () => {
  it("accepts a receipt, a number, a payment and the token", () => {
    expect(closeBody.parse(CLOSE_BODY)).toEqual(CLOSE_BODY);
  });

  it("accepts both receipt types and all three payments", () => {
    for (const receiptType of ["scontrino", "fattura"])
      expect(close({ receiptType }).success).toBe(true);
    for (const paymentType of ["cash", "card", "other"])
      expect(close({ paymentType }).success).toBe(true);
  });

  it("trims the number", () => {
    expect(close({ receiptNumber: "  0012-0034 " }).data?.receiptNumber).toBe("0012-0034");
  });

  it.each([[""], ["   "], [null]])(
    "the number %j becomes null (closed and flagged, not refused)",
    (value) => {
      const parsed = close({ receiptNumber: value });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.receiptNumber).toBeNull();
    },
  );

  it.each([["12 34"], ["-1"], ["x".repeat(21)], ["a|b"], ["é1"]])(
    "rejects the number %j",
    (value) => {
      expect(close({ receiptNumber: value }).success).toBe(false);
    },
  );

  it("accepts a number of exactly 20 characters", () => {
    expect(close({ receiptNumber: "1".repeat(20) }).success).toBe(true);
  });

  it("rejects a number that is not a string", () => {
    expect(close({ receiptNumber: 12 }).success).toBe(false);
  });

  it("rejects an unknown type or payment", () => {
    expect(close({ receiptType: "pos" }).success).toBe(false);
    expect(close({ paymentType: "cheque" }).success).toBe(false);
  });

  it.each([["ABCDEF0123456789ABCDEF0123456789"], ["abc"], [TOKEN + "0"], [""]])(
    "rejects the token %j",
    (billToken) => {
      expect(close({ billToken }).success).toBe(false);
    },
  );

  it("rejects a stray key and a missing key", () => {
    expect(close({ extra: 1 }).success).toBe(false);
    const { paymentType: _p, ...without } = CLOSE_BODY;
    expect(closeBody.safeParse(without).success).toBe(false);
  });
});

describe("billQuery", () => {
  it("has no parts by default", () => {
    expect(billQuery.parse({})).toEqual({});
  });

  it("coerces parts from the query string", () => {
    expect(billQuery.parse({ parts: "3" })).toEqual({ parts: 3 });
  });

  it.each([["1"], ["100"], ["2.5"], ["x"]])("rejects parts=%s", (parts) => {
    expect(billQuery.safeParse({ parts }).success).toBe(false);
  });

  it("accepts the bounds 2 and 99", () => {
    expect(billQuery.safeParse({ parts: "2" }).success).toBe(true);
    expect(billQuery.safeParse({ parts: "99" }).success).toBe(true);
  });

  it("rejects an unknown key", () => {
    expect(billQuery.safeParse({ parts: "3", x: "1" }).success).toBe(false);
  });
});

describe("splitBody", () => {
  const group = (ids: string[], covers = 1) => ({ lineIds: ids, covers });
  const ok = {
    groups: [group([BIDS.line1]), group([BIDS.line3]), group([BIDS.line2])],
    sharedLineIds: [BIDS.line4],
  };

  it("accepts groups and shared lines", () => {
    expect(splitBody.parse(ok)).toEqual(ok);
  });

  it("needs 2 to 20 groups", () => {
    expect(splitBody.safeParse({ groups: [group([])], sharedLineIds: [] }).success).toBe(false);
    expect(
      splitBody.safeParse({ groups: Array.from({ length: 2 }, () => group([])), sharedLineIds: [] })
        .success,
    ).toBe(true);
    expect(
      splitBody.safeParse({
        groups: Array.from({ length: 20 }, () => group([])),
        sharedLineIds: [],
      }).success,
    ).toBe(true);
    expect(
      splitBody.safeParse({
        groups: Array.from({ length: 21 }, () => group([])),
        sharedLineIds: [],
      }).success,
    ).toBe(false);
  });

  it("rejects an id that appears twice, in one group, across groups or in the shared list", () => {
    expect(
      splitBody.safeParse({
        groups: [group([BIDS.line1, BIDS.line1]), group([])],
        sharedLineIds: [],
      }).success,
    ).toBe(false);
    expect(
      splitBody.safeParse({ groups: [group([BIDS.line1]), group([BIDS.line1])], sharedLineIds: [] })
        .success,
    ).toBe(false);
    expect(
      splitBody.safeParse({ groups: [group([BIDS.line1]), group([])], sharedLineIds: [BIDS.line1] })
        .success,
    ).toBe(false);
  });

  it("rejects more than 200 ids in all", () => {
    const ids = Array.from({ length: 201 }, (_, i) => uuid(i + 1));
    expect(
      splitBody.safeParse({
        groups: [group(ids.slice(0, 100)), group(ids.slice(100, 200))],
        sharedLineIds: [ids[200]!],
      }).success,
    ).toBe(false);
    expect(
      splitBody.safeParse({
        groups: [group(ids.slice(0, 100)), group(ids.slice(100, 200))],
        sharedLineIds: [],
      }).success,
    ).toBe(true);
  });

  it("covers go from 0 to 99 as whole numbers", () => {
    expect(
      splitBody.safeParse({ groups: [group([], -1), group([])], sharedLineIds: [] }).success,
    ).toBe(false);
    expect(
      splitBody.safeParse({ groups: [group([], 100), group([])], sharedLineIds: [] }).success,
    ).toBe(false);
    expect(
      splitBody.safeParse({ groups: [group([], 1.5), group([])], sharedLineIds: [] }).success,
    ).toBe(false);
    expect(
      splitBody.safeParse({ groups: [group([], 0), group([], 99)], sharedLineIds: [] }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid and a stray key", () => {
    expect(
      splitBody.safeParse({ groups: [group(["x"]), group([])], sharedLineIds: [] }).success,
    ).toBe(false);
    expect(splitBody.safeParse({ ...ok, mode: "items" }).success).toBe(false);
  });
});
