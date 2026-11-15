"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { z } from "zod";
import { ConsoleBand } from "@/components/console/console-band";
import { ConsoleLogout } from "@/components/console/console-logout";
import { ConsolePills, ConsoleSidebar, type SectionCounts } from "@/components/console/console-nav";
import { PageMain } from "@/components/page-main";
import { consoleApi, resetConsoleSwitch, type ConsoleFailure } from "@/lib/console/console-api";
import { t } from "@/lib/i18n";
import type { meResponseSchema, TenantSummary } from "@/lib/platform/api";

export type MeReply = z.infer<typeof meResponseSchema>;

/** One read: not answered yet (or the page is being left), failed, or answered. */
export type Load<T> =
  { kind: "loading" } | { kind: "error"; failure: ConsoleFailure } | { kind: "ready"; data: T };

export interface ConsoleShellState {
  tenants: Load<TenantSummary[]>;
  me: Load<MeReply>;
  /** The person asked again after a failed list: clears the switch guard, then reads the list (and /me, if it had failed) once more. */
  retryTenants: () => void;
  /** True while the list is being read again after a failure: the error stays on screen, its «Riprova» disabled. */
  tenantsBusy: boolean;
  /** Reads /me once more (the Avvisi count, after «Segna come avvisato»). The tenant list is not read again. */
  refreshMe: () => void;
}

const ConsoleShellContext = createContext<ConsoleShellState | null>(null);

export function useConsoleShell(): ConsoleShellState {
  const state = useContext(ConsoleShellContext);
  if (state === null) throw new Error("useConsoleShell must be used inside ConsoleShell");
  return state;
}

const LOADING = { kind: "loading" } as const;
const tenantsOf = (reply: { tenants: TenantSummary[] }) => reply.tenants;
const meOf = (reply: MeReply) => reply;

/**
 * One GET into a `Load`. A reply that is taking the page away (the switch into console mode, a sign-in redirect) keeps "loading": the
 * screen never flashes an error for it. A newer read supersedes an older one.
 */
function useRead<R, T>(path: `/api/platform/${string}`, pick: (reply: R) => T) {
  const [load, setLoad] = useState<Load<T>>(LOADING);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  // A read never resets `load`: the first one starts from "loading", and a retry keeps the error (busy) so the «Riprova» that was pressed
  // stays mounted and keeps focus.
  const read = useCallback(() => {
    const mine = ++latest.current;
    setBusy(true);
    void consoleApi<R>(path).then((result) => {
      if (mine !== latest.current) return;
      if (result.ok) {
        setLoad({ kind: "ready", data: pick(result.data) });
        setBusy(false);
      } else if (!result.leaving) {
        setLoad({ kind: "error", failure: result });
        setBusy(false);
      }
    });
  }, [path, pick]);
  return [load, read, busy] as const;
}

/**
 * The signed-in console's frame: the band with «Esci», the sidebar (laptop) or pills (phone), and the two reads every screen shares.
 * Each read happens once on mount; nothing re-reads on a timer or when the tab comes back.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const [tenants, readTenants, tenantsBusy] = useRead<
    { tenants: TenantSummary[] },
    TenantSummary[]
  >("/api/platform/tenants", tenantsOf);
  const [me, readMe] = useRead<MeReply, MeReply>("/api/platform/me", meOf);

  const started = useRef(false);
  useEffect(() => {
    // StrictMode runs effects twice in development: the guard keeps the reads to one each.
    if (started.current) return;
    started.current = true;
    readMe();
    readTenants();
  }, [readMe, readTenants]);

  const meFailed = me.kind === "error";
  const retryTenants = useCallback(() => {
    resetConsoleSwitch();
    readTenants();
    if (meFailed) readMe();
  }, [meFailed, readMe, readTenants]);
  const refreshMe = readMe;

  const state = useMemo(
    () => ({ tenants, me, retryTenants, tenantsBusy, refreshMe }),
    [tenants, me, retryTenants, tenantsBusy, refreshMe],
  );
  const counts: SectionCounts = {
    locali: tenants.kind === "ready" ? tenants.data.length : null,
    avvisi: me.kind === "ready" ? me.data.unreadNotices : null,
  };
  const displayName = me.kind === "ready" ? me.data.displayName : null;

  return (
    <ConsoleShellContext value={state}>
      <ConsoleBand account={<ConsoleLogout tone="band" />} />
      <PageMain>
        <div data-layout="wide" className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
          <ConsolePills counts={counts} />
          <ConsoleSidebar counts={counts} displayName={displayName} />
          <div className="flex min-w-0 flex-1 flex-col gap-6 lg:max-w-[1040px]">{children}</div>
          <p data-testid="console-times" className="text-sm text-ink-muted lg:hidden">
            {t("console.footer.times")}
          </p>
        </div>
      </PageMain>
    </ConsoleShellContext>
  );
}
