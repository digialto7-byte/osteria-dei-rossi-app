import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PRODUCT_THEMES } from "@/lib/design/tokens";
import { t } from "@/lib/i18n";

// The console is a product surface (Costì look, ADR-042 and ADR-045): no venue layer. The root layout stays as it is; this layout replaces its
// tab title and its browser-chrome colour (the nested viewport replaces the root's) with the product's own.
export const metadata: Metadata = { title: t("console.tabTitle") };
export const viewport: Viewport = { themeColor: PRODUCT_THEMES.light.band };

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return children;
}
