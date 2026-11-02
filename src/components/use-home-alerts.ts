"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { HOME_ALERT_LIMIT } from "@/server/alerts/constants";
import type { AlertItem, AlertList } from "@/server/alerts/list";

export interface HomeAlertsState {
  status: "idle" | "loading" | "ok" | "error";
  alerts: AlertItem[];
  busyId: string | null;
  /** The strip's one notice: the read failed, or an acknowledgement did. */
  error: string | null;
  acknowledge: (id: string) => Promise<void>;
}

const isList = (value: unknown): value is AlertList =>
  typeof value === "object" && value !== null && Array.isArray((value as AlertList).alerts);

/**
 * The Home strip of the newest open alerts (M25b): `GET /api/alerts?filter=open&limit=3`, for the owner and the chef (`enabled`). "Ho visto"
 * posts the acknowledgement, reads the strip again and calls `onAcknowledged` so the page reads its counts again. A failure is a state, not an
 * exception: the rest of Home stays.
 */
export function useHomeAlerts(enabled: boolean, onAcknowledged: () => void): HomeAlertsState {
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      const isNewest = startRequest();
      const result = await apiJson<unknown>(`/api/alerts?filter=open&limit=${HOME_ALERT_LIMIT}`);
      if (isCancelled() || !isNewest()) return;
      if (result.ok && isList(result.data)) {
        setAlerts(result.data.alerts);
        setFailed(false);
      } else {
        setFailed(true);
      }
    },
    [startRequest],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // Loading the strip when Home opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [enabled, load]);

  const acknowledge = useCallback(
    async (id: string) => {
      setBusyId(id);
      const result = await apiJson(`/api/alerts/${id}/ack`, { method: "POST", body: {} });
      setBusyId(null);
      if (!result.ok) {
        setAckError(result.error.message);
        return;
      }
      setAckError(null);
      await load();
      onAcknowledged();
    },
    [load, onAcknowledged],
  );

  const status: HomeAlertsState["status"] = !enabled
    ? "idle"
    : alerts !== null
      ? "ok"
      : failed
        ? "error"
        : "loading";
  const error = ackError ?? (failed ? t("home.alerts.error") : null);
  return { status, alerts: alerts ?? [], busyId, error, acknowledge };
}
