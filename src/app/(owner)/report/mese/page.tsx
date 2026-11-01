"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BackLink } from "@/components/back-link";
import { Badge, Button, ErrorAlert, Heading, Muted, linkClass } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { emptyText, monthLabel } from "@/lib/reports/report-view";
import type { MonthlyPack } from "@/server/exports/pack-output";
import { PackSections } from "./pack-sections";

const FORBIDDEN = 403;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The monthly pack (M24 plan §3.5, ADR-027): one read of /api/exports/monthly-pack, four sections, printed on A4 by the browser. */
function PackScreen({ month }: { month: string | null }) {
  const [pack, setPack] = useState<MonthlyPack | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void apiJson<MonthlyPack>(`/api/exports/monthly-pack${month ? `?month=${month}` : ""}`).then(
      (result) => {
        if (!current) return;
        if (result.ok) setPack(result.data);
        else if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
      },
    );
    return () => {
      current = false;
    };
  }, [month]);

  const back = (
    <div data-print="hide" className="flex flex-col">
      <BackLink href="/report">{t("nav.reports")}</BackLink>
    </div>
  );

  if (forbidden || error !== null) {
    return (
      <>
        {back}
        <Heading>{t("pack.link")}</Heading>
        <ErrorAlert message={forbidden ? emptyText("reserved") : error} />
      </>
    );
  }
  if (pack === null) {
    return (
      <>
        {back}
        <Heading>{t("pack.link")}</Heading>
        <Muted>{t("pack.loading")}</Muted>
      </>
    );
  }
  return (
    <>
      {back}
      <Heading>{t("pack.title", { month: monthLabel(pack.month) })}</Heading>
      {pack.final ? null : <Badge tone="warning">{t("pack.provisional")}</Badge>}
      <div data-print="hide" className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href={`/report/mese?mese=${pack.previousMonth}`} className={linkClass}>
          <span aria-hidden="true">‹</span> {monthLabel(pack.previousMonth)}
        </Link>
        {pack.nextMonth ? (
          <Link href={`/report/mese?mese=${pack.nextMonth}`} className={linkClass}>
            {monthLabel(pack.nextMonth)} <span aria-hidden="true">›</span>
          </Link>
        ) : null}
        <Button variant="secondary" onClick={() => window.print()}>
          {t("pack.print")}
        </Button>
      </div>
      <PackSections pack={pack} />
    </>
  );
}

function PackRoute() {
  const search = useSearchParams();
  const asked = search.get("mese");
  const month = asked !== null && MONTH.test(asked) ? asked : null;
  // A new month is a new screen: the key resets the loaded pack and the error.
  return <PackScreen key={month ?? "default"} month={month} />;
}

export default function MonthlyPackPage() {
  return (
    <Suspense fallback={<Muted>{t("common.loading")}</Muted>}>
      <PackRoute />
    </Suspense>
  );
}
