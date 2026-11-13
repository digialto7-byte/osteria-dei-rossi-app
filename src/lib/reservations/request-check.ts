import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locale";

// UX quick wins QW2 (finding F02): the booking form names what is missing instead of disabling its button. This checks presence only;
// the server still validates every value, so nothing here decides a rule.

export type MissingField = "date" | "slot" | "name" | "phone" | "email" | "privacy";

export interface RequestDraft {
  date: string;
  /** Whether a time that is still offered is chosen. */
  slot: boolean;
  name: string;
  phone: string;
  email: string;
  /** Whether the privacy notice box is ticked. */
  privacy: boolean;
}

/** The fields still missing, in the order they appear in the form. */
export function missingFields(draft: RequestDraft): MissingField[] {
  const missing: MissingField[] = [];
  if (draft.date === "") missing.push("date");
  if (!draft.slot) missing.push("slot");
  if (draft.name.trim() === "") missing.push("name");
  if (draft.phone.trim() === "") missing.push("phone");
  if (draft.email.trim() === "") missing.push("email");
  if (!draft.privacy) missing.push("privacy");
  return missing;
}

/** "Manca: telefono" / "Mancano: telefono, e-mail" (and the English pair); null when nothing is missing. Names fields, never values. */
export function missingMessage(fields: readonly MissingField[], locale: Locale): string | null {
  if (fields.length === 0) return null;
  const names = fields.map((field) => t(`publicReservation.missingField.${field}`, {}, locale));
  return t(
    fields.length === 1 ? "publicReservation.missingOne" : "publicReservation.missingMany",
    { fields: names.join(", ") },
    locale,
  );
}
