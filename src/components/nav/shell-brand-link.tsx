"use client";

import { BRAND_LINK_CLASS, BrandWordmark } from "@/components/brand";
import { GuardedLink } from "@/components/nav/leave-guard";
import { t } from "@/lib/i18n";

/**
 * The header band's wordmark on signed-in pages (QW12): the same link to Home as `BrandLink`, but a plain click asks the page's leave
 * guard first (the comanda, with dishes not sent). A ctrl- or meta-click is never intercepted. Public pages keep `BrandLink`.
 */
export function ShellBrandLink() {
  return (
    <GuardedLink href="/" aria-label={t("brand.homeLink")} className={BRAND_LINK_CLASS}>
      <BrandWordmark />
    </GuardedLink>
  );
}
