"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorAlert, Heading, LedgerList, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { totalsLine } from "@/lib/payables/payable-view";
import type { PayableFilter, PayableListResult } from "@/server/payables/types";
import { PAYABLE_FILTERS } from "@/server/payables/types";
import { PayableRow } from "./payable-row";

const FORBIDDEN = 403;
// Text filters like /avvisi: the chosen one is bold and underlined, and aria-pressed says it too.
const FILTER_BASE =
  "inline-flex min-h-tap items-center text-accent-ink underline-offset-4 transition-colors";
const FILTER_ACTIVE = `${FILTER_BASE} font-bold underline decoration-2`;
const FILTER_IDLE = `${FILTER_BASE} hover:underline`;

/** The screen reads /api/payables only; the order, the days left and the totals come from the server. */
export default function PayablesPage() {
  const [filter, setFilter] = useState<PayableFilter>("unpaid");
  const [data, setData] = useState<PayableListResult | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(
    async (which: PayableFilter, cursor: string | null) => {
      const isNewest = startRequest();
      const query = new URLSearchParams({ filter: which });
      if (cursor) query.set("before", cursor);
      const result = await apiJson<PayableListResult>(`/api/payables?${query}`);
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
    // Loading the list when the page opens or the filter changes is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filter, null);
  }, [filter, load]);

  async function showMore() {
    if (!data?.nextCursor) return;
    setBusy(true);
    await load(filter, data.nextCursor);
    setBusy(false);
  }

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
            onClick={() => {
              setData(null);
              setFilter(which);
            }}
            className={filter === which ? FILTER_ACTIVE : FILTER_IDLE}
          >
            {t(`payables.filter.${which}`)}
          </button>
        ))}
      </div>
      <ErrorAlert message={error} />
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : (
        <>
          {data.totals && <p className="num font-bold">{totalsLine(data.totals)}</p>}
          {data.payables.length === 0 ? (
            <Muted>
              {t(filter === "unpaid" ? "payables.empty.unpaid" : "payables.empty.other")}
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
