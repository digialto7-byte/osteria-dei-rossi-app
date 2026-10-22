import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";

const KB = 1024;
const MB = KB * KB;

/** A file size for people: "999 B", "1,5 KB", "4 MB" (binary units, one decimal at most). */
export function formatBytes(bytes: number, locale: Locale = DEFAULT_LOCALE): string {
  if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError("formatBytes: invalid size");
  const number = new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 1 });
  if (bytes >= MB) return `${number.format(bytes / MB)} MB`;
  if (bytes >= KB) return `${number.format(bytes / KB)} KB`;
  return `${number.format(bytes)} B`;
}
