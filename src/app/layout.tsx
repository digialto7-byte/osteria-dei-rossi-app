import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { THEMES } from "@/lib/design/tokens";
import { t } from "@/lib/i18n";
import { nonceOrNull } from "@/lib/security/nonce";
import "./globals.css";

// The brand's founder-approved faces, self-hosted: the woff2 files (latin and latin-ext subsets, from the OFL-licensed Fontsource packages
// 5.3.0) and their licences are committed in ./fonts. next/font/local serves them from /_next/static/media, so the browser
// never contacts Google (GDPR) and the build needs no network (a failed Google fetch broke CI run 42513051864). Checked by
// tests/lib/design/fonts.test.ts and e2e/fonts.spec.ts. One Bodoni weight only, set large: its hairlines break up below
// ~20 px. No italics: the screens do not use them. The constant names become the family names (e2e/fonts.spec.ts matches
// them loosely, so keep "bodoniModa" and "figtree" in them).
const bodoniModa = localFont({
  src: [{ path: "./fonts/bodoni-moda-latin-600-normal.woff2", weight: "600", style: "normal" }],
  display: "swap",
  variable: "--font-display-face",
  adjustFontFallback: "Times New Roman",
});
const figtree = localFont({
  src: [
    { path: "./fonts/figtree-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/figtree-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-body",
  adjustFontFallback: "Arial",
});
// Latin-ext (names such as "Ștefan" or "Żubrówka"), as the Google-hosted fonts did before: a second face per family, limited to
// Google's latin-ext range and not preloaded, so it is downloaded only for a page that has such a letter. globals.css lists
// it first: its range keeps it out of plain latin text (tests/lib/design/fonts.test.ts). next/font needs literals here, so
// the range is written out in both calls.
const bodoniModaExt = localFont({
  src: [{ path: "./fonts/bodoni-moda-latin-ext-600-normal.woff2", weight: "600", style: "normal" }],
  display: "swap",
  variable: "--font-display-ext",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});
const figtreeExt = localFont({
  src: [
    { path: "./fonts/figtree-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/figtree-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-body-ext",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

export const metadata: Metadata = { title: t("app.name") };
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The browser chrome continues the green header band.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEMES.light.band },
    { media: "(prefers-color-scheme: dark)", color: THEMES.dark.band },
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
    <html
      lang="it"
      className={`${bodoniModa.variable} ${figtree.variable} ${bodoniModaExt.variable} ${figtreeExt.variable}`}
    >
      <body className="group/body min-h-dvh text-ink antialiased">{children}</body>
    </html>
  );
}
