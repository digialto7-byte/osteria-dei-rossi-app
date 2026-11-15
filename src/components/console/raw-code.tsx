import { t } from "@/lib/i18n";

/** A code in small text, so the builder and the founder can search for it: «codice: console.entered». It is shown next to every sentence made from a code. */
export function RawCode({ code }: { code: string }) {
  return (
    <span className="text-sm text-ink-muted [overflow-wrap:anywhere]">
      {t("console.rawCode", { code })}
    </span>
  );
}
