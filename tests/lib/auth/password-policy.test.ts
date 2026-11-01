import { describe, expect, it } from "vitest";
import { COMMON_PASSWORD_LIST } from "@/lib/auth/common-passwords";
import {
  checkNewPassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  passwordRejectionKey,
  type PasswordRejection,
} from "@/lib/auth/password-policy";

const EMAIL = "titolare.demo@example.test";
const check = (password: string, email = EMAIL) => checkNewPassword(password, { email });
const reason = (password: string, email = EMAIL) => {
  const result = check(password, email);
  return result.ok ? "ok" : result.reason;
};

describe("checkNewPassword", () => {
  it("has a minimum of 10 and a maximum of 72 bytes", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(PASSWORD_MAX_BYTES).toBe(72);
  });

  it("accepts a sentence, spaces included, without trimming", () => {
    expect(check("una frase lunga per il locale")).toEqual({ ok: true });
    expect(reason("          x")).toBe("repetitive");
  });

  it.each<[string, PasswordRejection]>([
    ["Corta1!", "too_short"],
    ["a".repeat(73), "too_long"],
    ["titolare.demo2026", "like_email"],
    ["OsteriaDeiRossi!!", "like_venue"],
    ["aaaaaaaaaaaa", "repetitive"],
    ["abababababab", "repetitive"],
    ["1234567890", "sequence"],
    ["qwertyuiop", "sequence"],
  ])("%s -> %s", (password, expected) => {
    expect(reason(password)).toBe(expected);
  });

  it("refuses a common entry, upper-cased (the list's first entry is caught earlier, by `sequence`)", () => {
    const first = COMMON_PASSWORD_LIST[0]!;
    expect(reason(first.toUpperCase())).toBe("sequence");
    const reachesCommon = COMMON_PASSWORD_LIST.filter((w) => reason(w) === "common");
    expect(reachesCommon.length).toBeGreaterThan(0);
    for (const word of reachesCommon) expect(reason(word.toUpperCase()), word).toBe("common");
  });

  it("every list entry is refused for some reason", () => {
    for (const word of COMMON_PASSWORD_LIST) expect(check(word).ok, word).toBe(false);
  });

  it("counts code points: exactly 10 of a multi-byte letter passes the length rule, 9 fails", () => {
    expect(reason("è".repeat(10))).toBe("repetitive");
    expect(reason("èàìòùèàìòù")).toBe("ok");
    expect(reason("èàìòùèàìò")).toBe("too_short");
  });

  it("counts bytes for the upper limit: 72 one-byte characters pass, 25 euro signs do not", () => {
    const seventyTwo = "abcdefghij".repeat(7) + "kl";
    expect(seventyTwo).toHaveLength(72);
    expect(reason(seventyTwo)).toBe("ok");
    expect(reason("€".repeat(25))).toBe("too_long");
  });

  it("refuses the local part of the address, ignoring case, when it is 4 or more characters", () => {
    expect(reason("Titolare.Demo")).toBe("like_email");
    expect(reason("TITOLARE.DEMO@EXAMPLE.TEST")).toBe("like_email");
    expect(reason("prima-titolare.demo-dopo")).toBe("like_email");
  });

  it("does not refuse a short local part inside the password", () => {
    expect(reason("zebra ab lunga frase", "ab@example.test")).toBe("ok");
    expect(reason("ab", "ab@example.test")).toBe("too_short");
  });

  it("refuses the venue's name however it is spelled", () => {
    for (const p of [
      "Osteria 2026 sera",
      "la Rossi 12345",
      "dei-rossi-1234",
      "OSTERIA dei ROSSI",
    ]) {
      expect(reason(p), p).toBe("like_venue");
    }
  });

  it("checks the rules in the documented order", () => {
    expect(reason("password1")).toBe("too_short");
    expect(reason("osteria")).toBe("too_short");
  });
});

describe("passwordRejectionKey", () => {
  it("maps every reason to a message key", () => {
    const reasons: PasswordRejection[] = [
      "too_short",
      "too_long",
      "like_email",
      "like_venue",
      "repetitive",
      "sequence",
      "common",
    ];
    for (const r of reasons) expect(passwordRejectionKey(r)).toBe(`password.reject.${r}`);
  });
});
