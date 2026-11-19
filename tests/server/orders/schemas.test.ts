import { describe, expect, it } from "vitest";
import {
  addLineBody,
  fireBody,
  idParams,
  removeLineBody,
  updateLineBody,
  voidBody,
} from "@/server/orders/schemas";
import { VOID_REASONS } from "@/server/orders/constants";

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

describe("fireBody (M19)", () => {
  const ids = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );

  it("takes 1 to 50 distinct line ids", () => {
    expect(fireBody.safeParse({ lineIds: ids(1) }).success).toBe(true);
    expect(fireBody.safeParse({ lineIds: ids(50) }).success).toBe(true);
  });

  it("refuses none, more than 50, duplicates, a non-uuid and a stray key", () => {
    expect(fireBody.safeParse({ lineIds: [] }).success).toBe(false);
    expect(fireBody.safeParse({ lineIds: ids(51) }).success).toBe(false);
    expect(fireBody.safeParse({ lineIds: [L1, L1] }).success).toBe(false);
    expect(fireBody.safeParse({ lineIds: ["nope"] }).success).toBe(false);
    expect(fireBody.safeParse({ lineIds: ids(2), course: "primi" }).success).toBe(false);
    expect(fireBody.safeParse({}).success).toBe(false);
  });
});

describe("voidBody (M19)", () => {
  // not_prepared added on purpose by comanda-uscite (step 9; the database list gained it in M4).
  it("takes each of the seven reasons, exactly VOID_REASONS", () => {
    expect([...VOID_REASONS]).toEqual([
      "order_error",
      "customer_changed",
      "kitchen_error",
      "returned",
      "comp",
      "breakage",
      "not_prepared",
    ]);
    for (const reason of VOID_REASONS) {
      expect(voidBody.safeParse({ reason, clientUpdatedAt: AT }).success, reason).toBe(true);
    }
  });

  it("refuses entry_removed (M18's internal reason), an unknown reason, a missing key and a stray key", () => {
    expect(voidBody.safeParse({ reason: "entry_removed", clientUpdatedAt: AT }).success).toBe(
      false,
    );
    expect(voidBody.safeParse({ reason: "foo", clientUpdatedAt: AT }).success).toBe(false);
    expect(voidBody.safeParse({ reason: "comp" }).success).toBe(false);
    expect(voidBody.safeParse({ clientUpdatedAt: AT }).success).toBe(false);
    expect(voidBody.safeParse({ reason: "comp", clientUpdatedAt: AT, note: "x" }).success).toBe(
      false,
    );
    expect(voidBody.safeParse({ reason: "comp", clientUpdatedAt: "yesterday" }).success).toBe(
      false,
    );
  });
});

// Comanda per uscita (docs/plans/2026-11-18-comanda-uscite.md step 9).
describe("comanda per uscita bodies", () => {
  it("callBody refuses {uscita: 1} and {uscita: 2, extra: 1}", async () => {
    const { callBody } = await import("@/server/orders/schemas");
    expect(callBody.safeParse({ uscita: 1 }).success).toBe(false);
    expect(callBody.safeParse({ uscita: 2, extra: 1 }).success).toBe(false);
    expect(callBody.safeParse({ uscita: 2 }).success).toBe(true);
    expect(callBody.safeParse({ uscita: 9 }).success).toBe(true);
    expect(callBody.safeParse({ uscita: 10 }).success).toBe(false);
    expect(callBody.safeParse({ uscita: 2.5 }).success).toBe(false);
    expect(callBody.safeParse({ uscita: "2" }).success).toBe(false);
  });

  it("addLineBody accepts uscita 0..9 and refuses it together with segue", async () => {
    const { addLineBody } = await import("@/server/orders/schemas");
    const base = {
      lineId: "00000000-0000-4000-8000-000000000001",
      menuItemId: "00000000-0000-4000-8000-000000000002",
      clientUpdatedAt: "2026-11-19T10:00:00Z",
    };
    expect(addLineBody.safeParse({ ...base, uscita: 0 }).success).toBe(true);
    expect(addLineBody.safeParse({ ...base, uscita: 9 }).success).toBe(true);
    expect(addLineBody.safeParse({ ...base, uscita: 10 }).success).toBe(false);
    expect(addLineBody.safeParse({ ...base, uscita: -1 }).success).toBe(false);
    expect(addLineBody.safeParse({ ...base, uscita: 2, segue: true }).success).toBe(false);
    expect(addLineBody.safeParse({ ...base, segue: true }).success).toBe(true);
  });

  it("updateLineBody accepts uscita alone and refuses it with segue", async () => {
    const { updateLineBody } = await import("@/server/orders/schemas");
    const at = { clientUpdatedAt: "2026-11-19T10:00:00Z" };
    expect(updateLineBody.safeParse({ ...at, uscita: 3 }).success).toBe(true);
    expect(updateLineBody.safeParse({ ...at, uscita: 3, segue: false }).success).toBe(false);
    expect(updateLineBody.safeParse({ ...at, uscita: null }).success).toBe(false);
  });

  it("fireBody accepts a boolean hold and nothing else", async () => {
    const { fireBody } = await import("@/server/orders/schemas");
    const lineIds = ["00000000-0000-4000-8000-000000000001"];
    expect(fireBody.safeParse({ lineIds, hold: true }).success).toBe(true);
    expect(fireBody.safeParse({ lineIds, hold: false }).success).toBe(true);
    expect(fireBody.safeParse({ lineIds }).success).toBe(true);
    expect(fireBody.safeParse({ lineIds, hold: "yes" }).success).toBe(false);
  });

  it("voidBody accepts not_prepared", async () => {
    const { voidBody } = await import("@/server/orders/schemas");
    expect(
      voidBody.safeParse({ reason: "not_prepared", clientUpdatedAt: "2026-11-19T10:00:00Z" })
        .success,
    ).toBe(true);
  });
});
