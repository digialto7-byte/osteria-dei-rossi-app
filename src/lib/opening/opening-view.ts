import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { t } from "@/lib/i18n";
import type { AppRole } from "@/lib/api/with-api";

// Opening stock (plan 2026-11-18 step 13): pure helpers for the screen of PR 5. No data logic: the totals come from the server.

/** "Dispensa · 24 righe · 1.610,20 €". */
export function locationHeading(
  location: { name: string; lineCount: number; totalValueEur: number },
  locale: Locale = DEFAULT_LOCALE,
): string {
  const lines = t(
    location.lineCount === 1 ? "opening.lines.one" : "opening.lines.other",
    { count: location.lineCount },
    locale,
  );
  return `${location.name} · ${lines} · ${formatEuro(location.totalValueEur, locale)}`;
}

/** The overall total of the draft, "1.234,50 €". */
export function openingTotal(totalValueEur: number, locale: Locale = DEFAULT_LOCALE): string {
  return formatEuro(totalValueEur, locale);
}

/** Only the owner and the admin enter or correct the carico (it sets costs); the database enforces it too. */
export function canEditOpening(role: AppRole): boolean {
  return role === "owner" || role === "admin";
}

/** "Correggi il carico" is offered while the server says so and the operation is not reversed. */
export function isCorrectable(op: { correctable: boolean; reversed: unknown }): boolean {
  return op.correctable && op.reversed === null;
}
