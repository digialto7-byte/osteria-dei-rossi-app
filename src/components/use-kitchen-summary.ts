"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";
import { kitchenHomeCard, type KitchenCardState } from "@/lib/kitchen/kitchen-view";
import { reportError } from "@/lib/observability/report";
import type { KitchenTickets } from "@/server/kitchen/output";

export type KitchenSummaryState = KitchenCardState | { status: "idle" };

// A light check of the reply's shape; the server validated it with a strict schema before sending.
const isBoard = (value: unknown): value is KitchenTickets => {
  if (typeof value !== "object" || value === null) return false;
  const { tickets, remaining, truncated } = value as Record<string, unknown>;
  return Array.isArray(tickets) && typeof remaining === "number" && typeof truncated === "boolean";
};

/**
 * The chef's Home card counts, from GET /api/kitchen/tickets (the reply /cucina shows). Reads once when `enabled`, then once
 * each time the page comes back to the front. There is no timer and nothing is read while the page is hidden: the live
 * board is /cucina, with its own poll. A failure is a state (the card says it) and is reported with a code only.
 */
export function useKitchenSummary(enabled: boolean): KitchenSummaryState {
  const [result, setResult] = useState<KitchenCardState | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let latest = 0;
    const read = () => {
      const mine = ++latest;
      void apiJson<unknown>("/api/kitchen/tickets").then((reply) => {
        if (!alive || mine !== latest) return;
        if (reply.ok && isBoard(reply.data)) {
          setResult(kitchenHomeCard(reply.data));
          return;
        }
        reportError(new Error("home.kitchen_board"));
        setResult({ status: "error" });
      });
    };
    const onVisibility = () => {
      if (!document.hidden) read();
    };
    read();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  if (!enabled) return { status: "idle" };
  return result ?? { status: "loading" };
}
