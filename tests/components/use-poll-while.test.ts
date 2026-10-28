// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePollWhile } from "@/components/use-poll-while";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("usePollWhile", () => {
  it("ticks every interval while active, and not otherwise", async () => {
    const tick = vi.fn(async () => {});
    const { rerender, unmount } = renderHook(({ on }) => usePollWhile(on, 1000, tick), {
      initialProps: { on: true },
    });
    await vi.advanceTimersByTimeAsync(3100);
    expect(tick).toHaveBeenCalledTimes(3);
    rerender({ on: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(3);
    rerender({ on: true });
    unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("does not start a read while the previous one is still in flight, so answers cannot overlap", async () => {
    let finish: () => void = () => {};
    const tick = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderHook(() => usePollWhile(true, 1000, tick));
    await vi.advanceTimersByTimeAsync(1100);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("a failed read does not stop the polling", async () => {
    const tick = vi.fn(async () => {
      throw new Error("boom");
    });
    renderHook(() => usePollWhile(true, 1000, () => tick().catch(() => {})));
    await vi.advanceTimersByTimeAsync(3100);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("a tick that throws synchronously still lets the next one run", async () => {
    let calls = 0;
    const tick = () => {
      calls += 1;
      throw new Error("sync");
    };
    renderHook(() => usePollWhile(true, 1000, tick));
    await vi.advanceTimersByTimeAsync(3100);
    expect(calls).toBe(3);
  });
});
