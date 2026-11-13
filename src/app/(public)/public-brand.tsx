"use client";

import { usePathname } from "next/navigation";
import { BrandLink, BrandTitle } from "@/components/brand";
import { isGuestPath } from "@/lib/nav/public-paths";

/** The band's brand on the public pages: plain text for a guest, the link to Home for the staff sign-in pages. */
export function PublicBrand() {
  return isGuestPath(usePathname()) ? <BrandTitle /> : <BrandLink />;
}
