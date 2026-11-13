import { describe, expect, it } from "vitest";
import {
  missingFields,
  missingMessage,
  type MissingField,
  type RequestDraft,
} from "@/lib/reservations/request-check";

// UX quick wins QW2: the booking form names what is missing. Presence only; the server still validates every value.
const FULL: RequestDraft = {
  date: "2026-11-27",
  slot: true,
  name: "Cliente Demo",
  phone: "+39 000 0000001",
  email: "cliente.demo@example.com",
  privacy: true,
};

describe("missingFields", () => {
  it("is empty when nothing is missing", () => {
    expect(missingFields(FULL)).toEqual([]);
  });

  it.each<[MissingField, Partial<RequestDraft>]>([
    ["date", { date: "" }],
    ["slot", { slot: false }],
    ["name", { name: "" }],
    ["phone", { phone: "" }],
    ["email", { email: "" }],
    ["privacy", { privacy: false }],
  ])("names %s when it is the only one missing", (field, gap) => {
    expect(missingFields({ ...FULL, ...gap })).toEqual([field]);
  });

  it("lists everything in form order when everything is missing", () => {
    expect(
      missingFields({ date: "", slot: false, name: "", phone: "", email: "", privacy: false }),
    ).toEqual(["date", "slot", "name", "phone", "email", "privacy"]);
  });

  it("keeps form order whatever the gaps", () => {
    expect(missingFields({ ...FULL, email: "", name: " ", privacy: false })).toEqual([
      "name",
      "email",
      "privacy",
    ]);
  });

  it.each(["name", "phone", "email"] as const)("a whitespace-only %s is missing", (key) => {
    expect(missingFields({ ...FULL, [key]: "  \t " })).toEqual([key]);
  });

  it("does not judge the values: a short or odd phone and e-mail are present", () => {
    expect(missingFields({ ...FULL, phone: "1", email: "x" })).toEqual([]);
  });
});

describe("missingMessage", () => {
  it("is null when nothing is missing", () => {
    expect(missingMessage([], "it")).toBeNull();
    expect(missingMessage([], "en")).toBeNull();
  });

  it("uses the singular for one field and the plural for more, in Italian", () => {
    expect(missingMessage(["phone"], "it")).toBe("Manca: telefono");
    expect(missingMessage(["privacy"], "it")).toBe("Manca: conferma dell'informativa privacy");
    expect(missingMessage(["phone", "email"], "it")).toBe("Mancano: telefono, e-mail");
  });

  it("says it in English too", () => {
    expect(missingMessage(["phone"], "en")).toBe("Missing: phone");
    expect(missingMessage(["phone", "email"], "en")).toBe("Missing: phone, e-mail");
    expect(missingMessage(["privacy"], "en")).toBe("Missing: confirmation of the privacy notice");
  });

  it("names the fields in the order given", () => {
    expect(missingMessage(["date", "slot", "name"], "it")).toBe("Mancano: data, orario, nome");
  });
});
