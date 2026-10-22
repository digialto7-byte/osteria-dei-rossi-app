import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Figtree } from "next/font/google";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand";
import { THEMES } from "@/lib/design/tokens";
import { t } from "@/lib/i18n";
import "./globals.css";

// The brand's own faces (its menu site uses them). next/font downloads them at build time and
// serves them from /_next/static/media: the browser never contacts Google (GDPR; checked by
// tests/lib/design/fonts.test.ts and e2e/fonts.spec.ts). One Bodoni weight only, set large:
// its hairlines break up below ~20 px. No italics: the screens do not use them.
const display = Bodoni_Moda({
  weight: "600",
  style: "normal",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display-face",
});
const body = Figtree({
  weight: ["400", "700"],
  style: "normal",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh text-ink antialiased">
        <header className="band border-b-2 border-gold">
          <div className="mx-auto flex max-w-md items-center gap-2.5 px-4 pt-[max(0.875rem,env(safe-area-inset-top))] pb-3.5">
            <BrandMark />
            <p className="font-display text-[1.3125rem] leading-none font-semibold tracking-[0.1em] text-band-ink uppercase">
              {t("app.name")}
            </p>
          </div>
        </header>
        <main className="reveal mx-auto flex max-w-md flex-col gap-6 px-4 pt-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
          {children}
        </main>
      </body>
    </html>
  );
}
