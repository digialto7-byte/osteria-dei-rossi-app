import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { it as italian } from "@/lib/i18n/messages/it";

// UX plan B10 (L1, L2): one set of role words on every screen, and no English "Home" in the Italian UI.
// M25b (Q211, founder 2026-11-01): the founder asked for "Home" as the name of the first tab, pill and group. Exactly those two
// navigation labels may read "Home" in both locales; any other message with that value still fails.
const HOME_LABELS = ["nav.group.home", "nav.today"];
describe.each([
  ["it", italian],
  ["en", en],
] as const)("role words (%s)", (_locale, messages) => {
  it.each(["chef", "waiter"] as const)("role.%s is the same word as its pin.role", (role) => {
    expect(messages[`role.${role}`]).toBe(messages[`pin.role.${role}`]);
  });

  it("no message value is exactly Home, except the two navigation labels the founder chose", () => {
    const keys = Object.entries(messages)
      .filter(([, value]) => value === "Home")
      .map(([key]) => key);
    expect(keys.sort()).toEqual([...HOME_LABELS].sort());
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
