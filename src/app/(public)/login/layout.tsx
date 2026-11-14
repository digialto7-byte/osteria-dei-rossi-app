import type { Viewport } from "next";
import type { ReactNode } from "react";
import { ProductScope } from "@/components/product-scope";
import { PRODUCT_THEMES } from "@/lib/design/tokens";

// A product surface (Costì plan §3.2): the sign-in and device pages get the Costì colours, fonts and logo. The header band above shows the
// Costì wordmark, not the venue's name (founder, 2026-11-14). The browser chrome continues the product's Forest here (one meta tag: the nested viewport replaces the root's).
export const viewport: Viewport = { themeColor: PRODUCT_THEMES.light.band };

export default function ProductLayout({ children }: { children: ReactNode }) {
  return <ProductScope>{children}</ProductScope>;
}
