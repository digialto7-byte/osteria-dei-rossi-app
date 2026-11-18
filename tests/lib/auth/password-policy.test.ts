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
// Tenant #1's name: the words the policy refused before SP1 came from constants, now they come from the name (SP1 step 15, G for H32).
const ROSSI = ["Osteria Dei Rossi"];
const check = (password: string, email = EMAIL, venueNames: string[] = ROSSI) =>
  checkNewPassword(password, { email, venueNames });
const reason = (password: string, email = EMAIL, venueNames: string[] = ROSSI) => {
  const result = check(password, email, venueNames);
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

  it("refuses the venue's name written with separators or joined", () => {
    for (const p of [
      "OsteriaDeiRossi!!",
      "osteria dei rossi 2026",
      "osteria-dei_rossi",
      "x osteria.dei.rossi x",
    ]) {
      expect(reason(p), p).toBe("like_venue");
    }
  });

  it("refuses the venue's name in camel case, full-width, accented or with zero-width characters", () => {
    for (const p of [
      "LaRossi12345",
      "OsteriaRossi2026",
      "RossiOsteria2026",
      "\uFF32\uFF2F\uFF33\uFF33\uFF29 2026 abc",
      "R\u00F2ssi 2026 abc",
      "oster\u00EDadeirossi 1",
      "ro\u200Bssi 2026 abc",
      "ro\u200D\uFEFFssi 2026 abc",
      "ROSSIosteria 2026",
      "ro\u00ADssi 2026 abc",
      "ro\u2060ssi 2026 abc",
      "ro\u180Essi 2026 abc",
    ]) {
      expect(reason(p), JSON.stringify(p)).toBe("like_venue");
    }
  });

  it("accepts sentences with words that merely contain the venue's name", () => {
    for (const p of [
      "la prossima volta porto il vino",
      "ci vediamo il prossimo anno",
      "due cani grossi e un gatto",
      "un gatto rossiccio sul tetto",
      "un cane rossiccio di nome Pippo",
      "dei miei amici al mare",
    ]) {
      expect(reason(p), p).toBe("ok");
    }
  });

  it("checks the rules in the documented order", () => {
    expect(reason("password1")).toBe("too_short");
    expect(reason("osteria")).toBe("too_short");
  });
});

// SP1 step 15 (H32, AT5): the refused words come from the tenant's own name.
describe("checkNewPassword, venue words from the tenant's name", () => {
  const B = ["Osteria Demo B"];

  it("with venueNames ['Osteria Demo B'] the password 'DemoB-cucina-2026' is refused like_venue", () => {
    expect(reason("DemoB-cucina-2026", EMAIL, B)).toBe("like_venue");
  });

  it("the same password is fine for tenant #1, whose words are not Demo", () => {
    expect(reason("DemoB-cucina-2026")).toBe("ok");
  });

  it("another tenant's words are not refused: 'Osteria2026!sole' passes for a venue with other words", () => {
    expect(reason("Osteria2026!sole", EMAIL, ["Trattoria Da Luigi"])).toBe("ok");
    expect(reason("Luigi2026!sole", EMAIL, ["Trattoria Da Luigi"])).toBe("like_venue");
  });

  it("refuses the joins of every run of two or more words, and the reverse of first and last", () => {
    const name = ["Osteria Dei Rossi"];
    for (const p of [
      "osteriadei 2026 abc",
      "deirossi 2026 abc",
      "osteriadeirossi1",
      "osteriarossi 2026",
      "rossiosteria 2026",
    ]) {
      expect(reason(p, EMAIL, name), p).toBe("like_venue");
    }
    expect(reason("Casa Bella Vista", EMAIL, ["Casa Bella Vista"])).toBe("like_venue");
    expect(reason("vistacasa 2026 xy", EMAIL, ["Casa Bella Vista"])).toBe("like_venue");
    expect(reason("bellavista 2026 x", EMAIL, ["Casa Bella Vista"])).toBe("like_venue");
  });

  it("derives words from accents, full-width letters and zero-width characters in the name", () => {
    expect(reason("zucchero 2026 abc", EMAIL, ["Caff\u00E8 Zucchero"])).toBe("like_venue");
    expect(reason("caffe 2026 abcd", EMAIL, ["Caff\u00E8 Zucchero"])).toBe("like_venue");
    expect(reason("zucchero 2026 abc", EMAIL, ["\uFF3A\uFF55cchero"])).toBe("like_venue");
    expect(reason("zucchero 2026 abc", EMAIL, ["Zu\u200Bcchero"])).toBe("like_venue");
  });

  it("words shorter than four letters alone are not refused, only inside a join", () => {
    expect(reason("dei miei amici al mare", EMAIL, ["Osteria Dei Rossi"])).toBe("ok");
    expect(reason("Una frase con Dei Bar", EMAIL, ["Dei Bar"])).toBe("like_venue");
    expect(reason("una frase con bar e dei", EMAIL, ["Dei Bar"])).toBe("ok");
  });

  it("checks every name it is given", () => {
    expect(reason("Marinella2026!x", EMAIL, ["Osteria Dei Rossi", "Da Marinella"])).toBe(
      "like_venue",
    );
    expect(reason("Rossi2026!xyz", EMAIL, ["Osteria Dei Rossi", "Da Marinella"])).toBe(
      "like_venue",
    );
  });

  it("with no names nothing is refused for the venue", () => {
    expect(reason("OsteriaDeiRossi!!", EMAIL, [])).toBe("ok");
  });

  it("does not refuse words that merely contain the tenant's words", () => {
    expect(reason("la prossima volta in Demolizione", EMAIL, B)).toBe("ok");
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
