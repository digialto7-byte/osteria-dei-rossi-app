import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { BrandLink } from "@/components/brand";
import { THEMES } from "@/lib/design/tokens";
import { t } from "@/lib/i18n";
import { nonceOrNull } from "@/lib/security/nonce";
import "./globals.css";

// The brand's founder-approved faces, self-hosted: the woff2 files (latin subset, from the OFL-licensed Fontsource packages
// 5.3.0) and their licences are committed in ./fonts. next/font/local serves them from /_next/static/media, so the browser
// never contacts Google (GDPR) and the build needs no network (a failed Google fetch broke CI run 42513051864). Checked by
// tests/lib/design/fonts.test.ts and e2e/fonts.spec.ts. One Bodoni weight only, set large: its hairlines break up below
// ~20 px. No italics: the screens do not use them. The constant names become the family names (e2e matches them loosely).
const bodoniModa = localFont({
  src: [{ path: "./fonts/bodoni-moda-latin-600-normal.woff2", weight: "600", style: "normal" }],
  display: "swap",
  variable: "--font-display-face",
  adjustFontFallback: "Times New Roman",
  fallback: ["Didot", "Georgia", "serif"],
});
const figtree = localFont({
  src: [
    { path: "./fonts/figtree-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/figtree-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-body",
  adjustFontFallback: "Arial",
  fallback: ["ui-sans-serif", "sans-serif"],
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
    <html lang="it" className={`${bodoniModa.variable} ${figtree.variable}`}>
      <body className="group/body min-h-dvh text-ink antialiased">
        <header className="band border-b-2 border-gold">
          <div className="mx-auto flex max-w-md items-center gap-2.5 px-4 lg:group-has-[[data-layout=wide]]/body:max-w-6xl pt-[max(0.875rem,env(safe-area-inset-top))] pb-3.5">
            <BrandLink />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
