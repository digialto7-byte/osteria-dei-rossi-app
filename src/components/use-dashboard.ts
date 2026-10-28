"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "@/lib/api/client";
import { dashboardOutput, type DashboardOutput } from "@/server/dashboard/output";
import { DASHBOARD_REFRESH_MS } from "@/server/dashboard/constants";

export type DashboardState =
  | { status: "idle"; data: null }
  | { status: "loading"; data: null }
  | { status: "ok"; data: DashboardOutput }
  | { status: "error"; data: null };

/**
 * The owner's and admin's Oggi from GET /api/dashboard (one request). It reads when `enabled`, again when the window
 * is focused or the page becomes visible again, at most once per DASHBOARD_REFRESH_MS, and never while the page is hidden.
 * A failed first read is an `error` state (the page keeps its static actions); a failed refresh keeps the numbers on
 * screen. The reply is validated with the same strict schema the server used.
 */
export function useDashboard(enabled: boolean): DashboardState & { retry: () => void } {
  const [data, setData] = useState<DashboardOutput | null>(null);
  const [failed, setFailed] = useState(false);
  const lastAt = useRef(0);
  const inFlight = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const mine = generation.current;
    lastAt.current = Date.now();
    try {
      const reply = await apiJson<unknown>("/api/dashboard");
      if (mine !== generation.current) return;
      const parsed = reply.ok ? dashboardOutput.safeParse(reply.data) : null;
      if (parsed?.success) {
        setData(parsed.data);
        setFailed(false);
      } else {
        // A background refresh that fails leaves the last good numbers in place.
        setFailed(true);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    generation.current += 1;
    void load();
    const refresh = () => {
      if (document.hidden) return;
      if (Date.now() - lastAt.current < DASHBOARD_REFRESH_MS) return;
      void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      generation.current += 1;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, load]);

  const retry = useCallback(() => {
    setFailed(false);
    void load();
  }, [load]);

  if (!enabled) return { status: "idle", data: null, retry };
  if (data !== null) return { status: "ok", data, retry };
  if (failed) return { status: "error", data: null, retry };
  return { status: "loading", data: null, retry };
}
