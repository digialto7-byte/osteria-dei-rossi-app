import { describe, expect, it } from "vitest";
import { afterPasswordPath, passwordIntroKey, passwordLinkKey } from "@/lib/auth/password-view";

describe("passwordLinkKey", () => {
  it("offers to set a password after a link sign-in, to change it otherwise", () => {
    expect(passwordLinkKey("link")).toBe("home.setPassword");
    expect(passwordLinkKey("password")).toBe("home.changePassword");
    expect(passwordLinkKey("other")).toBe("home.changePassword");
  });
});

describe("passwordIntroKey", () => {
  it("words the page by how the person signed in", () => {
    expect(passwordIntroKey("link")).toBe("password.introSet");
    expect(passwordIntroKey("password")).toBe("password.introChange");
    expect(passwordIntroKey("other")).toBe("password.introChange");
  });
});

describe("afterPasswordPath", () => {
  it("returns a same-origin path as given and null when none was asked for", () => {
    expect(afterPasswordPath("/report")).toBe("/report");
    expect(afterPasswordPath(null)).toBeNull();
    expect(afterPasswordPath("")).toBeNull();
  });
  it("turns an unsafe address into the home page", () => {
    expect(afterPasswordPath("https://evil.test")).toBe("/");
    expect(afterPasswordPath("//evil.test")).toBe("/");
  });
});
