import { describe, expect, it } from "vitest";
import { validatePinForm, validateStaffForm } from "@/lib/staff-auth/staff-form";

const FORM = { name: "  Cameriere Demo ", role: "waiter", pin: "4827", repeat: "4827" };

describe("validateStaffForm", () => {
  it("trims the name and returns the body for POST /api/users", () => {
    expect(validateStaffForm(FORM)).toEqual({
      ok: true,
      value: { displayName: "Cameriere Demo", role: "waiter", pin: "4827" },
    });
  });
  it("the two PINs must match", () => {
    expect(validateStaffForm({ ...FORM, repeat: "4828" })).toEqual({
      ok: false,
      message: "I due PIN non coincidono",
    });
  });
  it("the name must be 1 to 60 characters after trimming", () => {
    for (const name of ["", "   ", "x".repeat(61)]) {
      expect(validateStaffForm({ ...FORM, name })).toEqual({
        ok: false,
        message: "Il nome deve avere da 1 a 60 caratteri.",
      });
    }
    expect(validateStaffForm({ ...FORM, name: "x".repeat(60) }).ok).toBe(true);
  });
  it("the role must be chef or waiter", () => {
    expect(validateStaffForm({ ...FORM, role: "owner" }).ok).toBe(false);
    expect(validateStaffForm({ ...FORM, role: "" }).ok).toBe(false);
  });
  it("the PIN must be four digits", () => {
    for (const pin of ["", "482", "48271", "48a7"]) {
      expect(validateStaffForm({ ...FORM, pin, repeat: pin })).toEqual({
        ok: false,
        message: "Il PIN deve avere 4 cifre.",
      });
    }
  });
  it("has no rule of its own about trivial PINs: the server's 422 is shown", () => {
    expect(validateStaffForm({ ...FORM, pin: "1234", repeat: "1234" }).ok).toBe(true);
    expect(validateStaffForm({ ...FORM, pin: "0000", repeat: "0000" }).ok).toBe(true);
  });
  it("english second", () => {
    expect(validateStaffForm({ ...FORM, repeat: "1" }, "en")).toEqual({
      ok: false,
      message: "The two PINs do not match",
    });
  });
});

describe("validatePinForm", () => {
  it("checks format and match, returns the PIN", () => {
    expect(validatePinForm({ pin: "7046", repeat: "7046" })).toEqual({ ok: true, value: "7046" });
    expect(validatePinForm({ pin: "7046", repeat: "7047" }).ok).toBe(false);
    expect(validatePinForm({ pin: "70", repeat: "70" }).ok).toBe(false);
  });
});
