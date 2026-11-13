"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";

export type PendingRequestsState =
  | { status: "idle"; pending: null }
  | { status: "loading"; pending: null }
  | { status: "ok"; pending: number }
  | { status: "error"; pending: null };

const isCount = (value: unknown): value is { pending: number } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { pending?: unknown }).pending === "number";

/**
 * The number of booking requests waiting for an answer (QW3), from the existing `GET /api/reservations/pending-count`: one read when
 * `enabled` (owner and admin; the endpoint answers nobody else). A count only, never a name. A failure is a state, not an exception:
 * the Home row stays, without a badge.
 */
export function usePendingRequests(enabled: boolean): PendingRequestsState {
  const [result, setResult] = useState<number | "error" | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void apiJson<unknown>("/api/reservations/pending-count").then((reply) => {
      if (cancelled) return;
      setResult(reply.ok && isCount(reply.data) ? reply.data.pending : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return { status: "idle", pending: null };
  if (result === null) return { status: "loading", pending: null };
  if (result === "error") return { status: "error", pending: null };
  return { status: "ok", pending: result };
}
