"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";
import type { PasswordStatus } from "@/server/auth/schemas";

// A light check of the reply's shape; the server validated it with a strict schema before sending.
const isStatus = (value: unknown): value is PasswordStatus =>
  typeof value === "object" &&
  value !== null &&
  ["password", "link", "other"].includes((value as Record<string, unknown>).signInMethod as string);

export type PasswordState =
  | { status: "idle"; data: null }
  | { status: "loading"; data: null }
  | { status: "ok"; data: PasswordStatus }
  | { status: "forbidden"; data: null }
  | { status: "error"; data: null; message: string };

/**
 * How the person signed in and whether that was just now (GET /api/me/password, owner and admin only). Reads once
 * when `enabled`; it is claims-only on the server, so it costs no query. A failure is a state: the page keeps working.
 */
export function usePasswordStatus(enabled: boolean): PasswordState {
  const [result, setResult] = useState<PasswordState | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void apiJson<PasswordStatus>("/api/me/password").then((reply) => {
      if (cancelled) return;
      if (reply.ok && isStatus(reply.data)) setResult({ status: "ok", data: reply.data });
      else if (reply.ok) setResult({ status: "error", data: null, message: "" });
      else if (reply.status === 403) setResult({ status: "forbidden", data: null });
      else setResult({ status: "error", data: null, message: reply.error.message });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return { status: "idle", data: null };
  return result ?? { status: "loading", data: null };
}
