import { describe, expect, it } from "vitest";
import {
  copertoBody,
  createDiningTableBody,
  idParams,
  openTableBody,
  sessionPatchBody,
  updateDiningTableBody,
} from "@/server/tables/schemas";

const S1 = "5e000000-0000-4000-8000-000000000001";

describe("openTableBody", () => {
  it("takes the client's session id and the covers, 1 to 99", () => {
    for (const covers of [1, 4, 99]) {
      expect(openTableBody.safeParse({ sessionId: S1, covers }).success, String(covers)).toBe(true);
    }
  });

  it.each([
    ["covers 0", { sessionId: S1, covers: 0 }],
    ["covers 100", { sessionId: S1, covers: 100 }],
    ["covers 2.5", { sessionId: S1, covers: 2.5 }],
    ["covers as text", { sessionId: S1, covers: "4" }],
    ["no session id", { covers: 4 }],
    ["a malformed session id", { sessionId: "x", covers: 4 }],
    ["no covers", { sessionId: S1 }],
    ["an unknown key", { sessionId: S1, covers: 4, waiterId: S1 }],
  ])("refuses %s", (_name, body) => {
    expect(openTableBody.safeParse(body).success).toBe(false);
  });
});

describe("sessionPatchBody", () => {
  it("accepts covers, billRequested or both", () => {
    for (const patch of [
      { covers: 5 },
      { billRequested: true },
      { covers: 2, billRequested: false },
    ]) {
      expect(sessionPatchBody.safeParse(patch).success, JSON.stringify(patch)).toBe(true);
    }
  });

  it.each([
    ["an empty patch", {}],
    ["covers 0", { covers: 0 }],
    ["covers 100", { covers: 100 }],
    ["an unknown key", { covers: 2, closedAt: "2026-11-02T20:00:00Z" }],
    ["billRequested as text", { billRequested: "true" }],
  ])("refuses %s", (_name, body) => {
    expect(sessionPatchBody.safeParse(body).success).toBe(false);
  });
});

describe("dining table bodies", () => {
  it("create: a name of 1 to 40 characters and an optional position", () => {
    expect(createDiningTableBody.safeParse({ name: "Tavolo 1 (demo)" }).success).toBe(true);
    expect(createDiningTableBody.safeParse({ name: "T", position: 9999 }).success).toBe(true);
    for (const body of [
      {},
      { name: "" },
      { name: "  " },
      { name: "x".repeat(41) },
      { name: "T", position: 10000 },
      { name: "T", position: -1 },
      { name: "T", active: true },
    ]) {
      expect(createDiningTableBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("update: any of name, position, active; never an empty patch", () => {
    for (const patch of [{ name: "Tavolo 2 (demo)" }, { position: 2 }, { active: false }]) {
      expect(updateDiningTableBody.safeParse(patch).success, JSON.stringify(patch)).toBe(true);
    }
    for (const patch of [{}, { name: "" }, { open: true }, { active: "no" }]) {
      expect(updateDiningTableBody.safeParse(patch).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it("params take a uuid", () => {
    expect(idParams.safeParse({ id: S1 }).success).toBe(true);
    expect(idParams.safeParse({ id: "1" }).success).toBe(false);
  });
});

describe("copertoBody", () => {
  it("needs both keys; a number and an allowed rate, or null and null to clear", () => {
    expect(copertoBody.safeParse({ copertoAmount: 1.5, copertoVatRate: 10 }).success).toBe(true);
    expect(copertoBody.safeParse({ copertoAmount: null, copertoVatRate: null }).success).toBe(true);
    expect(copertoBody.safeParse({ copertoAmount: 100, copertoVatRate: 22 }).success).toBe(true);
  });

  it("leaves the one-null pair to the database (coperto_invalid, 422)", () => {
    expect(copertoBody.safeParse({ copertoAmount: 1.5, copertoVatRate: null }).success).toBe(true);
  });

  it.each([
    ["a missing key", { copertoAmount: 1.5 }],
    ["an amount of 0", { copertoAmount: 0, copertoVatRate: 10 }],
    ["an amount above 100", { copertoAmount: 100.01, copertoVatRate: 10 }],
    ["3 decimals", { copertoAmount: 1.505, copertoVatRate: 10 }],
    ["an amount as text", { copertoAmount: "1,50", copertoVatRate: 10 }],
    ["a VAT rate that is not allowed", { copertoAmount: 1.5, copertoVatRate: 12 }],
    ["an unknown key", { copertoAmount: 1.5, copertoVatRate: 10, perPerson: 1 }],
  ])("refuses %s", (_name, body) => {
    expect(copertoBody.safeParse(body).success).toBe(false);
  });
});
