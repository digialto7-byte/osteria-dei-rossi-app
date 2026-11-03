import { describe, expect, it } from "vitest";
import {
  codeDigits,
  loginNotice,
  needsEmail,
  passwordFieldType,
  toggleLabelKey,
} from "@/lib/auth/login-view";

describe("loginNotice", () => {
  it("maps the ?errore= values the login page knows", () => {
    expect(loginNotice("link")).toBe("link");
    expect(loginNotice("sessione")).toBe("session");
  });
  it("ignores anything else", () => {
    expect(loginNotice(undefined)).toBeNull();
    expect(loginNotice("")).toBeNull();
    expect(loginNotice("<script>")).toBeNull();
  });
});

describe("needsEmail", () => {
  it("is true for an empty or blank address", () => {
    expect(needsEmail("")).toBe(true);
    expect(needsEmail("   ")).toBe(true);
    expect(needsEmail("titolare.demo@example.test")).toBe(false);
  });
});

describe("password visibility", () => {
  it("shows text only when asked", () => {
    expect(passwordFieldType(false)).toBe("password");
    expect(passwordFieldType(true)).toBe("text");
    expect(toggleLabelKey(false)).toBe("login.show");
    expect(toggleLabelKey(true)).toBe("login.hide");
  });
});

describe("codeDigits", () => {
  it("keeps up to six digits", () => {
    expect(codeDigits("12 34-56 78")).toBe("123456");
    expect(codeDigits("abc")).toBe("");
    expect(codeDigits("")).toBe("");
  });
});
