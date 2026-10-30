import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunReport } from "@/lib/sync/replay";
import { canSync, startSyncRunner, type RunnerEnv } from "@/pwa/sync-runner";

// M20 plan §3.1.7 step 1 and step 17: what wakes the replay engine, with a fake window, fake timers and a scripted engine.
const REPORT = (extra: Partial<RunReport> = {}): RunReport => ({
  busy: false,
  waited: false,
  state: "idle",
  nextDelayMs: null,
  ...extra,
});

class FakeWindow {
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function setup(options: { visible?: boolean; pending?: number } = {}) {
  const win = new FakeWindow();
  const doc = new FakeWindow() as FakeWindow & { visibilityState: string };
  doc.visibilityState = options.visible === false ? "hidden" : "visible";
  const reports: (RunReport | Promise<RunReport>)[] = [];
  const run = vi.fn(async (_options?: { bypassBackoff?: boolean }) => {
    const next = reports.shift() ?? REPORT();
    return next;
  });
  let pending = options.pending ?? 0;
  const env: RunnerEnv = {
    win,
    doc,
    replayer: { run },
    pendingCount: async () => pending,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  return {
    win,
    doc,
    run,
    reports,
    env,
    setPending: (n: number) => (pending = n),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("canSync", () => {
  it("owner, admin and waiter run the replayer; the chef does not", () => {
    expect(canSync("owner")).toBe(true);
    expect(canSync("admin")).toBe(true);
    expect(canSync("waiter")).toBe(true);
    expect(canSync("chef")).toBe(false);
    expect(canSync(undefined)).toBe(false);
  });
});

describe("startSyncRunner: triggers", () => {
  it("runs once at start, bypassing the wait", async () => {
    const s = setup();
    startSyncRunner(s.env);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).toHaveBeenCalledTimes(1);
    expect(s.run).toHaveBeenCalledWith({ bypassBackoff: true });
  });

  it.each([["online"], ["focus"]])(
    "%s on the window starts a run that bypasses the backoff",
    async (type) => {
      const s = setup();
      startSyncRunner(s.env);
      await vi.advanceTimersByTimeAsync(0);
      s.run.mockClear();
      s.win.emit(type);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.run).toHaveBeenCalledTimes(1);
      expect(s.run).toHaveBeenCalledWith({ bypassBackoff: true });
    },
  );

  it("visibilitychange to visible starts a run; to hidden does not", async () => {
    const s = setup({ visible: false });
    startSyncRunner(s.env);
    await vi.advanceTimersByTimeAsync(0);
    s.run.mockClear();
    s.doc.emit("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).not.toHaveBeenCalled();
    s.doc.visibilityState = "visible";
    s.doc.emit("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).toHaveBeenCalledTimes(1);
  });

  it("trigger() is what a new op calls: a run that bypasses the wait", async () => {
    const s = setup();
    const runner = startSyncRunner(s.env);
    await vi.advanceTimersByTimeAsync(0);
    s.run.mockClear();
    runner.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).toHaveBeenCalledWith({ bypassBackoff: true });
  });

  it("a run in progress is not doubled: triggers meanwhile make exactly one more run after it", async () => {
    const s = setup();
    let finish!: (report: RunReport) => void;
    s.reports.push(new Promise<RunReport>((resolve) => (finish = resolve)));
    startSyncRunner(s.env);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).toHaveBeenCalledTimes(1);
    s.win.emit("online");
    s.win.emit("focus");
    s.doc.emit("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).toHaveBeenCalledTimes(1);
    finish(REPORT());
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).toHaveBeenCalledTimes(2);
  });
});

describe("startSyncRunner: the timer", () => {
  it("while ops are pending, the next run is scheduled at the backoff delay and does not bypass it", async () => {
    const s = setup({ pending: 2 });
    s.reports.push(REPORT({ state: "backoff", nextDelayMs: 4_000 }));
    startSyncRunner(s.env);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(s.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.run).toHaveBeenCalledTimes(2);
    expect(s.run).toHaveBeenLastCalledWith({ bypassBackoff: false });
  });

  it("no timer when nothing is pending, when no delay is set, or when signed out or forbidden", async () => {
    for (const report of [
      REPORT({ state: "backoff", nextDelayMs: 1_000 }), // nothing pending
      REPORT({ state: "idle", nextDelayMs: null }),
      REPORT({ state: "signedOut", nextDelayMs: null }),
      REPORT({ state: "forbidden", nextDelayMs: null }),
    ]) {
      const s = setup({ pending: report.state === "backoff" ? 0 : 3 });
      s.reports.push(report);
      startSyncRunner(s.env);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(s.run, report.state).toHaveBeenCalledTimes(1);
    }
  });

  it("another tab holds the lease: look again in 2 s while ops wait", async () => {
    const s = setup({ pending: 1 });
    s.reports.push(REPORT({ busy: true }));
    startSyncRunner(s.env);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.run).toHaveBeenCalledTimes(2);
  });

  it("a new run replaces the scheduled one (one timer at a time)", async () => {
    const s = setup({ pending: 1 });
    s.reports.push(REPORT({ state: "backoff", nextDelayMs: 10_000 }), REPORT());
    const runner = startSyncRunner(s.env);
    await vi.advanceTimersByTimeAsync(0);
    runner.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.run).toHaveBeenCalledTimes(2);
  });
});

describe("startSyncRunner: stop", () => {
  it("removes every listener and cancels the timer", async () => {
    const s = setup({ pending: 1 });
    s.reports.push(REPORT({ state: "backoff", nextDelayMs: 1_000 }));
    const runner = startSyncRunner(s.env);
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();
    expect([s.win.count("online"), s.win.count("focus"), s.doc.count("visibilitychange")]).toEqual([
      0, 0, 0,
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.run).toHaveBeenCalledTimes(1);
    s.win.emit("online");
    runner.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).toHaveBeenCalledTimes(1);
  });

  it("an engine that throws does not kill the runner", async () => {
    const s = setup();
    s.run.mockRejectedValueOnce(new Error("boom"));
    startSyncRunner(s.env);
    await vi.advanceTimersByTimeAsync(0);
    s.win.emit("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.run).toHaveBeenCalledTimes(2);
  });
});
