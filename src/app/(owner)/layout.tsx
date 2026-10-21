import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

const LINKS = [
  { href: "/anagrafiche/fornitori", label: t("nav.suppliers") },
  { href: "/anagrafiche/ingredienti", label: t("nav.ingredients") },
  { href: "/anagrafiche/ubicazioni", label: t("nav.locations") },
  { href: "/anagrafiche/importa", label: t("nav.import") },
];

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav aria-label={t("nav.masterData")} className="flex flex-wrap gap-2">
        <Link href="/" className="inline-flex min-h-tap items-center underline">
          {t("nav.home")}
        </Link>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex min-h-tap items-center px-2 underline"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
