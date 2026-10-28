"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";

/** The reply of GET /api/me (src/app/api/me/route.ts). */
export interface Me {
  user: { id: string; displayName: string; role: "owner" | "admin" | "chef" | "waiter" };
  tenant: { id: string; name: string; isDemo?: boolean };
}

/**
 * What /api/me said:
 * - `ok`: the user and tenant;
 * - `signedOut`: 401, there is no session;
 * - `noAccess`: 403, signed in but enabled for no venue;
 * - `error`: anything else (network failure, 5xx, a reply that is not JSON): we do not know, so a screen
 *   must say so and offer a retry, never claim "signed out".
 */
export type MeState =
  | { status: "loading"; me: null }
  | { status: "ok"; me: Me }
  | { status: "signedOut"; me: null }
  | { status: "noAccess"; me: null }
  | { status: "error"; me: null };

const LOADING: MeState = { status: "loading", me: null };

// One /api/me read per session, shared by the shell and every screen. Kept at module level so it
// outlives the components that asked for it. Only a successful answer is kept: 401, 403 and errors are asked
// again by the next mount (the person may have signed in since). `generation` changes on every reset, so an
// answer that was in flight for the previous person is dropped, wherever it arrives.
let generation = 0;
let pending: Promise<MeState> | null = null;
let settled: MeState | null = null;

function stateOf(result: Awaited<ReturnType<typeof apiJson<Me>>>): MeState {
  if (result.ok) return { status: "ok", me: result.data };
  if (result.status === 401) return { status: "signedOut", me: null };
  if (result.status === 403) return { status: "noAccess", me: null };
  return { status: "error", me: null };
}

function load(): Promise<MeState> {
  if (pending) return pending;
  const mine = generation;
  const request: Promise<MeState> = apiJson<Me>("/api/me").then((result) => {
    const state = stateOf(result);
    if (mine === generation) {
      if (state.status === "ok") settled = state;
      else pending = null;
    }
    return state;
  });
  pending = request;
  return request;
}

/** Forgets the cached user. Logout, PIN login and the end of a session call it, so a shared device never keeps a role. */
export function resetMe(): void {
  generation += 1;
  pending = null;
  settled = null;
}

/** The signed-in user and tenant from /api/me, fetched once and shared. `retry` asks again after an `error`. */
export function useMe(): MeState & { retry: () => void } {
  const [state, setState] = useState<MeState>(settled ?? LOADING);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const run = () => {
      const started = generation;
      void load().then((next) => {
        if (!live) return;
        // The person changed while we waited: that answer is not theirs. Ask again.
        if (started !== generation) return run();
        setState(next);
      });
    };
    run();
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState(LOADING);
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
