import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { it as italian } from "@/lib/i18n/messages/it";

// UX plan B10 (L1, L2): one set of role words on every screen, and no English "Home" in the Italian UI.
describe.each([
  ["it", italian],
  ["en", en],
] as const)("role words (%s)", (_locale, messages) => {
  it.each(["chef", "waiter"] as const)("role.%s is the same word as its pin.role", (role) => {
    expect(messages[`role.${role}`]).toBe(messages[`pin.role.${role}`]);
  });

  it("no message value is exactly Home", () => {
    expect(Object.entries(messages).filter(([, value]) => value === "Home")).toEqual([]);
  });
});

describe("the Italian words", () => {
  it("are Titolare, Amministratore, Cuoco and Cameriere", () => {
    expect([
      italian["role.owner"],
      italian["role.admin"],
      italian["role.chef"],
      italian["role.waiter"],
    ]).toEqual(["Titolare", "Amministratore", "Cuoco", "Cameriere"]);
  });
});
