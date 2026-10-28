"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";
import { canPurge, showBanner } from "@/lib/demo/demo-view";
import { t } from "@/lib/i18n";
import { linkClass } from "@/components/ui";

interface Me {
  user: { role: string };
  tenant: { isDemo: boolean };
}

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

/** Reads /api/me once. A failure shows nothing: the banner is a hint, never an error. */
export function DemoBanner() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    void apiJson<Me>("/api/me").then((result) => {
      if (result.ok) setMe(result.data);
    });
  }, []);
  if (!me) return null;
  return <DemoBannerView isDemo={me.tenant.isDemo} role={me.user.role} />;
}
