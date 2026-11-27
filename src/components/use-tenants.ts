"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";

/** One venue of the signed-in login, as GET /api/me/tenants lists it (the role never carries a cost). */
export interface TenantChoice {
  id: string;
  name: string;
  role: "owner" | "admin" | "chef" | "waiter";
  current: boolean;
}

/** `offline`: the read failed and the browser says it has no connection; `error`: anything else. */
export type TenantsState =
  | { status: "loading"; tenants: null }
  | { status: "ok"; tenants: TenantChoice[] }
  | { status: "signedOut"; tenants: null }
  | { status: "offline"; tenants: null }
  | { status: "error"; tenants: null };

const ROLES = new Set(["owner", "admin", "chef", "waiter"]);

function isChoice(value: unknown): value is TenantChoice {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.role === "string" &&
    ROLES.has(v.role) &&
    typeof v.current === "boolean"
  );
}

// One read at a time: the header and the laptop sidebar both mount a switcher, and they share the request in flight. Nothing is kept
// after it answers (the list is never cached here, nor by the service worker): the next mount asks again.
let inflight: Promise<TenantsState> | null = null;

function read(): Promise<TenantsState> {
  if (inflight) return inflight;
  const request = apiJson<{ tenants?: unknown }>("/api/me/tenants")
    .then((result): TenantsState => {
      if (result.ok) {
        const list = result.data?.tenants;
        if (Array.isArray(list) && list.every(isChoice)) return { status: "ok", tenants: list };
        return { status: "error", tenants: null };
      }
      if (result.status === 401) return { status: "signedOut", tenants: null };
      if (result.status === 0 && typeof navigator !== "undefined" && navigator.onLine === false)
        return { status: "offline", tenants: null };
      return { status: "error", tenants: null };
    })
    .finally(() => {
      inflight = null;
    });
  inflight = request;
  return request;
}

/** The venues of the signed-in login, read from GET /api/me/tenants (SP2). `retry` asks again after an `offline` or `error`. */
export function useTenants(): TenantsState & { retry: () => void } {
  const [state, setState] = useState<TenantsState>({ status: "loading", tenants: null });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    void read().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [round]);
  const retry = useCallback(() => {
    setState({ status: "loading", tenants: null });
    setRound((n) => n + 1);
  }, []);
  return { ...state, retry };
}
