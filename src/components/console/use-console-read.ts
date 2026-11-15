"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Load } from "@/components/console/console-shell";
import { consoleApi, resetConsoleSwitch } from "@/lib/console/console-api";

const LOADING = { kind: "loading" } as const;

/**
 * One screen's GET, read when `path` is set or changes, never on a timer. A reply that is taking the page away (the switch into console mode,
 * a sign-in redirect) keeps "loading". A newer read supersedes an older one, so a slow old answer never replaces a new one. `reload` is the
 * person's «Riprova»: it clears the switch guard first (so a failed switch can post once more), then reads again. A retry keeps the error on
 * screen (`busy` is true until the answer), so the button the person pressed is never unmounted; a read for a new path shows "loading".
 */
export function useConsoleRead<T>(path: `/api/platform/${string}` | null) {
  const [load, setLoad] = useState<Load<T>>(LOADING);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const started = useRef<string | null>(null);

  const read = useCallback((target: `/api/platform/${string}`, retry: boolean) => {
    const mine = ++latest.current;
    if (!retry) setLoad(LOADING);
    setBusy(retry);
    setVersion((v) => v + 1);
    void consoleApi<T>(target).then((result) => {
      if (mine !== latest.current) return;
      if (result.ok) {
        setLoad({ kind: "ready", data: result.data });
        setBusy(false);
      } else if (!result.leaving) {
        setLoad({ kind: "error", failure: result });
        setBusy(false);
      }
    });
  }, []);

  useEffect(() => {
    // The ref keeps one read per path under StrictMode's second effect run in development.
    if (path === null) {
      started.current = null;
      return;
    }
    if (started.current === path) return;
    started.current = path;
    read(path, false);
  }, [path, read]);

  const reload = useCallback(() => {
    if (path === null) return;
    resetConsoleSwitch();
    read(path, true);
  }, [path, read]);

  return { load, reload, version, busy };
}
