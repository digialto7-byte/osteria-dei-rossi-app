import { describe, expect, it } from "vitest";
import { canPurge, confirmMatches, showBanner } from "@/lib/demo/demo-view";

const NAME = "Osteria Demo (dati di prova)";

describe("showBanner", () => {
  it("only for a demo tenant", () => {
    expect(showBanner(true)).toBe(true);
    expect(showBanner(false)).toBe(false);
    expect(showBanner(undefined)).toBe(false);
  });
});

describe("canPurge", () => {
  it("only the owner of a demo tenant", () => {
    expect(canPurge("owner", true)).toBe(true);
    for (const role of ["admin", "chef", "waiter", "", "OWNER"]) {
      expect(canPurge(role, true)).toBe(false);
    }
    expect(canPurge("owner", false)).toBe(false);
  });
});

describe("confirmMatches", () => {
  it("matches the exact name", () => {
    expect(confirmMatches(NAME, NAME)).toBe(true);
  });
  it("trims nothing and is case sensitive", () => {
    expect(confirmMatches(` ${NAME}`, NAME)).toBe(false);
    expect(confirmMatches(`${NAME} `, NAME)).toBe(false);
    expect(confirmMatches(NAME.toLowerCase(), NAME)).toBe(false);
  });
  it("never matches an empty name or an empty text", () => {
    expect(confirmMatches("", "")).toBe(false);
    expect(confirmMatches("", NAME)).toBe(false);
    expect(confirmMatches("Osteria", NAME)).toBe(false);
  });
});
