import { describe, expect, it } from "vitest";
import { checkPin } from "@/server/staff-auth/pin-policy";

// M11 acceptance test 6 (policy half): trivial PINs are refused with 422 pin_trivial; a PIN that is not
// exactly four ASCII digits is a format error (400 by the strict Zod body).
describe("checkPin", () => {
  it.each(["1234", "0000", "9999", "6789", "3210", "1212", "9090", "0123", "9876", "5555", "4545"])(
    "%s is trivial",
    (pin) => {
      expect(checkPin(pin)).toBe("trivial");
    },
  );

  it.each(["4827", "5931", "7046", "1123", "1213", "7890", "2580", "1357"])(
    "%s is accepted",
    (pin) => {
      expect(checkPin(pin)).toBe("ok");
    },
  );

  it.each(["123", "12345", "12a4", "１２３４", "", " 4827", "4827 ", "48.7", "-123", "٤٨٢٧"])(
    "%j is a format error",
    (pin) => {
      expect(checkPin(pin)).toBe("format");
    },
  );

  it("checks the format before the triviality (a long run of one digit is a format error)", () => {
    expect(checkPin("00000")).toBe("format");
  });
});
