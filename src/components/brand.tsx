import Link from "next/link";
import type { Venue } from "@/lib/design/venue-layer";
import { t } from "@/lib/i18n";

// Brand pieces of Osteria Dei Rossi (docs/design/ui-foundation.md §6). Colours come only from
// the tokens; gold and yellow are accents here, never text on cream.

/** The wordmark link's classes: 44 px tall, the focus ring in the band's ink (N1). Shared with `ShellBrandLink`. */
export const BRAND_LINK_CLASS =
  "-my-1.5 inline-flex min-h-tap items-center gap-2.5 focus-visible:outline-band-ink";

/**
 * The header band's brand: the venue's logo or name as one link to Oggi (the role's home), at least 44 px
 * tall. The accessible name says where it goes, so a screen reader does not just read the venue's name.
 */
export function BrandLink({ venue }: { venue: Venue }) {
  return (
    <Link
      href="/"
      aria-label={t("brand.homeLink", { name: venue.name })}
      className={BRAND_LINK_CLASS}
    >
      <BrandWordmark venue={venue} />
    </Link>
  );
}

/**
 * The same brand with no link, for the guest booking page: "/" would send a signed-out guest to the staff sign-in and lose the
 * typed form. It keeps the link's height so the band does not change size.
 */
export function BrandTitle({ venue }: { venue: Venue }) {
  return (
    <span className="-my-1.5 inline-flex min-h-tap items-center gap-2.5">
      <BrandWordmark venue={venue} />
    </span>
  );
}

/**
 * The header band's brand on the staff sign-in surfaces (founder decision 2026-11-14): the Costì wordmark as a link to /login, never the
 * venue's name or Home ("/" would only bounce back). The accessible name is the visible text (WCAG 2.5.3), so no aria-label.
 */
export function ProductBrandLink() {
  return (
    <Link href="/login" className={BRAND_LINK_CLASS}>
      <span className="font-display text-[1.3125rem] leading-none font-semibold tracking-[0.1em] text-band-ink uppercase">
        {t("app.name")}
      </span>
    </Link>
  );
}

/**
 * The venue's brand in the band (docs/ux/costi-design-system.md §9): its logo at 28 px high with the name as `alt`, or, with no logo, the
 * name as text. Never both. The logo `src` is a same-origin path (`venueSchema`).
 */
export function BrandWordmark({ venue }: { venue: Venue }) {
  if (venue.logo) {
    // eslint-disable-next-line @next/next/no-img-element -- a small same-origin logo at a fixed height, nothing to optimise
    return <img src={venue.logo.src} alt={venue.name} className="block h-7 w-auto" />;
  }
  return (
    <span className="font-display text-[1.3125rem] leading-none font-semibold tracking-[0.1em] text-band-ink uppercase">
      {venue.name}
    </span>
  );
}
