import { COSTI_SVG } from "@/lib/brand/costi-assets";

/**
 * The Costì logo on the product pages: the dark-background file when the device is dark, the light one otherwise. The size comes from the
 * height only (no width or height attribute), so a replaced file with another aspect ratio needs no code change.
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
