"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorAlert, Heading, LedgerList, linkClass, Muted } from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { useMe } from "@/components/use-me";
import { emptyFor } from "@/lib/empty/empty-content";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import type { PlatesResponse } from "@/server/costing/plates";
import { AtDateField, useAtDate } from "./at-date-field";
import { FixedCostCard } from "./fixed-cost-card";
import { PlateRow } from "./plate-row";

const FORBIDDEN = 403;

/** The owner's and admin's cost list. Reads /api/costs/plates only; the fixed-cost card is the owner's. */
export default function CostsPage() {
  const role = useMe().me?.user.role ?? null;
  const date = useAtDate();
  const [data, setData] = useState<PlatesResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startRequest] = useState(latestOnly);

  useEffect(() => {
    if (!date.ready) return;
    const isNewest = startRequest();
    void (async () => {
      const result = await apiJson<PlatesResponse>(`/api/costs/plates${date.query}`);
      if (!isNewest()) return;
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setError(null);
      setData(result.data);
    })();
  }, [date.ready, date.query, startRequest]);

  if (forbidden) {
    return (
      <>
        <Heading>{t("costs.title")}</Heading>
        <ErrorAlert message={t("costError.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("costs.title")}</Heading>
      <nav className="flex flex-col">
        <Link href="/costi/ingredienti" className={linkClass}>
          {t("costs.links.ingredients")}
        </Link>
        <Link href="/costi/impostazioni" className={linkClass}>
          {t("costs.links.settings")}
        </Link>
        <Link href="/costi/verifica" className={linkClass}>
          {t("costs.links.check")}
        </Link>
      </nav>
      <AtDateField value={date.at || date.today} max={date.today} onChange={date.change} />
      <ErrorAlert message={error} />
      {data?.fixedCost && <FixedCostCard status={data.fixedCost} />}
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : data.plates.length === 0 ? (
        <EmptyState {...emptyFor("costs", role)} />
      ) : (
        <LedgerList>
          {data.plates.map((plate) => (
            <PlateRow key={plate.recipeKey} plate={plate} />
          ))}
        </LedgerList>
      )}
    </>
  );
}
