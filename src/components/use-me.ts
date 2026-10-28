"use client";

import { useSyncExternalStore } from "react";
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

// One store for the whole session, shared by the shell, the demo banner and every screen. Components subscribe
// (useSyncExternalStore), so ONE answer reaches all of them, also when only one asked again (Riprova): the shell
// stays mounted while pages change. Rules:
// - only a successful answer stays after the last component has gone; 401, 403 and errors are shown to whoever is
//   mounted, then forgotten, and the next mount asks again (the person may have signed in since);
// - `generation` changes on every reset, so an answer that was in flight for the previous person is dropped.
let snapshot: MeState = LOADING;
let generation = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: MeState): void {
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

function stateOf(result: Awaited<ReturnType<typeof apiJson<Me>>>): MeState {
  if (result.ok) return { status: "ok", me: result.data };
  if (result.status === 401) return { status: "signedOut", me: null };
  if (result.status === 403) return { status: "noAccess", me: null };
  return { status: "error", me: null };
}

function start(): void {
  const mine = generation;
  const request: Promise<void> = apiJson<Me>("/api/me").then((result) => {
    // Not ours any more (reset, retry): the answer belongs to nobody.
    if (mine !== generation) return;
    pending = null;
    publish(stateOf(result));
  });
  pending = request;
}

/** Asks again from scratch: every mounted component goes back to `loading`, then hears the new answer. */
function restart(): void {
  generation += 1;
  pending = null;
  publish(LOADING);
  if (listeners.size > 0) start();
}

/** Forgets the cached user. Logout, PIN login and the end of a session call it, so a shared device never keeps a role. */
export function resetMe(): void {
  restart();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (snapshot.status !== "ok" && !pending) {
    // A failed or signed-out answer is not kept: a new mount asks again (others on screen go back to loading).
    if (snapshot.status !== "loading") publish(LOADING);
    start();
  }
  return () => {
    listeners.delete(listener);
    const terminal = snapshot.status !== "ok" && snapshot.status !== "loading";
    if (listeners.size === 0 && terminal) snapshot = LOADING;
  };
}

const getSnapshot = (): MeState => snapshot;
const getServerSnapshot = (): MeState => LOADING;

/** The signed-in user and tenant from /api/me, fetched once and shared. `retry` asks again after an `error`. */
export function useMe(): MeState & { retry: () => void } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...state, retry: restart };
}
