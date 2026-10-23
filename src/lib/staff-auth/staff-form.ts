import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { isCompletePin } from "./pin-view";

// Form checks that only save a round trip: format and "typed twice". Whether a PIN is too simple is the
// server's rule alone (422 pin_trivial); the form shows its text and has no rule of its own.

const NAME_MAX = 60;

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export interface StaffFormInput {
  name: string;
  role: string;
  pin: string;
  repeat: string;
}

export interface NewStaff {
  displayName: string;
  role: "chef" | "waiter";
  pin: string;
}

export function validatePinForm(
  input: { pin: string; repeat: string },
  locale: Locale = DEFAULT_LOCALE,
): Result<string> {
  if (!isCompletePin(input.pin)) return { ok: false, message: t("staff.pinFormat", {}, locale) };
  if (input.pin !== input.repeat) {
    return { ok: false, message: t("staff.pinMismatch", {}, locale) };
  }
  return { ok: true, value: input.pin };
}

export function validateStaffForm(
  input: StaffFormInput,
  locale: Locale = DEFAULT_LOCALE,
): Result<NewStaff> {
  const displayName = input.name.trim();
  if (displayName.length < 1 || displayName.length > NAME_MAX) {
    return { ok: false, message: t("staffAuthError.display_name_invalid", {}, locale) };
  }
  if (input.role !== "chef" && input.role !== "waiter") {
    return { ok: false, message: t("staffAuthError.staff_role_invalid", {}, locale) };
  }
  const pin = validatePinForm(input, locale);
  if (!pin.ok) return pin;
  return { ok: true, value: { displayName, role: input.role, pin: pin.value } };
}
