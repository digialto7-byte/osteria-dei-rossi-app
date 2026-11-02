"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ListFilters, type SupplierChoice } from "@/components/list-filters";
import { Button, ErrorAlert, Heading, LedgerList, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import {
  hasActiveFilters,
  rangeInvalid,
  readListFilters,
  readPayableStato,
  toApiQuery,
  toPageHref,
  type ListFilters as Filters,
} from "@/lib/filters/list-filters";
import { t } from "@/lib/i18n";
import { filteredTotalsLine, rangeHintKey, totalsLine } from "@/lib/payables/payable-view";
import type { PayableFilter, PayableListResult } from "@/server/payables/types";
import { PAYABLE_FILTERS } from "@/server/payables/types";
import { PayableRow } from "./payable-row";

const FORBIDDEN = 403;
// Text filters like /avvisi: the chosen one is bold and underlined, and aria-pressed says it too.
const FILTER_BASE =
  "inline-flex min-h-tap items-center text-accent-ink underline-offset-4 transition-colors";
const FILTER_ACTIVE = `${FILTER_BASE} font-bold underline decoration-2`;
const FILTER_IDLE = `${FILTER_BASE} hover:underline`;

const PATH = "/pagamenti";
/** The address word for each choice; "Da pagare" is the default and leaves the address bare. */
const STATO_WORD: Record<PayableFilter, string | null> = {
  unpaid: null,
  paid: "pagate",
  all: "tutte",
};

// useSearchParams needs a Suspense boundary above it.
export default function PayablesPage() {
  return (
    <Suspense fallback={<Heading>{t("payables.title")}</Heading>}>
      <PayablesList />
    </Suspense>
  );
}

/**
 * The screen reads /api/payables only; the order, the days left and the totals come from the server. The choice (Da pagare, Pagate, Tutte)
 * and the filters (Dal, Al, Fornitore) live in the address (M25b), so a refresh or a shared link keeps them.
 */
function PayablesList() {
  const router = useRouter();
  const search = useSearchParams();
  const filter = readPayableStato(search);
  const filters = readListFilters(search);
  const active = hasActiveFilters(filters);
  const invalid = rangeInvalid(filters);
  const apiQuery = toApiQuery(filters);
  const [suppliers, setSuppliers] = useState<SupplierChoice[]>([]);
  const [data, setData] = useState<PayableListResult | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(
    async (which: PayableFilter, query: string, cursor: string | null) => {
      const isNewest = startRequest();
      const parts = [
        `filter=${which}`,
        query,
        cursor ? `before=${encodeURIComponent(cursor)}` : "",
      ];
      const result = await apiJson<PayableListResult>(
        `/api/payables?${parts.filter(Boolean).join("&")}`,
      );
      // A slow answer for a filter the user has left must not replace the newer one.
      if (!isNewest()) return;
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setError(null);
      setData((previous) =>
        cursor && previous
          ? { ...result.data, payables: [...previous.payables, ...result.data.payables] }
          : result.data,
      );
    },
    [startRequest],
  );

  useEffect(() => {
    // Loading the list when the page opens or the address changes is the effect's job here.
    if (invalid) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    void load(filter, apiQuery, null);
  }, [filter, apiQuery, invalid, load]);

  useEffect(() => {
    void apiJson<{ suppliers: SupplierChoice[] }>("/api/suppliers").then((result) => {
      if (result.ok) setSuppliers(result.data.suppliers);
    });
  }, []);

  async function showMore() {
    if (!data?.nextCursor) return;
    setBusy(true);
    await load(filter, apiQuery, data.nextCursor);
    setBusy(false);
  }

  const choose = (which: PayableFilter) =>
    router.replace(toPageHref(PATH, filters, { stato: STATO_WORD[which] }));
  const change = (next: Required<Filters>) =>
    router.replace(toPageHref(PATH, next, { stato: STATO_WORD[filter] }));

  if (forbidden) {
    return (
      <>
        <Heading>{t("payables.title")}</Heading>
        <ErrorAlert message={t("payables.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("payables.title")}</Heading>
      <div role="group" aria-label={t("payables.filters")} className="flex flex-wrap gap-x-5">
        {PAYABLE_FILTERS.map((which) => (
          <button
            key={which}
            type="button"
            aria-pressed={filter === which}
            onClick={() => choose(which)}
            className={filter === which ? FILTER_ACTIVE : FILTER_IDLE}
          >
            {t(`payables.filter.${which}`)}
          </button>
        ))}
      </div>
      <ListFilters
        filters={filters}
        suppliers={suppliers}
        onChange={change}
        onReset={() => router.replace(PATH)}
        hint={t(rangeHintKey(filter))}
      />
      <ErrorAlert message={invalid ? t("filters.rangeInvalid") : error} />
      {invalid ? null : data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : (
        <>
          {data.totals && (
            <p className="num font-bold">
              {active ? filteredTotalsLine(data.totals) : totalsLine(data.totals)}
            </p>
          )}
          {data.payables.length === 0 ? (
            <Muted>
              {t(
                active
                  ? "payables.empty.filtered"
                  : filter === "unpaid"
                    ? "payables.empty.unpaid"
                    : "payables.empty.other",
              )}
            </Muted>
          ) : (
            <LedgerList>
              {data.payables.map((item) => (
                <PayableRow key={item.id} item={item} />
              ))}
            </LedgerList>
          )}
          {data.nextCursor && (
            <div>
              <Button variant="secondary" disabled={busy} onClick={showMore}>
                {t("payables.more")}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
