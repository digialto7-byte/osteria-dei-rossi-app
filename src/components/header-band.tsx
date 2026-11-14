import type { CSSProperties, ReactNode } from "react";
import { requireVenueBand, type Venue } from "@/lib/design/venue-layer";

/**
 * The green header band, one per page. It used to sit in the root layout; the `(public)` layout, the signed-in shell and the 404 page
 * now each render it with their own `brand` (a link to Home or, for a guest, plain text). `account` is the signed-in
 * user's own control (QW6); the band wraps, so on a narrow phone it may take a second row.
 *
 * `venue` puts the venue layer on the band (ADR-045): its accent sets `--color-band` and the derived `--color-band-ink`, as the only two
 * custom properties and only here. An accent the layer refuses throws; there is no fallback colour. Without `venue` (the product's pages)
 * the band keeps the page's tokens.
 */
export function HeaderBand({
  brand,
  account,
  venue,
}: {
  brand: ReactNode;
  account?: ReactNode;
  venue?: Venue;
}) {
  const layer = venue ? requireVenueBand(venue) : null;
  return (
    <header
      className="band border-b-2 border-gold"
      style={
        layer
          ? ({ "--color-band": layer.band, "--color-band-ink": layer.bandInk } as CSSProperties)
          : undefined
      }
    >
      <div className="mx-auto flex max-w-md flex-wrap items-center gap-x-2.5 gap-y-1 px-4 lg:group-has-[[data-layout=wide]]/body:max-w-6xl pt-[max(0.875rem,env(safe-area-inset-top))] pb-3.5">
        {brand}
        {account}
      </div>
    </header>
  );
}
