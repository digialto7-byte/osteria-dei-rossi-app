import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = { title: t("app.name") };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it">
      <body className="min-h-dvh bg-stone-50 text-stone-900 antialiased">
        <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
