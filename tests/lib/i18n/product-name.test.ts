import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { it as itMessages } from "@/lib/i18n/messages/it";

// Costì plan CB2 (QW13): the product speaks as "Costì"; the venue's own name has its own key.
describe.each([
  ["it", itMessages],
  ["en", en],
])("product and venue names (%s)", (_locale, messages) => {
  it("app.name is the product, Costì", () => {
    expect(messages["app.name"]).toBe("Costì");
  });

  it("venue.name is the venue, Osteria Dei Rossi", () => {
    expect(messages["venue.name"]).toBe("Osteria Dei Rossi");
  });

  it("the sign-in intro names the product", () => {
    expect(messages["login.intro"]).toContain("Costì");
    expect(messages["login.intro"]).not.toContain("Osteria");
  });
});

describe("login.intro wording", () => {
  it("is exact in both languages", () => {
    expect(itMessages["login.intro"]).toBe("Entra in Costì con la tua email e la password.");
    expect(en["login.intro"]).toBe("Sign in to Costì with your email and password.");
  });
});
