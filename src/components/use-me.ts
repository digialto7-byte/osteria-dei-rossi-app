"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";

/** The reply of GET /api/me (src/app/api/me/route.ts). */
export interface Me {
  user: { id: string; displayName: string; role: "owner" | "admin" | "chef" | "waiter" };
  tenant: { id: string; name: string; isDemo?: boolean };
}

export type MeState =
  | { status: "loading"; me: null }
  | { status: "ok"; me: Me }
  | { status: "signedOut"; me: null }
  | { status: "noAccess"; me: null };

const LOADING: MeState = { status: "loading", me: null };
const SIGNED_OUT: MeState = { status: "signedOut", me: null };
const NO_ACCESS: MeState = { status: "noAccess", me: null };

// One /api/me read per session, shared by the shell and every screen. Kept at module level so it
// outlives the components that asked for it.
let pending: Promise<MeState> | null = null;
let settled: MeState | null = null;

function load(): Promise<MeState> {
  if (pending) return pending;
  const request: Promise<MeState> = apiJson<Me>("/api/me").then((result) => {
    let state: MeState;
    if (result.ok) state = { status: "ok", me: result.data };
    else state = result.status === 403 ? NO_ACCESS : SIGNED_OUT;
    // Only an answer from the server is kept. A network or server failure is retried by the next
    // mount, and an answer that arrives after resetMe() belongs to the previous person.
    if (pending === request && (result.ok || result.status === 401 || result.status === 403))
      settled = state;
    else if (pending === request) pending = null;
    return state;
  });
  pending = request;
  return request;
}

/** Forgets the cached user. Logout and PIN login call it, so a shared device never keeps a role. */
export function resetMe(): void {
  pending = null;
  settled = null;
}

/** The signed-in user and tenant from /api/me, fetched once and shared. */
export function useMe(): MeState {
  const [state, setState] = useState<MeState>(settled ?? LOADING);
  useEffect(() => {
    let live = true;
    void load().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
