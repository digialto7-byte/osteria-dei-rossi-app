import { describe, expect, it } from "vitest";
import { approveBody, rejectBody } from "@/server/invoices/approval-schemas";

const UUID = "10000000-0000-4000-8000-000000000001";

describe("approveBody", () => {
  it("accepts an empty body and a location id", () => {
    expect(approveBody.safeParse({}).success).toBe(true);
    const parsed = approveBody.safeParse({ locationId: UUID });
    expect(parsed.success && parsed.data).toEqual({ locationId: UUID });
  });

  it.each([
    ["a bad location id", { locationId: "x" }],
    ["a null location id", { locationId: null }],
    ["an unknown key", { locationId: UUID, force: true }],
    ["an unknown key alone", { status: "approved" }],
  ])("rejects %s", (_name, body) => {
    expect(approveBody.safeParse(body).success).toBe(false);
  });
});

describe("rejectBody", () => {
  const parse = (value: unknown) => rejectBody.safeParse(value);

  it("accepts no reason", () => {
    expect(parse({}).success).toBe(true);
  });

  it("trims the reason", () => {
    const parsed = parse({ reason: "  Merce non ordinata  " });
    expect(parsed.success && parsed.data).toEqual({ reason: "Merce non ordinata" });
  });

  it("accepts 200 characters and keeps accents and emoji-free punctuation", () => {
    expect(parse({ reason: "è".repeat(200) }).success).toBe(true);
    expect(parse({ reason: "Prezzo errato: « 12,50 € »." }).success).toBe(true);
  });

  it("refuses a reason of 201 characters, also after trimming", () => {
    expect(parse({ reason: "a".repeat(201) }).success).toBe(false);
    expect(parse({ reason: ` ${"a".repeat(200)} ` }).success).toBe(true);
  });

  it("refuses an empty or blank reason (omit it instead)", () => {
    expect(parse({ reason: "" }).success).toBe(false);
    expect(parse({ reason: "   " }).success).toBe(false);
  });

  it.each([
    ["a newline", "riga\nnuova"],
    ["a tab", "a\tb"],
    ["a NUL", "a\u0000b"],
    ["U+202E (right-to-left override)", "fattura‮gnp.exe"],
    ["U+2066 (isolate)", "a⁦b"],
    ["U+200F (right-to-left mark)", "a‏b"],
  ])("refuses %s", (_name, reason) => {
    expect(parse({ reason }).success).toBe(false);
  });

  it.each([
    ["an unknown key", { reason: "x", extra: 1 }],
    ["a null reason", { reason: null }],
    ["a number", { reason: 5 }],
  ])("rejects %s", (_name, body) => {
    expect(parse(body).success).toBe(false);
  });
});
