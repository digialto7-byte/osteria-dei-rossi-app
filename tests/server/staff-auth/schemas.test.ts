import { describe, expect, it } from "vitest";
import {
  createUserBody,
  enrolBody,
  enrolmentCodeBody,
  patchUserBody,
  pinBody,
  pinLoginBody,
} from "@/server/staff-auth/schemas";

const ID = "91000000-0000-4000-8000-000000000001";

describe("pinLoginBody", () => {
  it("accepts a user id and a four-digit PIN", () => {
    expect(pinLoginBody.safeParse({ userId: ID, pin: "4827" }).success).toBe(true);
  });

  it.each([
    { userId: ID, pin: "12345" },
    { userId: ID, pin: "123" },
    { userId: ID, pin: "12a4" },
    { userId: ID, pin: "１２３４" },
    { userId: ID, pin: 4827 },
    { userId: "nope", pin: "4827" },
    { userId: ID },
    { userId: ID, pin: "4827", extra: 1 },
  ])("refuses %j", (body) => {
    expect(pinLoginBody.safeParse(body).success).toBe(false);
  });

  it("the Zod issue messages hold no PIN value", () => {
    const result = pinLoginBody.safeParse({ userId: ID, pin: "12345" });
    expect(JSON.stringify(result.error?.issues.map((i) => i.message))).not.toContain("12345");
  });
});

describe("the other bodies", () => {
  it("enrolBody: a code of at most 16 characters", () => {
    expect(enrolBody.safeParse({ code: "K7M2-QX9P" }).success).toBe(true);
    expect(enrolBody.safeParse({ code: "x".repeat(17) }).success).toBe(false);
    expect(enrolBody.safeParse({ code: "" }).success).toBe(false);
  });

  it("enrolmentCodeBody: a label of 1 to 60 characters, trimmed", () => {
    expect(enrolmentCodeBody.parse({ label: "  Telefono sala (demo) " }).label).toBe(
      "Telefono sala (demo)",
    );
    expect(enrolmentCodeBody.safeParse({ label: "   " }).success).toBe(false);
    expect(enrolmentCodeBody.safeParse({ label: "x".repeat(61) }).success).toBe(false);
  });

  it("createUserBody: name, role chef or waiter, PIN", () => {
    const ok = { displayName: "Cameriere Demo", role: "waiter", pin: "4827" };
    expect(createUserBody.safeParse(ok).success).toBe(true);
    expect(createUserBody.safeParse({ ...ok, role: "owner" }).success).toBe(false);
    expect(createUserBody.safeParse({ ...ok, role: "admin" }).success).toBe(false);
    expect(createUserBody.safeParse({ ...ok, pin: "48271" }).success).toBe(false);
    expect(createUserBody.safeParse({ ...ok, displayName: "" }).success).toBe(false);
    expect(createUserBody.parse({ ...ok, displayName: "  Cuoco Demo " }).displayName).toBe(
      "Cuoco Demo",
    );
  });

  it("patchUserBody: at least one field", () => {
    expect(patchUserBody.safeParse({}).success).toBe(false);
    expect(patchUserBody.safeParse({ active: false }).success).toBe(true);
    expect(patchUserBody.safeParse({ role: "chef", displayName: "Cuoco Demo" }).success).toBe(true);
    expect(patchUserBody.safeParse({ role: "owner" }).success).toBe(false);
    expect(patchUserBody.safeParse({ pin: "4827" }).success).toBe(false);
  });

  it("pinBody: a four-digit PIN only", () => {
    expect(pinBody.safeParse({ pin: "7046" }).success).toBe(true);
    expect(pinBody.safeParse({ pin: "70461" }).success).toBe(false);
  });
});
