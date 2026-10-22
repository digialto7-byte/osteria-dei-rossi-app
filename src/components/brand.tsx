import { t } from "@/lib/i18n";

// Brand pieces of Osteria dei Rossi (docs/design/ui-foundation.md §6). Colours come only from
// the tokens; gold and yellow are accents here, never text on cream.

/**
 * The logo slot in the header, left of the wordmark. A placeholder until the real logo file
 * arrives (TODO in docs/design/ui-foundation.md §8): a small gold lozenge echoing the emblem,
 * deliberately not a redraw of it. Swap the inner markup for the SVG and keep the slot's size.
 */
export function BrandMark() {
  return (
    <span
      aria-hidden="true"
      data-slot="brand-mark"
      className="inline-flex size-6 shrink-0 items-center justify-center"
    >
      <span className="flex size-4 rotate-45 items-center justify-center border-[1.5px] border-gold">
        <span className="size-1.5 bg-highlight" />
      </span>
    </span>
  );
}

/**
 * "Consigliato dall'Oste", the house recommendation badge from the menu site, for the menu and
 * dish screens to come. Yellow fill with black text (a tested AA pair in both themes); the small
 * lozenge repeats the brand mark. The words carry the meaning, so it never relies on colour.
 */
export function RecommendedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-highlight py-0.5 pr-2.5 pl-2 text-sm font-bold text-on-highlight">
      <span aria-hidden="true" className="size-2 rotate-45 border-[1.5px] border-on-highlight" />
      {t("menu.recommended")}
    </span>
  );
}
