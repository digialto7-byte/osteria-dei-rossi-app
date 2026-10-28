"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";
import type { TodaySummary } from "@/server/today/types";

export type TodayState =
  | { status: "idle"; data: null }
  | { status: "loading"; data: null }
  | { status: "ok"; data: TodaySummary }
  | { status: "error"; data: null };

// A light check of the reply's shape; the server validated it with a strict schema before sending.
const isSummary = (value: unknown): value is TodaySummary => {
  if (typeof value !== "object" || value === null) return false;
  const { cards, setup } = value as Record<string, unknown>;
  return Array.isArray(cards) && (setup === null || Array.isArray(setup));
};

/**
 * The counts of "Oggi" from GET /api/today. Reads once when `enabled` (the role is known and is not the waiter);
 * `retry` reads again after a failure. A failure is a state, not an exception: the page keeps its actions.
 */
export function useToday(enabled: boolean): TodayState & { retry: () => void } {
  const [result, setResult] = useState<TodaySummary | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void apiJson<unknown>("/api/today").then((reply) => {
      if (cancelled) return;
      setResult(reply.ok && isSummary(reply.data) ? reply.data : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt((n) => n + 1);
  }, []);

  if (!enabled) return { status: "idle", data: null, retry };
  if (result === null) return { status: "loading", data: null, retry };
  if (result === "error") return { status: "error", data: null, retry };
  return { status: "ok", data: result, retry };
}
