"use client";

import { usePathname } from "next/navigation";
import { BrandTitle, ProductBrandLink } from "@/components/brand";
import { HeaderBand } from "@/components/header-band";
import { VENUE_LAYER_DEFAULT } from "@/lib/design/venue-layer";
import { isGuestPath } from "@/lib/nav/public-paths";

/**
 * The header band on the public pages. A guest (`/prenota/*`) sees the venue layer (its accent on the band, ADR-045) and the venue's name as
 * plain text; the staff sign-in pages keep the Costì Forest band, with the Costì wordmark linking to /login and no venue layer.
 */
export function PublicBand() {
  return isGuestPath(usePathname()) ? (
    <HeaderBand venue={VENUE_LAYER_DEFAULT} brand={<BrandTitle venue={VENUE_LAYER_DEFAULT} />} />
  ) : (
    <HeaderBand brand={<ProductBrandLink />} />
  );
}
