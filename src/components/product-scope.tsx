import type { ReactNode } from "react";
import { COSTI_SVG } from "@/lib/brand/costi-assets";

// The Costì product look (docs/plans/2026-11-13-costi-product-brand.md §3.2, §3.5). `data-brand="costi"` re-values the colour and font tokens
// for the whole page (globals.css, `:root:has([data-brand="costi"])`), so the header band above it follows too. Only the sign-in and device
// layouts render it. A server component: no client code, so the server states the attribute and nothing flashes.

/**
 * The Costì logo: the dark-background file when the device is dark, the light one otherwise. The size comes from the height only
 * (no width or height attribute), so a replaced file with another aspect ratio needs no code change.
 */
export function ProductLogo() {
  return (
    <picture>
      <source
        media="screen and (prefers-color-scheme: dark)"
        srcSet={COSTI_SVG.logoHorizontalReversed}
      />
      <img src={COSTI_SVG.logoHorizontal} alt="Costì" className="mb-5 block h-7 w-auto" />
    </picture>
  );
}

export function ProductScope({ children }: { children: ReactNode }) {
  return (
    <div data-brand="costi" className="contents">
      <ProductLogo />
      {children}
    </div>
  );
}
