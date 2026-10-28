"use client";

import Link from "next/link";
import { useMe } from "@/components/use-me";
import { canPurge, showBanner } from "@/lib/demo/demo-view";
import { t } from "@/lib/i18n";
import { linkClass } from "@/components/ui";

/** The notice for a demo tenant. The owner also gets the link to the page that deletes the demo data. */
export function DemoBannerView({ isDemo, role }: { isDemo: boolean; role: string }) {
  if (!showBanner(isDemo)) return null;
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-4 rounded-lg border-l-4 border-warning bg-warning-bg px-4 py-2 text-warning"
    >
      <span className="py-2">{t("demo.banner")}</span>
      {canPurge(role, isDemo) && (
        <Link href="/impostazioni/dati-di-prova" className={linkClass}>
          {t("demo.banner.link")}
        </Link>
      )}
    </div>
  );
}

/** The notice from the one cached /api/me read. A failure shows nothing: the banner is a hint, never an error. */
export function DemoBanner() {
  const { me } = useMe();
  if (!me) return null;
  return <DemoBannerView isDemo={me.tenant.isDemo === true} role={me.user.role} />;
}
