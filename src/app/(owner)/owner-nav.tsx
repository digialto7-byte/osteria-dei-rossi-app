"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { isCurrent } from "@/lib/nav/is-current";

const LINKS = [
  { href: "/", label: t("nav.home") },
  { href: "/fatture", label: t("nav.invoices") },
  { href: "/anagrafiche/fornitori", label: t("nav.suppliers") },
  { href: "/anagrafiche/ingredienti", label: t("nav.ingredients") },
  { href: "/anagrafiche/ubicazioni", label: t("nav.locations") },
  { href: "/anagrafiche/importa", label: t("nav.import") },
];

/**
 * The owner's sections as a row of index tabs. At 360 px it wraps onto a second line rather than
 * hiding tabs off-screen; the current one (src/lib/nav/is-current.ts) is ink-filled with aria-current.
 */
export function OwnerNav() {
  const pathname = usePathname();
  return (
    <nav aria-label={t("nav.main")} className="-mt-2 flex flex-wrap gap-1.5">
      {LINKS.map((link) => {
        const current = isCurrent(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={
              "inline-flex min-h-tap items-center rounded-full border px-3.5 text-[0.9375rem] " +
              "transition-colors duration-150 " +
              (current
                ? "border-ink bg-ink font-bold text-paper"
                : "border-rule bg-surface text-ink hover:border-rule-strong hover:bg-sunk")
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
