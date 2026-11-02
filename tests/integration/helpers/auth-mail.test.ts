import { describe, expect, it } from "vitest";
import { codeFromMailText } from "./auth-mail";

describe("codeFromMailText", () => {
  it("finds the code on a line of its own", () => {
    const text =
      "Osteria Dei Rossi\nEntra\n\n123456\n\nhttp://127.0.0.1:54321/auth/v1/verify?token=pkce_98765432&type=magiclink";
    expect(codeFromMailText(text)).toBe("123456");
  });

  it("does not take digits from inside the link", () => {
    const text = "Entra http://127.0.0.1:54321/auth/v1/verify?token=111222&type=magiclink\n654321";
    expect(codeFromMailText(text)).toBe("654321");
  });

  it("falls back to a standalone six-digit word", () => {
    expect(codeFromMailText("Il tuo codice è 482913 grazie")).toBe("482913");
  });

  it("returns null when there is none", () => {
    expect(codeFromMailText("niente qui 12345 o 1234567")).toBeNull();
  });
});
