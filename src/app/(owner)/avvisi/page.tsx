"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorAlert, Heading, LedgerList, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import type { AlertItem, AlertList } from "@/server/alerts/list";
import { AlertRow } from "./alert-row";
import { TestAlertCard, type TestAlertResult } from "./test-alert-card";

type Filter = "open" | "all";
const FORBIDDEN = 403;
// The filter reads as two text links; the chosen one is bold and underlined (aria-pressed says it too).
const FILTER_BASE =
  "inline-flex min-h-tap items-center text-accent-ink underline-offset-4 transition-colors";
const FILTER_ACTIVE = `${FILTER_BASE} font-bold underline decoration-2`;
const FILTER_IDLE = `${FILTER_BASE} hover:underline`;

/** The screen reads /api/alerts only; every word and the order come from the server. */
export default function AlertsPage() {
  const [filter, setFilter] = useState<Filter>("open");
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [canRaiseTest, setCanRaiseTest] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<TestAlertResult>(null);

  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(
    async (which: Filter, cursor: string | null) => {
      const isNewest = startRequest();
      const query = new URLSearchParams({ filter: which });
      if (cursor) query.set("before", cursor);
      const result = await apiJson<AlertList>(`/api/alerts?${query}`);
      // A slow answer for a filter the user has left must not replace the newer one.
      if (!isNewest()) return;
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setError(null);
      setAlerts((previous) =>
        cursor && previous ? [...previous, ...result.data.alerts] : result.data.alerts,
      );
      setNextCursor(result.data.nextCursor);
      setCanRaiseTest(result.data.canRaiseTest);
    },
    [startRequest],
  );

  useEffect(() => {
    // Loading the list when the page opens or the filter changes is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filter, null);
  }, [filter, load]);

  async function acknowledge(id: string) {
    setBusyId(id);
    const result = await apiJson<{ alert: AlertItem }>(`/api/alerts/${id}/ack`, {
      method: "POST",
      body: {},
    });
    setBusyId(null);
    if (!result.ok) return setError(result.error.message);
    setError(null);
    const updated = result.data.alert;
    setAlerts((previous) =>
      (previous ?? []).flatMap((alert) =>
        alert.id !== id ? [alert] : filter === "open" ? [] : [updated],
      ),
    );
  }

  async function sendTest(includeKitchen: boolean) {
    setTestBusy(true);
    setTestResult(null);
    const result = await apiJson<{ deduplicated: boolean }>("/api/alerts/test", {
      method: "POST",
      body: { includeKitchen },
    });
    setTestBusy(false);
    if (!result.ok) return setError(result.error.message);
    setTestResult(result.data.deduplicated ? "deduplicated" : "created");
    await load(filter, null);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("alerts.title")}</Heading>
        <ErrorAlert message={t("alerts.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("alerts.title")}</Heading>
      <div role="group" aria-label={t("alerts.filter.label")} className="flex flex-wrap gap-x-5">
        {(["open", "all"] as const).map((which) => (
          <button
            key={which}
            type="button"
            aria-pressed={filter === which}
            onClick={() => setFilter(which)}
            className={filter === which ? FILTER_ACTIVE : FILTER_IDLE}
          >
            {t(`alerts.filter.${which}`)}
          </button>
        ))}
      </div>
      <ErrorAlert message={error} />
      {alerts === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : alerts.length === 0 ? (
        <Muted>{t(filter === "open" ? "alerts.empty.open" : "alerts.empty.all")}</Muted>
      ) : (
        <LedgerList>
          {alerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              busy={busyId === alert.id}
              onAcknowledge={acknowledge}
            />
          ))}
        </LedgerList>
      )}
      {nextCursor && (
        <div>
          <Button variant="secondary" onClick={() => void load(filter, nextCursor)}>
            {t("alerts.more")}
          </Button>
        </div>
      )}
      {canRaiseTest && <TestAlertCard busy={testBusy} result={testResult} onSend={sendTest} />}
    </>
  );
}
