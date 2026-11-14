"use client";

import { usePathname } from "next/navigation";
import { BrandTitle, ProductBrandLink } from "@/components/brand";
import { isGuestPath } from "@/lib/nav/public-paths";

/** The band's brand on the public pages: the venue's name as plain text for a guest, the Costì wordmark linking to /login on the staff sign-in pages. */
export function PublicBrand() {
  return isGuestPath(usePathname()) ? <BrandTitle /> : <ProductBrandLink />;
}
