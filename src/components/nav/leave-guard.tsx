"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type MouseEvent,
} from "react";

// The leave guard (QW12, docs/plans/2026-11-13-ux-quick-wins.md). A page that should not be left silently (the comanda, with dishes not
// sent) registers a guard. The in-app exits ("← Tavoli", the wordmark, "Esci") ask it first. A guard gets `go`, the exit itself:
// it returns false to let the exit proceed as today, or true to take over and call `go` later (after its own sheet). There is no
// navigation trap: the browser and phone back gesture are not touched, nothing listens for the page being unloaded, and a modified click
// (a new tab) is never intercepted.

/** Returns true when it has taken the exit over and will call `go` itself (or not at all). */
export type LeaveGuard = (go: () => void) => boolean;

interface LeaveApi {
  register: (guard: LeaveGuard | null) => void;
  /** True when the guard took the exit over. */
  intercept: (go: () => void) => boolean;
}

const NONE: LeaveApi = { register: () => undefined, intercept: () => false };
const LeaveGuardContext = createContext<LeaveApi>(NONE);

export function LeaveGuardProvider({ children }: { children: React.ReactNode }) {
  const current = useRef<LeaveGuard | null>(null);
  const api = useMemo<LeaveApi>(
    () => ({
      register: (guard) => {
        current.current = guard;
      },
      intercept: (go) => (current.current ? current.current(go) : false),
    }),
    [],
  );
  return <LeaveGuardContext value={api}>{children}</LeaveGuardContext>;
}

/** Registers `guard` while the page is shown (null: none). Give it a stable identity (`useCallback`). */
export function useLeaveGuard(guard: LeaveGuard | null): void {
  const { register } = useContext(LeaveGuardContext);
  useEffect(() => {
    register(guard);
    return () => register(null);
  }, [guard, register]);
}

/** For an exit that is not a link ("Esci"): runs `go` at once, unless the guard takes over. */
export function useRequestLeave(): (go: () => void) => void {
  const { intercept } = useContext(LeaveGuardContext);
  return (go) => {
    if (!intercept(go)) go();
  };
}

const modified = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/**
 * A `next/link` whose plain click asks the guard first. With no guard it is the plain link. `fullLoad` makes it a plain anchor (a
 * document load, for a page that needs its own CSP, P2-1 T-12): the guard's `go` is then `location.assign`, never a client navigation.
 */
export function GuardedLink({
  href,
  onClick,
  fullLoad = false,
  ...rest
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string; fullLoad?: boolean }) {
  const { intercept } = useContext(LeaveGuardContext);
  const router = useRouter();
  const ask = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || modified(event) || rest.target === "_blank") return;
    const go = fullLoad ? () => window.location.assign(href) : () => router.push(href);
    if (intercept(go)) event.preventDefault();
  };
  if (fullLoad) {
    const { children, className, "aria-current": current } = rest;
    return (
      <a href={href} aria-current={current} className={className} onClick={ask}>
        {children}
      </a>
    );
  }
  return <Link href={href} {...rest} onClick={ask} />;
}
