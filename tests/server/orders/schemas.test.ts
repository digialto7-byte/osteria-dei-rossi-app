import { describe, expect, it } from "vitest";
import { addLineBody, idParams, removeLineBody, updateLineBody } from "@/server/orders/schemas";

const L1 = "10000000-0000-4000-8000-000000000001";
const I1 = "3e000000-0000-4000-8000-000000000001";
const AT = "2026-11-02T19:30:00.123Z";
const add = (extra: object = {}) => ({ lineId: L1, menuItemId: I1, clientUpdatedAt: AT, ...extra });

describe("addLineBody", () => {
  it("takes the three required keys alone", () => {
    expect(addLineBody.safeParse(add()).success).toBe(true);
  });

  it("takes every optional key", () => {
    const body = add({
      qty: 1.5,
      course: "dolci",
      segue: true,
      note: "senza cipolla",
      isShared: true,
    });
    expect(addLineBody.parse(body)).toEqual(body);
  });

  it.each([0.5, 1, 1.5, 98.5, 99])("accepts qty %s (half steps, 0.5 to 99)", (qty) => {
    expect(addLineBody.safeParse(add({ qty })).success).toBe(true);
  });

  it.each([0, 0.3, 0.4, 0.7, 99.5, 100, -1, Number.NaN, "1"])("refuses qty %s", (qty) => {
    expect(addLineBody.safeParse(add({ qty })).success).toBe(false);
  });

  it.each([
    ["no lineId", { lineId: undefined }],
    ["a malformed lineId", { lineId: "x" }],
    ["no menuItemId", { menuItemId: undefined }],
    ["a malformed menuItemId", { menuItemId: "x" }],
    ["no clientUpdatedAt", { clientUpdatedAt: undefined }],
    ["a course outside the five", { course: "contorni" }],
    ["segue as text", { segue: "yes" }],
    ["isShared as a number", { isShared: 1 }],
    ["an unknown key", { unit_price: 1 }],
    ["a price", { unitPrice: 1 }],
    ["a note of 141 characters", { note: "x".repeat(141) }],
    ["a note with a control character", { note: "a\u0007b" }],
    ["a note with a newline", { note: "a\nb" }],
  ])("refuses %s", (_name, extra) => {
    expect(addLineBody.safeParse(add(extra)).success).toBe(false);
  });

  it("accepts a note of exactly 140 characters, a blank note and a null note", () => {
    for (const note of ["x".repeat(140), "", "   ", null]) {
      expect(addLineBody.safeParse(add({ note })).success, String(note)).toBe(true);
    }
  });

  it.each([
    "2026-11-02T19:30:00Z",
    "2026-11-02T19:30Z",
    "2026-11-02T20:30:00+01:00",
    "2026-11-02T19:30:00.1234Z",
    "2026-11-02T19:30:00.123456-05:30",
  ])("accepts the instant %s", (clientUpdatedAt) => {
    expect(addLineBody.safeParse(add({ clientUpdatedAt })).success).toBe(true);
  });

  it.each([
    "2026-11-02",
    "2026-11-02T19:30:00",
    "2026-11-02 19:30:00Z",
    "2026-11-02T19:30:00.1234567Z",
    "x",
    "",
  ])("refuses the instant %j (an offset is required)", (clientUpdatedAt) => {
    expect(addLineBody.safeParse(add({ clientUpdatedAt })).success).toBe(false);
  });
});

describe("updateLineBody", () => {
  it.each([
    { qty: 2 },
    { course: "secondi" },
    { segue: false },
    { note: null },
    { note: "ben cotto" },
    { isShared: true },
    { qty: 1, course: "primi", segue: true, note: "x", isShared: false },
  ])("accepts %j with clientUpdatedAt", (patch) => {
    expect(updateLineBody.safeParse({ clientUpdatedAt: AT, ...patch }).success).toBe(true);
  });

  it("needs at least one field besides clientUpdatedAt", () => {
    expect(updateLineBody.safeParse({ clientUpdatedAt: AT }).success).toBe(false);
    expect(updateLineBody.safeParse({}).success).toBe(false);
  });

  it("needs clientUpdatedAt", () => {
    expect(updateLineBody.safeParse({ qty: 2 }).success).toBe(false);
  });

  it.each([
    ["qty 0.3", { qty: 0.3 }],
    ["qty 0", { qty: 0 }],
    ["qty 99.5", { qty: 99.5 }],
    ["an unknown course", { course: "x" }],
    ["menuItemId (changing the dish is remove + add)", { menuItemId: I1 }],
    ["lineId", { lineId: L1 }],
    ["unitPrice", { unitPrice: 1 }],
  ])("refuses %s", (_name, patch) => {
    expect(updateLineBody.safeParse({ clientUpdatedAt: AT, ...patch }).success).toBe(false);
  });
});

describe("removeLineBody", () => {
  it("is clientUpdatedAt alone", () => {
    expect(removeLineBody.safeParse({ clientUpdatedAt: AT }).success).toBe(true);
    expect(removeLineBody.safeParse({}).success).toBe(false);
    expect(removeLineBody.safeParse({ clientUpdatedAt: AT, reason: "x" }).success).toBe(false);
  });
});

describe("idParams", () => {
  it("takes a uuid only", () => {
    expect(idParams.safeParse({ id: L1 }).success).toBe(true);
    expect(idParams.safeParse({ id: "x" }).success).toBe(false);
  });
});
