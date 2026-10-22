import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { THEMES } from "@/lib/design/tokens";
import { t } from "@/lib/i18n";
import "./globals.css";

// next/font downloads these at build time and serves them from /_next/static/media: the browser
// never contacts Google (GDPR; checked by tests/lib/design/fonts.test.ts and e2e/fonts.spec.ts).
const display = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display-face",
});
const body = Atkinson_Hyperlegible({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

export const metadata: Metadata = { title: t("app.name") };
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEMES.light.paper },
    { media: "(prefers-color-scheme: dark)", color: THEMES.dark.paper },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh text-ink antialiased">
        <header className="mx-auto max-w-md px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-end justify-between border-b-[3px] border-double border-rule pb-2">
            <p className="font-display text-[1.375rem] leading-none tracking-[-0.01em] text-ink">
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
