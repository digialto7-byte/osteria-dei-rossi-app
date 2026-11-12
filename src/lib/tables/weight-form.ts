import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { WeightSettings } from "@/server/menu/output";
import type { WeightSettingsBody } from "@/server/menu/schemas";

// The "Peso massimo per riga" card: what is typed to and from the PUT /api/settings/weight body. Pure. The range and
// the step come from the server's reply, and the database stays the authority (`weight_max_invalid`).

export interface WeightFormState {
  value: string;
}

/** The card's field: the maximum in force, in grams. */
export function weightFormFromRead(settings: WeightSettings): WeightFormState {
  return { value: String(settings.weightMaxG) };
}

/** The PUT body, or the Italian message. Whole grams in the server's range and on its step; nothing else is sent. */
export function weightBodyFromForm(
  form: WeightFormState,
  settings: Pick<WeightSettings, "settingMinG" | "settingMaxG" | "stepG">,
  locale: Locale = DEFAULT_LOCALE,
): { ok: true; body: WeightSettingsBody } | { ok: false; error: string } {
  const text = form.value.trim();
  const grams = /^\d{1,6}$/.test(text) ? Number(text) : NaN;
  const valid =
    Number.isInteger(grams) &&
    grams >= settings.settingMinG &&
    grams <= settings.settingMaxG &&
    grams % settings.stepG === 0;
  if (!valid) return { ok: false, error: t("menuError.weight_max_invalid", {}, locale) };
  return { ok: true, body: { weightMaxG: grams } };
}
