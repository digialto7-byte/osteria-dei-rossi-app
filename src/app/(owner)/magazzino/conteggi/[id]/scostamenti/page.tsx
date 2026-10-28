"use client";

import { BackLink } from "@/components/back-link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorAlert, Heading, LedgerList, Muted } from "@/components/ui";
import { TextFilter } from "@/components/text-filter";
import { apiJson } from "@/lib/api/client";
import { canReadCountCosts } from "@/lib/counts/count-view";
import { t } from "@/lib/i18n";
import type { Variance, VarianceCosts } from "@/server/counts/types";
import { VarianceRow, VarianceTotals } from "./variance-row";

const FORBIDDEN = 403;
type Show = "differences" | "all";

/**
 * The variance of a closed count: expected vs counted per line in units, and for owner and admin the value in EUR
 * (a second request to /api/reports/variance-costs, which the chef never makes). Every figure is the server's.
 */
export default function VariancePage() {
  const { id } = useParams<{ id: string }>();
  const [variance, setVariance] = useState<Variance | null>(null);
  const [costs, setCosts] = useState<VarianceCosts | null>(null);
  const [show, setShow] = useState<Show>("differences");
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await apiJson<Variance>(`/api/reports/variance?session=${id}`);
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setVariance(result.data);
      const me = await apiJson<{ user: { role: string } }>("/api/me");
      if (me.ok && canReadCountCosts(me.data.user.role)) {
        const money = await apiJson<VarianceCosts>(`/api/reports/variance-costs?session=${id}`);
        if (money.ok) setCosts(money.data);
      }
    })();
  }, [id]);

  if (forbidden) {
    return (
      <>
        <Heading>{t("variance.title")}</Heading>
        <ErrorAlert message={t("count.forbidden")} />
      </>
    );
  }

  const valueOf = (ingredientId: string) =>
    costs === null
      ? undefined
      : (costs.lines.find((l) => l.ingredientId === ingredientId)?.valueEur ?? null);
  const lines =
    variance === null
      ? []
      : variance.lines.filter((line) => show === "all" || line.differenceQty !== 0);

  return (
    <>
      <BackLink href="/magazzino/conteggi">{t("count.back")}</BackLink>
      <Heading>{t("variance.title")}</Heading>
      <TextFilter
        label={t("variance.filters")}
        value={show}
        onChange={setShow}
        options={[
          { value: "differences", label: t("variance.onlyDifferences") },
          { value: "all", label: t("variance.all") },
        ]}
      />
      <ErrorAlert message={error} />
      {variance === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : (
        <>
          {costs && <VarianceTotals totals={costs} skipped={variance.linesSkipped} />}
          {!costs && (
            <p className="num text-ink-muted">
              {t("variance.skipped", { count: variance.linesSkipped })}
            </p>
          )}
          {lines.length === 0 ? (
            <Muted>{t("variance.empty")}</Muted>
          ) : (
            <LedgerList>
              {lines.map((line) => (
                <VarianceRow
                  key={line.ingredientId}
                  line={line}
                  valueEur={valueOf(line.ingredientId)}
                />
              ))}
            </LedgerList>
          )}
        </>
      )}
    </>
  );
}
