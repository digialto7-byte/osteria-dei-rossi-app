import type { MetadataRoute } from "next";
import { COSTI_ICONS } from "@/lib/brand/costi-assets";
import { PRODUCT_THEMES } from "@/lib/design/tokens";
import { t } from "@/lib/i18n";

// The web manifest (M20 plan §3.6.6), in the Costì product look (docs/plans/2026-11-13-costi-product-brand.md): the product name, Forest as
// the theme colour and Off-white as the splash background (both from PRODUCT_THEMES), and the four icons. The icon files are placeholders until
// the founder's logo files replace them; the paths in costi-assets.ts do not change.
const icon = (i: (typeof COSTI_ICONS)[keyof typeof COSTI_ICONS]) => ({
  src: i.url,
  sizes: `${i.size}x${i.size}`,
  type: "image/png",
  purpose: i.purpose,
});

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: t("app.name"),
    short_name: t("app.name"),
    lang: "it",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: PRODUCT_THEMES.light.band,
    background_color: PRODUCT_THEMES.light.paper,
    icons: [
      icon(COSTI_ICONS.icon192),
      icon(COSTI_ICONS.icon512),
      icon(COSTI_ICONS.maskable192),
      icon(COSTI_ICONS.maskable512),
    ],
  };
}
