import Link from "next/link";
import { linkClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { FacetLink } from "@/lib/nav/facet-links";

/**
 * The links from one ingredient or supplier to its other screens (UX plan P2-4). Which links there are is decided by
 * `ingredientFacets` / `supplierFacets`; this only draws them, and draws nothing when there are none.
 */
export function FacetLinks({ links }: { links: readonly FacetLink[] }) {
  if (links.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-x-4">
      {links.map((link) => (
        <Link key={link.facet} href={link.href} className={linkClass}>
          {t(link.labelKey)}
        </Link>
      ))}
    </p>
  );
}
