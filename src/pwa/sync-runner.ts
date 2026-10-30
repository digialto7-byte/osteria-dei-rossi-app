import type { RunReport } from "@/lib/sync/replay";
import type { AppRole } from "@/lib/api/with-api";

// What wakes the replay engine (M20 plan §3.1.7 step 1, §3.6.2): the start, a new op (trigger), the `online` event, the window gaining focus,
// the page becoming visible, and a timer while ops are pending, at the backoff delay. Background Sync is not used (ADR-005).
// `online`, focus, visibility and a new op bypass the backoff wait; the timer does not (its delay has passed). A run in progress is
// never doubled: triggers meanwhile are folded into one more run after it. The window, the document and the timers are injected.

/** Owner, admin and waiter take orders and run the replayer; the chef writes nothing offline. */
export function canSync(role: AppRole | string | undefined): boolean {
  return role === "owner" || role === "admin" || role === "waiter";
}

interface Target {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface RunnerEnv {
  win: Target;
  doc: Target & { visibilityState: string };
  replayer: { run(options?: { bypassBackoff?: boolean }): Promise<RunReport> };
  pendingCount(): Promise<number>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/** Another tab holds the lease: look again soon, in case it was closed mid-run. */
const BUSY_RETRY_MS = 2_000;

export function startSyncRunner(env: RunnerEnv): { trigger(): void; stop(): void } {
  let stopped = false;
  let running = false;
  let again = false;
  let timer: unknown = null;

  const cancelTimer = () => {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
  };

  async function run(bypassBackoff: boolean): Promise<void> {
    if (stopped) return;
    cancelTimer();
    if (running) {
      again = true;
      return;
    }
    running = true;
    let report: RunReport | null = null;
    try {
      report = await env.replayer.run({ bypassBackoff });
    } catch {
      // the engine reports its own failures; a throw here must not stop the next trigger
    } finally {
      running = false;
    }
    if (stopped) return;
    if (again) {
      again = false;
      void run(true);
      return;
    }
    if (!report) return;
    const delay = report.busy
      ? BUSY_RETRY_MS
      : report.state === "signedOut" || report.state === "forbidden"
        ? null
        : report.nextDelayMs;
    if (delay === null || delay === undefined) return;
    if ((await env.pendingCount()) === 0 || stopped) return;
    cancelTimer();
    timer = env.setTimeout(() => {
      timer = null;
      void run(false);
    }, delay);
  }

  const wake = () => void run(true);
  const onVisibility = () => {
    if (env.doc.visibilityState === "visible") wake();
  };
  env.win.addEventListener("online", wake);
  env.win.addEventListener("focus", wake);
  env.doc.addEventListener("visibilitychange", onVisibility);
  wake();

  return {
    trigger: wake,
    stop() {
      stopped = true;
      cancelTimer();
      env.win.removeEventListener("online", wake);
      env.win.removeEventListener("focus", wake);
      env.doc.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
