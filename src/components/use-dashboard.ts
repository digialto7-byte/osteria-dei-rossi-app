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
 * is focused or the page becomes visible again, at most once per DASHBOARD_REFRESH_MS; a refresh never runs while the page is hidden.
 * A failed first read is an `error` state (the page keeps its static actions); a failed refresh keeps the numbers on
 * screen. The reply is validated with the same strict schema the server used.
 */
export function useDashboard(enabled: boolean): DashboardState & { retry: () => void } {
  const [data, setData] = useState<DashboardOutput | null>(null);
  const [failed, setFailed] = useState(false);
  const lastAt = useRef(0);
  const pending = useRef<ReturnType<typeof apiJson<unknown>> | null>(null);

  // One request at a time, shared: an effect that is cleaned up and run again (StrictMode, or `enabled` toggling) joins
  // the read already in flight instead of skipping it, and each effect applies the reply unless ITS OWN run was cancelled.
  const read = useCallback(() => {
    if (pending.current === null) {
      lastAt.current = Date.now();
      const request = apiJson<unknown>("/api/dashboard");
      pending.current = request;
      const release = () => {
        if (pending.current === request) pending.current = null;
      };
      request.then(release, release);
    }
    return pending.current;
  }, []);

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      let parsed: ReturnType<typeof dashboardOutput.safeParse> | null = null;
      try {
        const reply = await read();
        parsed = reply.ok ? dashboardOutput.safeParse(reply.data) : null;
      } catch {
        parsed = null;
      }
      if (isCancelled()) return;
      if (parsed?.success) {
        setData(parsed.data);
        setFailed(false);
      } else {
        // A background refresh that fails leaves the last good numbers in place.
        setFailed(true);
      }
    },
    [read],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    void load(isCancelled);
    const refresh = () => {
      if (document.hidden) return;
      if (Date.now() - lastAt.current < DASHBOARD_REFRESH_MS) return;
      void load(isCancelled);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, load]);

  const retry = useCallback(() => {
    setFailed(false);
    void load(() => false);
  }, [load]);

  if (!enabled) return { status: "idle", data: null, retry };
  if (data !== null) return { status: "ok", data, retry };
  if (failed) return { status: "error", data: null, retry };
  return { status: "loading", data: null, retry };
}
