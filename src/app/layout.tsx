import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { COSTI_ICONS, COSTI_SVG } from "@/lib/brand/costi-assets";
import { requireVenueBand, VENUE_LAYER_DEFAULT } from "@/lib/design/venue-layer";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE } from "@/lib/i18n/locale";
import { nonceOrNull } from "@/lib/security/nonce";
import "./globals.css";

// The Costì faces (docs/ux/costi-design-system.md §3), self-hosted: Montserrat 600 for headings and Inter 400 and 700 for everything else. The
// full upstream woff2 files and their OFL licences are committed in ./fonts (see its README), so there is no latin/latin-ext split.
// next/font/local serves them from /_next/static/media, so the browser never contacts Google (GDPR) and the build needs no network (a
// failed Google fetch broke CI run 42513051864). They are preloaded on every page and set on the two variables the font stacks in
// globals.css start with. Checked by tests/lib/design/fonts.test.ts and e2e/fonts.spec.ts. No italics: the screens do not use them. The
// constant names become the family names (e2e/fonts.spec.ts matches "montserrat" and "inter" loosely, so keep them).
const montserrat = localFont({
  src: [{ path: "./fonts/montserrat-600-normal.woff2", weight: "600", style: "normal" }],
  display: "swap",
  variable: "--font-display-face",
  adjustFontFallback: "Arial",
});
const inter = localFont({
  src: [
    { path: "./fonts/inter-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-body",
  adjustFontFallback: "Arial",
});

// The tab title and icons are the product's on every page (Costì plan §3.1). The icons are files in public/, named in costi-assets.ts.
export const metadata: Metadata = {
  title: t("app.name"),
  icons: {
    icon: [
      { url: COSTI_SVG.favicon, type: "image/svg+xml" },
      { url: COSTI_ICONS.favicon32.url, sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: COSTI_ICONS.appleTouch.url, sizes: "180x180", type: "image/png" }],
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The browser chrome continues the venue's header band, the same colour in both schemes (ADR-045).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: requireVenueBand(VENUE_LAYER_DEFAULT).band },
    { media: "(prefers-color-scheme: dark)", color: requireVenueBand(VENUE_LAYER_DEFAULT).band },
  ],
};

// Reading the request headers makes every page render per request, which the nonce CSP needs (ADR-028): Next.js stamps
// the proxy's nonce on its scripts at render time. The proxy skips static assets and images, so a missing /foo.png renders
// not-found here with no x-nonce: that must be a clean 404, not a 500. It then renders without a nonce, and the static
// policy from next.config.ts (no 'unsafe-inline') blocks Next's inline scripts, so the page fails closed. A malformed
// x-nonce still throws. The value is not put in our markup.
export default async function RootLayout({ children }: { children: ReactNode }) {
  nonceOrNull(await headers());
  return (
    <html lang={DEFAULT_LOCALE} className={`${montserrat.variable} ${inter.variable}`}>
      <body className="group/body min-h-dvh text-ink antialiased">{children}</body>
    </html>
  );
}
