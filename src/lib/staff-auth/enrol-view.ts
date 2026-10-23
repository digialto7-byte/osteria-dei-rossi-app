import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";

/** The text for a failed POST /api/devices/enrol. Unknown, used and expired codes read the same. */
export function enrolFeedback(error: { code: string }, locale: Locale = DEFAULT_LOCALE): string {
  switch (error.code) {
    case "enrolment_code_invalid":
    case "enrolment_code_used":
    case "enrolment_code_expired":
      return t("enrol.invalid", {}, locale);
    case "enrol_rate_limited":
      return t("enrol.tooMany", {}, locale);
    default:
      return t("enrol.unavailable", {}, locale);
  }
}

export function enrolSuccessText(label: string, locale: Locale = DEFAULT_LOCALE): string {
  return t("enrol.success", { label }, locale);
}
